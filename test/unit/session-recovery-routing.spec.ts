import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import { Container } from 'typedi';
import { SessionManager } from '../../src/sessions/SessionManager';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { devicesClearedAtBoot } from '../../src/device-managers/localDeviceHosts';
import SessionType from '../../src/enums/SessionType';
import { NodeBasePathResolver, webdriverInfoHandler } from '../../src/gateway/nodeWebDriverUrl';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * After a hub restart, SessionManager rebuilds the sessions still running on
 * nodes from the database, and the session gateway routes them from there.
 * A recovered session must point at its node's own base path, and a session
 * that ran on the hub's own phone (its driver died with the hub) must never be
 * rebuilt as a remote session pointing back at the hub.
 */
describe('recovering remote sessions after a hub restart', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  const loopback = loopbackServers();
  let restore: () => void;
  let savedStore: unknown;
  let nodeOrigin: string;
  const HUB = 'http://10.0.0.1:4724';

  beforeEach(async () => {
    restore = saveRegistrations(NodeBasePathResolver);
    Container.set(NodeBasePathResolver, new NodeBasePathResolver());
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    await scratch.db.session.deleteMany({});
    await scratch.db.device.deleteMany({});

    const node = express();
    node.get(
      '/xenon/api/webdriver',
      webdriverInfoHandler(() => '/node-base'),
    );
    const server = await loopback.serve(node);
    nodeOrigin = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterEach(async () => {
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    restore();
    await loopback.closeAll();
  });

  async function running(id: string, udid: string, host: string, nodeId: string) {
    await scratch.db.device.create({
      data: { udid, host, nodeId, platform: 'android', busy: true, session_id: id } as any,
    });
    await scratch.db.session.create({
      data: {
        id,
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: nodeId,
        has_live_video: false,
        device_udid: udid,
        device_platform: 'android',
        device_version: '14',
      },
    });
  }

  it("rebuilds a node's session under the node's own base path", async () => {
    await running('on-node', 'phone-n', nodeOrigin, 'node-1');
    const manager = new SessionManager();
    const recovered = await manager.recoverActiveSessions(
      'hub-new-id',
      '/wd/hub',
      (h) => h === HUB,
    );
    expect(recovered).to.equal(1);
    const session = manager.getSession('on-node') as any;
    expect(session.getType()).to.equal(SessionType.REMOTE);
    expect(session.getWebDriverUrl()).to.equal(`${nodeOrigin}/node-base`);
  });

  describe("the hub's boot", () => {
    const hubHosts = { origin: HUB, hosts: new Set([HUB]) };

    it("keeps a node's phone, so the session on it is recovered rather than failed", async () => {
      await running('on-node', 'phone-n', nodeOrigin, 'node-1');
      await running('on-hub', 'phone-h', HUB, 'hub-old-id');

      // What ServerManager does at boot, in order: clear, then recover.
      const cleared = devicesClearedAtBoot({ hub: undefined } as any, hubHosts);
      await DeviceStoreFactory.getStore().clearStorage(cleared);
      const left = await scratch.db.device.findMany({ select: { udid: true } });
      expect(left.map((d) => d.udid)).to.deep.equal(['phone-n']);

      const manager = new SessionManager();
      const recovered = await manager.recoverActiveSessions(
        'hub-new-id',
        '/wd/hub',
        (h) => h === HUB,
      );
      expect(recovered).to.equal(1);
      expect(manager.getSession('on-node')).to.not.equal(undefined);
      const hubRow = await scratch.db.session.findUnique({ where: { id: 'on-hub' } });
      expect(hubRow?.status).to.equal('failed');
    });

    it('a node still clears every phone it has, as before', () => {
      expect(devicesClearedAtBoot({ hub: 'http://hub:4724' } as any, hubHosts)).to.equal(undefined);
    });
  });

  it("marks a session on the hub's own phone failed, though its node id changed with the restart", async () => {
    await running('on-hub', 'phone-h', HUB, 'hub-old-id');
    const manager = new SessionManager();
    const recovered = await manager.recoverActiveSessions(
      'hub-new-id',
      '/wd/hub',
      (h) => h === HUB,
    );
    expect(recovered).to.equal(0);
    expect(manager.getSession('on-hub')).to.equal(undefined);
    const row = await scratch.db.session.findUnique({ where: { id: 'on-hub' } });
    expect(row?.status).to.equal('failed');
  });
});
