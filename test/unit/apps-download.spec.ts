import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { APP_SERVICE } from '../../src/dashboard/services/app-service';
import { DOWNLOAD_OPTIONS, downloadApp } from '../../src/app/routers/apps';

/**
 * The download handler for the Apps registry.
 *
 * These assert on the options handed to `res.download` rather than driving a
 * real request, because the repo dev-depends on Express 4 while Appium 3 runs
 * the plugin on Express 5 — and this bug only exists on 5. A supertest-style
 * test would pass here whether or not the fix is present, which is the worst
 * kind of green.
 */

const created: string[] = [];

/** A file under a dot-segment, exactly like `~/.cache/xenon/apps/…`. */
function appInDotDir(): { filepath: string; filename: string } {
  const home = mkdtempSync(path.join(tmpdir(), 'xenon-apps-'));
  created.push(home);
  const dir = path.join(home, '.cache', 'xenon', 'apps');
  mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, 'abc-123.ipa');
  writeFileSync(filepath, 'not really an ipa');
  return { filepath, filename: 'wda-signed.ipa' };
}

interface Captured {
  download: sinon.SinonSpy;
  status: sinon.SinonSpy;
  json: sinon.SinonSpy;
  statusCode?: number;
}

function fakeRes(): { res: any; cap: Captured } {
  const cap: Captured = {
    download: sinon.spy(),
    status: sinon.spy(),
    json: sinon.spy(),
  };
  const res: any = {
    download: (...args: unknown[]) => cap.download(...args),
    status(code: number) {
      cap.statusCode = code;
      cap.status(code);
      return res;
    },
    json: (body: unknown) => cap.json(body),
  };
  return { res, cap };
}

afterEach(() => {
  sinon.restore();
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe('apps download handler', () => {
  it('serves a file that lives under a dot-directory', async () => {
    const app = appInDotDir();
    sinon.stub(APP_SERVICE, 'getAppById').resolves(app as any);
    const { res, cap } = fakeRes();

    await downloadApp({ params: { id: 'abc-123' } } as any, res);

    expect(cap.download.calledOnce, 'the file is sent').to.equal(true);
    const [sentPath, sentName, opts] = cap.download.firstCall.args;
    expect(sentPath).to.equal(app.filepath);
    expect(sentName).to.equal(app.filename);
    // Without this, `send` 1.x refuses the path for containing `.cache` and
    // answers 404 with an HTML error page — see DOWNLOAD_OPTIONS.
    expect(opts, 'dotfiles must be allowed').to.deep.equal({ dotfiles: 'allow' });
  });

  it('exports the option set, so the reason survives a refactor', () => {
    expect(DOWNLOAD_OPTIONS.dotfiles).to.equal('allow');
  });

  it('404s when the row exists but the file is gone', async () => {
    sinon
      .stub(APP_SERVICE, 'getAppById')
      .resolves({ filepath: '/nope/missing.ipa', filename: 'missing.ipa' } as any);
    const { res, cap } = fakeRes();

    await downloadApp({ params: { id: 'gone' } } as any, res);

    expect(cap.download.called, 'nothing is sent').to.equal(false);
    expect(cap.statusCode).to.equal(404);
    expect(cap.json.firstCall.args[0]).to.deep.equal({ error: 'App not found' });
  });

  it('404s when there is no such app', async () => {
    sinon.stub(APP_SERVICE, 'getAppById').resolves(undefined as any);
    const { res, cap } = fakeRes();

    await downloadApp({ params: { id: 'unknown' } } as any, res);

    expect(cap.statusCode).to.equal(404);
  });

  // A lookup that throws must not surface as "not found" — that would send
  // someone hunting for a missing file when the store is what is broken.
  it('500s when the lookup throws, rather than reporting not-found', async () => {
    sinon.stub(APP_SERVICE, 'getAppById').rejects(new Error('db is down'));
    const { res, cap } = fakeRes();

    await downloadApp({ params: { id: 'boom' } } as any, res);

    expect(cap.statusCode).to.equal(500);
    expect(cap.json.firstCall.args[0]).to.deep.equal({ error: 'db is down' });
  });
});
