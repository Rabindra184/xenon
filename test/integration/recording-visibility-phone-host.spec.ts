import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
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
  // Two connected phones of one name: the hub's in team 1, the node's in team 2.
  const SPLIT = `emulator-split-${stamp}`;
  const G_SPLIT_HUB = `grp-split-hub-${stamp}`;
  const G_MINE_SPLIT_NODE = `grp-mine-split-node-${stamp}`;
  // Phones unplugged from the node: no Device row, only their DeviceSetting.
  // The other phone of the name, on the hub, is still connected.
  const UNPLUGGED_A = `emulator-unplugged-a-${stamp}`; // hub's in team 1
  const UNPLUGGED_B = `emulator-unplugged-b-${stamp}`; // hub's in team 2
  const NODE_C = 'http://node-c.test:4723';
  const G_UNPLUGGED_T2 = `grp-unplugged-t2-${stamp}`;
  const G_UNPLUGGED_T1 = `grp-unplugged-t1-${stamp}`;
  const G_UNPLUGGED_SHARED = `grp-unplugged-shared-${stamp}`;
  const G_MINE_UNPLUGGED_T2 = `grp-mine-unplugged-t2-${stamp}`;
  let videoDir: string;
  let video: string;

  before(async () => {
    videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-rec-video-'));
    video = path.join(videoDir, 'video.mp4');
    fs.writeFileSync(video, Buffer.from('not really an mp4'));
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
          file_path: video,
        } as any,
      });
    await rec(`r-hub-${stamp}`, G_HUB, UDID, HUB);
    await rec(`r-node-${stamp}`, G_NODE, UDID, NODE);
    // Alice's own recordings: of a phone no server has any more, and of the
    // hub's team-2 phone, which still exists.
    await rec(`r-gone-${stamp}`, G_GONE, UDID, GONE, alice.user.id);
    await rec(`r-mine-hub-${stamp}`, G_MINE_HUB, UDID, HUB, alice.user.id);
    await rec(`r-unique-${stamp}`, G_UNIQUE, UNIQUE, '127.0.0.1');

    await phone(SPLIT, HUB, t1.id);
    await phone(SPLIT, NODE, t2.id);
    await rec(`r-split-hub-${stamp}`, G_SPLIT_HUB, SPLIT, HUB);
    await rec(`r-mine-split-node-${stamp}`, G_MINE_SPLIT_NODE, SPLIT, NODE, alice.user.id);

    const setting = (udid: string, host: string, teamId: string | null) =>
      prisma.deviceSetting.create({ data: { udid, host, teamId } });
    await phone(UNPLUGGED_A, HUB, t1.id);
    await phone(UNPLUGGED_B, HUB, t2.id);
    await setting(UNPLUGGED_A, NODE, t2.id);
    await setting(UNPLUGGED_A, NODE_C, t1.id);
    await setting(UNPLUGGED_B, NODE, null);
    await setting(UNPLUGGED_B, NODE_C, t2.id);
    await rec(`r-unplugged-t2-${stamp}`, G_UNPLUGGED_T2, UNPLUGGED_A, NODE);
    await rec(`r-unplugged-t1-${stamp}`, G_UNPLUGGED_T1, UNPLUGGED_A, NODE_C);
    await rec(`r-unplugged-shared-${stamp}`, G_UNPLUGGED_SHARED, UNPLUGGED_B, NODE);
    await rec(
      `r-mine-unplugged-t2-${stamp}`,
      G_MINE_UNPLUGGED_T2,
      UNPLUGGED_B,
      NODE_C,
      alice.user.id,
    );
  });

  after(() => {
    fs.rmSync(videoDir, { recursive: true, force: true });
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    RecordingsRouter.register(app as any);
    return app;
  }

  const ALL_GROUPS = [
    G_HUB,
    G_NODE,
    G_GONE,
    G_MINE_HUB,
    G_UNIQUE,
    G_SPLIT_HUB,
    G_MINE_SPLIT_NODE,
    G_UNPLUGGED_T2,
    G_UNPLUGGED_T1,
    G_UNPLUGGED_SHARED,
    G_MINE_UNPLUGGED_T2,
  ];
  const groupsIn = (body: unknown) => {
    const text = JSON.stringify(body);
    return ALL_GROUPS.filter((g) => text.includes(`"${g}"`));
  };
  const sourceOf = (group: string, recordingId: string) =>
    request(buildApp())
      .get(`/recordings/${group}/source.mp4`)
      .query({ recordingId })
      .set('Cookie', alice.cookie);

  it('GET /recordings lists the shared phone recordings, never the team-2 phone of the same name', async () => {
    const r = await request(buildApp()).get('/recordings').set('Cookie', alice.cookie);
    expect(r.status).to.equal(200);
    expect(groupsIn(r.body).sort()).to.deep.equal(
      [
        G_GONE,
        G_NODE,
        G_UNIQUE,
        G_SPLIT_HUB,
        G_UNPLUGGED_T1,
        G_UNPLUGGED_SHARED,
        G_MINE_UNPLUGGED_T2,
      ].sort(),
    );
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

  describe('the one-recording reads (video, marks) carry the host', () => {
    it("serves the video of the team-1 phone, though another server's phone of the name is team 2's", async () => {
      const r = await sourceOf(G_SPLIT_HUB, `r-split-hub-${stamp}`);
      expect(r.status).to.equal(200);
    });

    it('takes a bookmark on the team-1 phone', async () => {
      const r = await request(buildApp())
        .post(`/recordings/${G_SPLIT_HUB}/bookmark`)
        .set('Cookie', alice.cookie)
        .send({ recordingId: `r-split-hub-${stamp}`, timecodeMs: 1000, label: 'here' });
      expect(r.status).to.not.equal(404);
    });

    it('stops the group of the team-1 phone (the group read carries the host)', async () => {
      const r = await request(buildApp())
        .post(`/recordings/${G_SPLIT_HUB}/stop`)
        .set('Cookie', alice.cookie);
      expect(r.status).to.not.equal(404);
    });

    it("hides the owner's video of a connected phone now in a team they can't see", async () => {
      const r = await sourceOf(G_MINE_SPLIT_NODE, `r-mine-split-node-${stamp}`);
      expect(r.status).to.equal(404);
      expect(r.body).to.deep.equal({ error: 'not_found' });
    });
  });

  describe("an unplugged phone is judged by its own setting's team", () => {
    it("hides a recording of a team-2 phone, though the name's connected phone is team 1's", async () => {
      const page = await request(buildApp())
        .get(`/recordings/${G_UNPLUGGED_T2}`)
        .set('Cookie', alice.cookie);
      expect(page.status).to.equal(404);
      const r = await sourceOf(G_UNPLUGGED_T2, `r-unplugged-t2-${stamp}`);
      expect(r.status).to.equal(404);
      expect(r.body).to.deep.equal({ error: 'not_found' });
    });

    it("shows a recording of a team-1 phone, whatever the other phone's team", async () => {
      const r = await sourceOf(G_UNPLUGGED_T1, `r-unplugged-t1-${stamp}`);
      expect(r.status).to.equal(200);
    });

    it("shows a recording of a shared-pool phone, though the name's connected phone is team 2's", async () => {
      const page = await request(buildApp())
        .get(`/recordings/${G_UNPLUGGED_SHARED}`)
        .set('Cookie', alice.cookie);
      expect(page.status).to.equal(200);
      const r = await sourceOf(G_UNPLUGGED_SHARED, `r-unplugged-shared-${stamp}`);
      expect(r.status).to.equal(200);
    });

    it('the owner keeps their recording of an unplugged phone, whatever team it was in', async () => {
      const page = await request(buildApp())
        .get(`/recordings/${G_MINE_UNPLUGGED_T2}`)
        .set('Cookie', alice.cookie);
      expect(page.status).to.equal(200);
      const r = await sourceOf(G_MINE_UNPLUGGED_T2, `r-mine-unplugged-t2-${stamp}`);
      expect(r.status).to.equal(200);
    });
  });
});
