import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import request from '../helpers/loopbackRequest';
import AppsRouter from '../../src/app/routers/apps';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { config } from '../../src/config';
import {
  apkIdentity,
  infoPlistIdentity,
  iosArchiveIdentity,
} from '../../src/services/apps/appIdentity';
import { useScratchDatabase } from '../helpers/scratch-database';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const plist = require('plist') as { build(value: unknown): string };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bplistCreator = require('bplist-creator') as (value: unknown) => Buffer;

/** A zip archive of `entries` (path → bytes), in that order. */
function zipOf(entries: Array<[string, Buffer | string]>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip');
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c: Buffer) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.pipe(out);
    for (const [name, bytes] of entries) archive.append(bytes, { name });
    archive.finalize();
  });
}

const INFO = {
  CFBundleIdentifier: 'com.acme.checkout',
  CFBundleShortVersionString: '2.4.1',
  CFBundleVersion: '2041',
};

/**
 * ENH-16: CI can use the app library without an admin's key. A member uploads
 * into their own teams (scope `apps` or `devices`), an iOS app's identity is
 * read, and a build can be looked up by md5 without uploading it.
 */
describe('The app library for CI (ENH-16)', function () {
  this.timeout(60_000);

  describe("an app's identity", () => {
    it('reads an IPA with a binary Info.plist', async () => {
      const ipa = await zipOf([['Payload/Checkout.app/Info.plist', bplistCreator(INFO)]]);
      expect(await iosArchiveIdentity(ipa)).to.deep.equal({
        platform: 'ios',
        packageName: 'com.acme.checkout',
        version: '2.4.1',
        buildNumber: '2041',
      });
    });

    it('reads one with an XML Info.plist', async () => {
      const ipa = await zipOf([['Payload/Checkout.app/Info.plist', plist.build(INFO)]]);
      expect((await iosArchiveIdentity(ipa))?.packageName).to.equal('com.acme.checkout');
    });

    it("reads the app's own Info.plist, never a nested framework's or extension's", async () => {
      const ipa = await zipOf([
        [
          'Payload/Checkout.app/Frameworks/Pay.framework/Info.plist',
          bplistCreator({ CFBundleIdentifier: 'com.acme.pay-framework' }),
        ],
        [
          'Payload/Checkout.app/PlugIns/Widget.appex/Info.plist',
          bplistCreator({ CFBundleIdentifier: 'com.acme.widget' }),
        ],
        ['Payload/Checkout.app/Info.plist', bplistCreator(INFO)],
      ]);
      expect((await iosArchiveIdentity(ipa))?.packageName).to.equal('com.acme.checkout');
    });

    it('reads a zipped simulator build', async () => {
      const zip = await zipOf([['Checkout.app/Info.plist', plist.build(INFO)]]);
      expect((await iosArchiveIdentity(zip))?.buildNumber).to.equal('2041');
    });

    it('answers nothing for an archive with no app in it', async () => {
      expect(await iosArchiveIdentity(await zipOf([['README', 'hi']]))).to.equal(undefined);
    });

    it("throws for bytes that aren't an archive, or an Info.plist too large to be one", async () => {
      let thrown: unknown;
      await iosArchiveIdentity(Buffer.from('not a zip')).catch((e) => (thrown = e));
      expect(thrown).to.be.instanceOf(Error);
      thrown = undefined;
      const huge = await zipOf([['Payload/A.app/Info.plist', Buffer.alloc(1024 * 1024 + 1)]]);
      await iosArchiveIdentity(huge).catch((e) => (thrown = e));
      // Refused by the size the archive declares, before anything is read.
      expect(String(thrown)).to.include(`Info.plist is ${1024 * 1024 + 1} bytes`);
    });

    it('leaves out what an Info.plist leaves out', () => {
      expect(
        infoPlistIdentity(Buffer.from(plist.build({ CFBundleIdentifier: 'x.y' }))),
      ).to.deep.equal({
        platform: 'ios',
        packageName: 'x.y',
        version: undefined,
        buildNumber: undefined,
      });
    });

    it("reads an APK's version code as its build number", () => {
      expect(apkIdentity({ name: 'com.acme', versionName: '1.2', versionCode: 12 })).to.deep.equal({
        platform: 'android',
        packageName: 'com.acme',
        version: '1.2',
        buildNumber: '12',
      });
      expect(apkIdentity({ name: 'com.acme', versionCode: 7 }).version).to.equal('7');
    });
  });

  it('an apps-only key controls no phone and starts no session', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ApiKeyService } = require('../../src/services/ApiKeyService');
    const keys = new ApiKeyService();
    const ci = { scopes: 'apps' } as any;
    expect(keys.hasScope(ci, ['apps', 'devices'])).to.equal(true);
    // /control's mutationScopeGuard and a session create's check.
    expect(keys.hasScope(ci, ['devices'])).to.equal(false);
    expect(keys.hasScope(ci, ['sessions'])).to.equal(false);
  });

  describe('uploads and lookups', () => {
    const scratch = useScratchDatabase();
    let dir: string;
    let configAppsPath: string;

    type Caller = { role: string; scopes: string; teamIds?: string[] };
    const MEMBER_A: Caller = {
      role: 'MEMBER',
      scopes: scopesForRole('MEMBER'),
      teamIds: ['team-a'],
    };
    const MEMBER_B: Caller = {
      role: 'MEMBER',
      scopes: scopesForRole('MEMBER'),
      teamIds: ['team-b'],
    };
    const MEMBER_AB: Caller = {
      role: 'MEMBER',
      scopes: scopesForRole('MEMBER'),
      teamIds: ['team-a', 'team-b'],
    };
    const MEMBER_NONE: Caller = { role: 'MEMBER', scopes: scopesForRole('MEMBER'), teamIds: [] };
    const CI_KEY_A: Caller = { role: 'MEMBER', scopes: 'apps', teamIds: ['team-a'] };
    const READ_KEY_A: Caller = { role: 'MEMBER', scopes: 'read', teamIds: ['team-a'] };
    const ADMIN: Caller = { role: 'ADMIN', scopes: scopesForRole('ADMIN'), teamIds: undefined };

    function server(caller: Caller) {
      const a = express();
      a.use(express.json());
      a.use((req: any, _res, next) => {
        req.auth = { kind: 'api-key', userId: 'u', rateLimit: 300, ...caller };
        next();
      });
      AppsRouter.register(a as any);
      return a;
    }

    const upload = (caller: Caller, bytes: Buffer, teamId?: string, name = 'checkout.ipa') => {
      const r = request(server(caller)).post('/apps/upload').attach('app', bytes, name);
      return teamId === undefined ? r : r.field('teamId', teamId);
    };
    const md5 = (bytes: Buffer) => createHash('md5').update(bytes).digest('hex');

    beforeEach(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-ci-app-store-'));
      configAppsPath = config.appsPath;
      config.appsPath = dir;
      await scratch.db.app.deleteMany({});
      await scratch.db.team.deleteMany({});
      await scratch.db.team.createMany({
        data: [
          { id: 'team-a', name: 'A' },
          { id: 'team-b', name: 'B' },
        ],
      });
    });

    afterEach(() => {
      config.appsPath = configAppsPath;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("stores a member's upload in their only team, with the IPA's identity", async () => {
      const ipa = await zipOf([['Payload/Checkout.app/Info.plist', bplistCreator(INFO)]]);
      const r = await upload(MEMBER_A, ipa);
      expect(r.status).to.equal(200);
      expect(r.body).to.include({
        teamId: 'team-a',
        platform: 'ios',
        packageName: 'com.acme.checkout',
        version: '2.4.1',
        buildNumber: '2041',
        md5: md5(ipa),
      });
    });

    it('lets a key with the apps scope alone upload, and refuses one with read alone', async () => {
      const bytes = Buffer.from('ci build');
      expect((await upload(CI_KEY_A, bytes)).status).to.equal(200);
      const refused = await upload(READ_KEY_A, Buffer.from('another'));
      expect(refused.status).to.equal(403);
      expect(refused.body).to.deep.equal({ error: 'insufficient scope' });
    });

    it("refuses a member another team, the shared pool, or a team they can't name", async () => {
      const bytes = Buffer.from('refused');
      const other = await upload(MEMBER_A, bytes, 'team-b');
      expect([other.status, other.body.error]).to.deep.equal([403, 'not_your_team']);
      const ghost = await upload(MEMBER_A, bytes, 'no-such-team');
      expect(ghost.body).to.deep.equal(other.body);
      const shared = await upload(MEMBER_A, bytes, '');
      expect([shared.status, shared.body.error]).to.deep.equal([403, 'shared_admin_only']);
      const several = await upload(MEMBER_AB, bytes);
      expect([several.status, several.body.error]).to.deep.equal([400, 'team_required']);
      const none = await upload(MEMBER_NONE, bytes);
      expect([none.status, none.body.error]).to.deep.equal([403, 'no_team']);
      expect(await scratch.db.app.count()).to.equal(0);
      expect(fs.readdirSync(dir)).to.deep.equal([]);
    });

    it('lets a member in several teams name one of theirs', async () => {
      const r = await upload(MEMBER_AB, Buffer.from('b build'), 'team-b');
      expect([r.status, r.body.teamId]).to.deep.equal([200, 'team-b']);
    });

    it('returns the app a member can see for bytes it already holds', async () => {
      const bytes = Buffer.from('same build');
      const first = await upload(MEMBER_A, bytes);
      const again = await upload(MEMBER_AB, bytes, 'team-b');
      expect(again.body.id).to.equal(first.body.id);
      expect(again.body.teamId).to.equal('team-a');
      expect(await scratch.db.app.count()).to.equal(1);
    });

    it("stores bytes only another team's app holds again, and shows nothing of that app", async () => {
      const bytes = Buffer.from('same build, two teams');
      const a = await upload(MEMBER_A, bytes, undefined, 'a-name.ipa');
      const b = await upload(MEMBER_B, bytes, undefined, 'b-name.ipa');
      expect(b.status).to.equal(200);
      expect(b.body.id).to.not.equal(a.body.id);
      expect(b.body).to.include({ teamId: 'team-b', name: 'b-name.ipa', md5: md5(bytes) });
      expect(JSON.stringify(b.body)).not.to.include('team-a');
      expect(b.body.filepath).to.not.equal(a.body.filepath);
      expect(fs.readFileSync(b.body.filepath).equals(bytes)).to.equal(true);
      // An admin, who sees both, gets the first one back rather than a third.
      const admin = await upload(ADMIN, bytes);
      expect(admin.body.id).to.equal(a.body.id);
      expect(await scratch.db.app.count()).to.equal(2);
    });

    it('looks a build up by md5, within what the caller can see', async () => {
      const bytes = Buffer.from('lookup build');
      await upload(MEMBER_A, bytes);
      await upload(MEMBER_B, bytes);
      const sum = md5(bytes);
      const asA = await request(server(MEMBER_A)).get(`/apps?md5=${sum}`);
      expect(asA.status).to.equal(200);
      expect(asA.body.map((app: any) => app.teamId)).to.deep.equal(['team-a']);
      const asAdmin = await request(server(ADMIN)).get(`/apps?md5=${sum.toUpperCase()}`);
      expect(asAdmin.body.map((app: any) => app.teamId).sort()).to.deep.equal(['team-a', 'team-b']);
      const none = await request(server(MEMBER_NONE)).get(`/apps?md5=${sum}`);
      expect(none.body).to.deep.equal([]);
      const unknown = await request(server(MEMBER_A)).get(`/apps?md5=${'0'.repeat(32)}`);
      expect(unknown.body).to.deep.equal([]);
      const bad = await request(server(MEMBER_A)).get('/apps?md5=nope');
      expect([bad.status, bad.body.error]).to.deep.equal([400, 'invalid_md5']);
    });

    it('answers 409 when an admin moves an app into a team that has the same file', async () => {
      const bytes = Buffer.from('moved build');
      const a = await upload(MEMBER_A, bytes);
      await upload(MEMBER_B, bytes);
      const r = await request(server(ADMIN))
        .put(`/apps/${a.body.id}/team`)
        .send({ teamId: 'team-b' });
      expect([r.status, r.body.error]).to.deep.equal([409, 'conflict']);
    });

    it('stores one app when two uploads of a build into one team race', async () => {
      const bytes = Buffer.from('raced build');
      const [one, two] = await Promise.all([upload(MEMBER_A, bytes), upload(CI_KEY_A, bytes)]);
      expect([one.status, two.status]).to.deep.equal([200, 200]);
      expect(two.body.id).to.equal(one.body.id);
      expect(await scratch.db.app.count()).to.equal(1);
      expect(fs.readdirSync(dir)).to.have.length(1);
    });

    it('upgrades a database without migration history with no data-loss prompt', () => {
      // A unique index over [md5, teamId] would make `prisma db push`, which
      // such a database starts with, refuse without --accept-data-loss.
      const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');
      const app = schema.slice(schema.indexOf('model App {'), schema.indexOf('model Device {'));
      expect(app).to.include('@@index([md5])');
      expect(app).not.to.match(/@@unique|md5\s+String\?\s+@unique/);
    });
  });
});
