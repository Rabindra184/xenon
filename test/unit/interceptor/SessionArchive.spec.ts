import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CapturedRequest } from '../../../src/services/interceptor/types';
import {
  archivePaths,
  loadArchivedHar,
  loadArchivedRequests,
} from '../../../src/services/interceptor/SessionArchive';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-archive-spec-'));
}

function makeRequest(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    id: 'req-1',
    sessionId: 'sess-1',
    ts: 1700000000000,
    method: 'GET',
    url: 'https://api.example.com/x',
    host: 'api.example.com',
    path: '/x',
    reqHeaders: {},
    reqBody: null,
    resStatus: 200,
    resHeaders: {},
    resBody: null,
    durationMs: 12,
    mocked: false,
    modified: false,
    ...overrides,
  };
}

describe('SessionArchive.archivePaths', () => {
  it('returns deterministic paths under the assets root', () => {
    const p = archivePaths('/var/xenon-assets', 'sess-42');
    expect(p.dir).to.equal('/var/xenon-assets/sess-42/interceptor');
    expect(p.requests).to.equal('/var/xenon-assets/sess-42/interceptor/requests.json');
    expect(p.har).to.equal('/var/xenon-assets/sess-42/interceptor/session.har');
  });
});

describe('SessionArchive.loadArchivedRequests', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null when the session directory does not exist', () => {
    expect(loadArchivedRequests(root, 'sess-1')).to.equal(null);
  });

  it('returns null when requests.json is missing', () => {
    fs.mkdirSync(path.join(root, 'sess-1', 'interceptor'), { recursive: true });
    expect(loadArchivedRequests(root, 'sess-1')).to.equal(null);
  });

  it('returns null when requests.json is malformed JSON', () => {
    const dir = path.join(root, 'sess-1', 'interceptor');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'requests.json'), '{not json', 'utf8');
    expect(loadArchivedRequests(root, 'sess-1')).to.equal(null);
  });

  it('parses and returns the requests array on happy path', () => {
    const dir = path.join(root, 'sess-1', 'interceptor');
    fs.mkdirSync(dir, { recursive: true });
    const req = makeRequest({ id: 'a', resBody: '{"ok":true}' });
    fs.writeFileSync(
      path.join(dir, 'requests.json'),
      JSON.stringify({ sessionId: 'sess-1', requests: [req] }),
      'utf8',
    );
    const got = loadArchivedRequests(root, 'sess-1');
    expect(got).to.have.length(1);
    expect(got![0].id).to.equal('a');
    expect(got![0].resBody).to.equal('{"ok":true}');
  });

  it('strips dead bodyPath references for entries whose spill file is gone', () => {
    // Spill files live in os.tmpdir() and get cleaned at session stop. After
    // rehydration the path is dead — clear it so the dashboard does not try to
    // GET a body it cannot fetch.
    const dir = path.join(root, 'sess-1', 'interceptor');
    fs.mkdirSync(dir, { recursive: true });
    const req = makeRequest({
      id: 'b',
      resBody: null,
      bodyPath: '/tmp/xenon-interceptor/sess-1/b.body',
    });
    fs.writeFileSync(
      path.join(dir, 'requests.json'),
      JSON.stringify({ sessionId: 'sess-1', requests: [req] }),
      'utf8',
    );
    const got = loadArchivedRequests(root, 'sess-1');
    expect(got).to.have.length(1);
    expect(got![0].bodyPath).to.equal(undefined);
    expect(got![0].resBody).to.equal(null);
  });

  it('returns an empty array when the dump has no requests', () => {
    const dir = path.join(root, 'sess-1', 'interceptor');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'requests.json'),
      JSON.stringify({ sessionId: 'sess-1' }),
      'utf8',
    );
    expect(loadArchivedRequests(root, 'sess-1')).to.deep.equal([]);
  });
});

describe('SessionArchive.loadArchivedHar', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null when the file is missing', () => {
    expect(loadArchivedHar(root, 'sess-1')).to.equal(null);
  });

  it('returns the raw HAR content as a string', () => {
    const dir = path.join(root, 'sess-1', 'interceptor');
    fs.mkdirSync(dir, { recursive: true });
    const har = JSON.stringify({ log: { version: '1.2', entries: [] } });
    fs.writeFileSync(path.join(dir, 'session.har'), har, 'utf8');
    expect(loadArchivedHar(root, 'sess-1')).to.equal(har);
  });
});
