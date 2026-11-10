import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from '../helpers/loopbackRequest';
import AppsRouter from '../../src/app/routers/apps';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { config } from '../../src/config';
import { parseXenonAppRef, xenonAppRef } from '../../src/services/session/appCapability';
import { useScratchDatabase } from '../helpers/scratch-database';

const UUID = '9adc3f2e-7b1a-4c6d-8e9f-0a1b2c3d4e5f';

/**
 * A session names an app in the library by its id, bare or as
 * `xenon://<id>`. Through 2.27 only a value without `/` or `\` was looked up,
 * so `xenon://<id>` went to the driver as a URL it couldn't fetch.
 */
describe('xenon:// app references', () => {
  describe('parseXenonAppRef', () => {
    it('reads a bare id, as before', () => {
      expect(parseXenonAppRef(UUID)).to.equal(UUID);
    });

    it('reads xenon://<id>, the scheme in any case', () => {
      expect(parseXenonAppRef(`xenon://${UUID}`)).to.equal(UUID);
      expect(parseXenonAppRef(`XENON://${UUID}`)).to.equal(UUID);
    });

    it('leaves an http URL to the driver', () => {
      expect(parseXenonAppRef('http://builds.example.com/app.apk')).to.equal(undefined);
      expect(parseXenonAppRef('https://builds.example.com/app.ipa?sig=x')).to.equal(undefined);
    });

    it('leaves a local path to the driver', () => {
      expect(parseXenonAppRef('/Users/ci/builds/app.apk')).to.equal(undefined);
      expect(parseXenonAppRef('C:\\builds\\app.apk')).to.equal(undefined);
      expect(parseXenonAppRef('./app.apk')).to.equal(undefined);
    });

    it('reads nothing from an empty value, or one that is not a string', () => {
      expect(parseXenonAppRef('')).to.equal(undefined);
      expect(parseXenonAppRef('   ')).to.equal(undefined);
      expect(parseXenonAppRef(undefined)).to.equal(undefined);
      expect(parseXenonAppRef(42)).to.equal(undefined);
      expect(parseXenonAppRef({ id: UUID })).to.equal(undefined);
    });

    for (const [why, value] of [
      ['a path after the scheme', `xenon://${UUID}/extra`],
      ['a parent directory', 'xenon://../apps/x'],
      ['a space', 'xenon://abc def'],
      ['a query', `xenon://${UUID}?x=1`],
      ['a backslash', 'xenon://a\\b'],
      ['nothing after the scheme', 'xenon://'],
      ['an id longer than any the library makes', `xenon://${'a'.repeat(65)}`],
    ] as const) {
      it(`reads nothing from xenon:// with ${why}`, () => {
        expect(parseXenonAppRef(value)).to.equal(undefined);
      });
    }

    it('still tries any bare value without a slash, as before', () => {
      // An id the library doesn't hold is passed on to the driver untouched.
      expect(parseXenonAppRef('app-a')).to.equal('app-a');
      expect(parseXenonAppRef('checkout.apk')).to.equal('checkout.apk');
    });

    it('xenonAppRef is the reference parseXenonAppRef reads back', () => {
      expect(xenonAppRef(UUID)).to.equal(`xenon://${UUID}`);
      expect(parseXenonAppRef(xenonAppRef(UUID))).to.equal(UUID);
    });
  });

  describe('appUrl in the API', function () {
    this.timeout(60_000);
    const scratch = useScratchDatabase();
    let dir: string;
    let configAppsPath: string;

    const server = () => {
      const a = express();
      a.use(express.json());
      a.use((req: any, _res, next) => {
        req.auth = {
          kind: 'user-session',
          userId: 'u',
          rateLimit: 300,
          role: 'ADMIN',
          scopes: scopesForRole('ADMIN'),
          teamIds: undefined,
        };
        next();
      });
      AppsRouter.register(a as any);
      return a;
    };

    beforeEach(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-app-ref-'));
      configAppsPath = config.appsPath;
      config.appsPath = dir;
      await scratch.db.app.deleteMany({});
    });

    afterEach(() => {
      config.appsPath = configAppsPath;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('comes with an upload, beside every field the app has', async () => {
      const r = await request(server())
        .post('/apps/upload')
        .attach('app', Buffer.from('a build'), 'checkout.ipa');
      expect(r.status).to.equal(200);
      expect(r.body.appUrl).to.equal(`xenon://${r.body.id}`);
      for (const field of ['id', 'name', 'filename', 'filepath', 'size', 'md5', 'platform']) {
        expect(r.body, field).to.have.property(field);
      }
    });

    it('comes with every app the list answers, by md5 too', async () => {
      const up = await request(server())
        .post('/apps/upload')
        .attach('app', Buffer.from('listed build'), 'listed.ipa');
      const list = await request(server()).get('/apps');
      expect(list.body).to.have.length(1);
      expect(list.body[0]).to.include({ id: up.body.id, appUrl: `xenon://${up.body.id}` });
      expect(list.body[0]).to.have.property('team');
      const byMd5 = await request(server()).get(`/apps?md5=${up.body.md5}`);
      expect(byMd5.body[0].appUrl).to.equal(`xenon://${up.body.id}`);
    });
  });
});
