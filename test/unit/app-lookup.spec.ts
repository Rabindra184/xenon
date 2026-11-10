import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import AppsRouter from '../../src/app/routers/apps';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * CI finds the build to test without knowing its id:
 * `GET /xenon/api/apps?packageName=&platform=&latest=true`. The answer keeps
 * the list's shape (an array, each with its team and appUrl) and the team
 * rule: a member never gets another team's app, even when it is newer.
 */
describe('Looking up the latest build', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();

  type Caller = { role: string; scopes: string; teamIds?: string[] };
  const MEMBER_A: Caller = { role: 'MEMBER', scopes: scopesForRole('MEMBER'), teamIds: ['team-a'] };
  const ADMIN: Caller = { role: 'ADMIN', scopes: scopesForRole('ADMIN'), teamIds: undefined };

  function get(caller: Caller, query: string) {
    const a = express();
    a.use(express.json());
    a.use((req: any, _res, next) => {
      req.auth = { kind: 'api-key', userId: 'u', rateLimit: 300, ...caller };
      next();
    });
    AppsRouter.register(a as any);
    return request(a).get(`/apps${query}`);
  }

  const at = (minute: number) => new Date(Date.UTC(2026, 10, 9, 12, minute));
  const row = (
    id: string,
    packageName: string,
    platform: string,
    teamId: string | null,
    minute: number,
  ) => ({
    id,
    name: `${id}.bin`,
    filename: `${id}.bin`,
    filepath: `/apps/${id}`,
    mimetype: 'x',
    size: 1,
    packageName,
    platform,
    md5: id
      .padEnd(32, '0')
      .slice(0, 32)
      .replace(/[^0-9a-f]/g, 'a'),
    teamId,
    createdAt: at(minute),
  });

  before(async () => {
    await scratch.db.app.deleteMany({});
    await scratch.db.team.deleteMany({});
    await scratch.db.team.createMany({
      data: [
        { id: 'team-a', name: 'A' },
        { id: 'team-b', name: 'B' },
      ],
    });
    await scratch.db.app.createMany({
      data: [
        row('shop-android-1', 'com.acme.shop', 'android', 'team-a', 1),
        row('shop-android-2', 'com.acme.shop', 'android', 'team-a', 2),
        row('shop-ios-1', 'com.acme.shop', 'ios', null, 3),
        // Newest of all, but another team's: member A never sees it.
        row('shop-android-b', 'com.acme.shop', 'android', 'team-b', 9),
        row('pay-android-1', 'com.acme.pay', 'android', null, 5),
      ],
    });
  });

  it('narrows by packageName and platform, newest first', async () => {
    const r = await get(MEMBER_A, '?packageName=com.acme.shop&platform=android');
    expect(r.status).to.equal(200);
    expect(r.body.map((a: any) => a.id)).to.deep.equal(['shop-android-2', 'shop-android-1']);
  });

  it('latest=true answers the newest the caller can see, as a one-element array', async () => {
    const r = await get(MEMBER_A, '?packageName=com.acme.shop&platform=android&latest=true');
    expect(r.status).to.equal(200);
    expect(r.body).to.have.length(1);
    expect(r.body[0]).to.include({
      id: 'shop-android-2',
      teamId: 'team-a',
      appUrl: 'xenon://shop-android-2',
    });
    expect(r.body[0].team).to.deep.equal({ id: 'team-a', name: 'A' });
  });

  it("an admin's latest is the newest of every team's", async () => {
    const r = await get(ADMIN, '?packageName=com.acme.shop&latest=true');
    expect(r.body.map((a: any) => a.id)).to.deep.equal(['shop-android-b']);
  });

  it('latest=true with no filter is the newest app the caller can see', async () => {
    const r = await get(MEMBER_A, '?latest=true');
    expect(r.body.map((a: any) => a.id)).to.deep.equal(['pay-android-1']);
  });

  it('answers an empty array when nothing matches', async () => {
    const r = await get(MEMBER_A, '?packageName=com.nobody&latest=true');
    expect([r.status, r.body]).to.deep.equal([200, []]);
  });

  it('latest=false is the whole list', async () => {
    const r = await get(MEMBER_A, '?platform=ios&latest=false');
    expect(r.body.map((a: any) => a.id)).to.deep.equal(['shop-ios-1']);
  });

  it('combines with md5', async () => {
    const { md5 } = row('shop-ios-1', '', '', null, 0);
    const r = await get(MEMBER_A, `?md5=${md5}&platform=ios`);
    expect(r.body.map((a: any) => a.id)).to.deep.equal(['shop-ios-1']);
    const none = await get(MEMBER_A, `?md5=${md5}&platform=android`);
    expect(none.body).to.deep.equal([]);
  });

  for (const [why, query, error] of [
    ['a platform that is neither', '?platform=windows', 'invalid_platform'],
    ['a latest that is neither true nor false', '?latest=yes', 'invalid_latest'],
    ['an empty packageName', '?packageName=', 'invalid_package_name'],
    ['packageName given twice', '?packageName=a&packageName=b', 'invalid_package_name'],
    ['platform given twice', '?platform=ios&platform=android', 'invalid_platform'],
    ['a malformed md5', '?md5=nope', 'invalid_md5'],
  ] as const) {
    it(`refuses ${why} with 400`, async () => {
      const r = await get(MEMBER_A, query);
      expect([r.status, r.body.error]).to.deep.equal([400, error]);
    });
  }
});
