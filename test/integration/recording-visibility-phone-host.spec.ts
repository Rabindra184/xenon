import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import RecordingsRouter from '../../src/app/routers/recordings';
import { Container } from 'typedi';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { useArtifactStore } from '../helpers/artifact-store';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * Two servers name a phone alike (a hub's own emulator-5554 and its node's).
 * A recording is of one of them, so its visibility is that phone's team, never
 * the other same-named phone's.
 */
describe('recording reads decide visibility by udid and host (integration)', function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });
  useArtifactStore();
  let alice: SeededUser;

  const stamp = Date.now();
  const UDID = `emulator-${stamp}`;
  const HUB = 'http://hub.test:4723';
  const NODE = 'http://node.test:4723';
  const GONE = 'http://gone.test:4723';
  const UNIQUE = `unique-${stamp}`;
  const G_HUB = `grp-hub-${stamp}`;
  const G_NODE = `grp-node-${stamp}`;
  const G_GONE = `grp-gone-${stamp}`;
  const G_MINE_HUB = `grp-mine-hub-${stamp}`;
  const G_UNIQUE = `grp-unique-${stamp}`;

  before(async () => {
    alice = await seedUser('MEMBER', { name: 'Alice (team 1)' });
    const t1 = await Container.get(TeamService).create(`ph-rec-t1-${stamp}`);
    const t2 = await Container.get(TeamService).create(`ph-rec-t2-${stamp}`);
    await Container.get(TeamService).addMember(t1.id, alice.user.id);

    const phone = (udid: string, host: string, teamId: string | null) =>
      prisma.device.create({
        data: { udid, host, name: udid, platform: 'android', teamId } as any,
      });
    // The hub's own emulator is team 2's; the node's, of the same name, is shared.
    await phone(UDID, HUB, t2.id);
    await phone(UDID, NODE, null);
    // A phone only one server has, filed under another host than its rows say.
    await phone(UNIQUE, 'localhost', null);

    const rec = (id: string, group: string, udid: string, host: string, startedBy?: string) =>
      prisma.recording.create({
        data: {
          id,
          group_id: group,
          device_udid: udid,
          device_host: host,
          started_at: new Date(),
          started_by: startedBy ?? null,
          status: 'STOPPED',
          file_path: '/tmp/test.mp4',
        } as any,
      });
    await rec(`r-hub-${stamp}`, G_HUB, UDID, HUB);
    await rec(`r-node-${stamp}`, G_NODE, UDID, NODE);
    // Alice's own recordings: of a phone no server has any more, and of the
    // hub's team-2 phone, which still exists.
    await rec(`r-gone-${stamp}`, G_GONE, UDID, GONE, alice.user.id);
    await rec(`r-mine-hub-${stamp}`, G_MINE_HUB, UDID, HUB, alice.user.id);
    await rec(`r-unique-${stamp}`, G_UNIQUE, UNIQUE, '127.0.0.1');
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    RecordingsRouter.register(app as any);
    return app;
  }

  const groupsIn = (body: unknown) => {
    const text = JSON.stringify(body);
    return [G_HUB, G_NODE, G_GONE, G_MINE_HUB, G_UNIQUE].filter((g) => text.includes(`"${g}"`));
  };

  it('GET /recordings lists the shared phone recordings, never the team-2 phone of the same name', async () => {
    const r = await request(buildApp()).get('/recordings').set('Cookie', alice.cookie);
    expect(r.status).to.equal(200);
    expect(groupsIn(r.body).sort()).to.deep.equal([G_GONE, G_NODE, G_UNIQUE].sort());
  });

  it('the group page of the team-2 phone is the unknown answer', async () => {
    const r = await request(buildApp()).get(`/recordings/${G_HUB}`).set('Cookie', alice.cookie);
    expect(r.status).to.equal(404);
  });

  it('the group page of the shared phone of the same name opens', async () => {
    const r = await request(buildApp()).get(`/recordings/${G_NODE}`).set('Cookie', alice.cookie);
    expect(r.status).to.equal(200);
  });

  it('the owner keeps their recording of a phone gone from its host, though the name lives on elsewhere', async () => {
    const r = await request(buildApp()).get(`/recordings/${G_GONE}`).set('Cookie', alice.cookie);
    expect(r.status).to.equal(200);
  });

  it("the owner's recording of the team-2 phone stays hidden while that phone exists", async () => {
    const r = await request(buildApp())
      .get(`/recordings/${G_MINE_HUB}`)
      .set('Cookie', alice.cookie);
    expect(r.status).to.equal(404);
  });

  it('a phone only one server has is decided by its row, whatever host the recording names', async () => {
    const r = await request(buildApp()).get(`/recordings/${G_UNIQUE}`).set('Cookie', alice.cookie);
    expect(r.status).to.equal(200);
  });
});
