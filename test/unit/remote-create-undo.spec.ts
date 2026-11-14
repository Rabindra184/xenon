import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { Container } from 'typedi';
import { errors as appiumErrors } from '@appium/base-driver';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { HUB_TOKEN_HEADER, HubSessionTokenIssuer } from '../../src/gateway/hubSessionToken';
import { NodeBasePathResolver } from '../../src/gateway/nodeWebDriverUrl';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import { usePrismaStores } from '../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

/**
 * A create the hub forwarded to a node, which the node finished and the hub
 * couldn't, must not leave the session running on the node. Through 2.36 a
 * local create that lost its claim was undone (#612), but a remote one was
 * not: a lost claim was ignored, so the session ran on a phone the hub had
 * given to another session, and a throw after the node's answer was only
 * rethrown, leaving the session on the node until its idle timeout.
 */
describe('a remote create the hub cannot finish is ended on its node', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  usePrismaStores();
  useOwnNodeId();

  const UDID = 'node-phone-undo';
  const NODE_ID = 'another-node';
  const OURS = 1_700_000_000_000;
  const THEIRS = OURS + 11 * 60_000;

  let server: http.Server;
  let nodeOrigin: string;
  let deletes: { id: string; token: string | undefined }[];
  let deleteStatus: number;
  let restoreRegs: () => void;
  let savedContext: Record<string, unknown>;
  let svc: SessionLifecycleService;

  before(async () => {
    const node = express();
    node.use(express.json());
    node.get('/xenon/api/webdriver', (_req, res) => res.json({ basePath: '/node' }));
    node.post('/node/session', (_req, res) =>
      res.json({ value: { sessionId: nextSessionId, capabilities: { platformName: 'Android' } } }),
    );
    node.delete('/node/session/:id', (req, res) => {
      deletes.push({ id: req.params.id, token: req.header(HUB_TOKEN_HEADER) });
      res.status(deleteStatus).json({ value: deleteStatus === 200 ? null : { error: 'boom' } });
    });
    server = await new Promise<http.Server>((resolve) => {
      const s = node.listen(0, '127.0.0.1', () => resolve(s));
    });
    nodeOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  let nextSessionId = '';

  beforeEach(() => {
    deletes = [];
    deleteStatus = 200;
    restoreRegs = saveRegistrations(
      HubSessionTokenIssuer,
      NodeBasePathResolver,
      SessionMetricsService,
      SessionDeviceLogs,
    );
    const issuer = new HubSessionTokenIssuer();
    issuer.useSigner({
      sign: async (claims: Record<string, unknown>, opts: { audience: string }) =>
        `${opts.audience}:${claims.sid ?? claims.udid}`,
    } as any);
    Container.set(HubSessionTokenIssuer, issuer);
    Container.set(NodeBasePathResolver, new NodeBasePathResolver());
    Container.set(SessionMetricsService, { start: sinon.stub(), stop: sinon.stub() } as any);
    Container.set(SessionDeviceLogs, {
      start: sinon.stub().resolves(),
      stop: sinon.stub().resolves(),
    } as any);
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
    const context = Container.get(PluginContext);
    savedContext = { ...context };
    context.setContext(
      { ...DefaultPluginArgs, enableDashboard: false } as any,
      4723,
      OWN_NODE_ID,
      '',
    );
    svc = Container.get(SessionLifecycleService);
  });

  afterEach(async () => {
    Object.assign(Container.get(PluginContext), savedContext);
    sinon.restore();
    restoreRegs();
    await scratch.db.device.deleteMany({});
    await scratch.db.session.deleteMany({ where: { device_udid: UDID } });
  });

  async function phone(fields: Record<string, unknown>) {
    await scratch.db.device.create({
      data: {
        udid: UDID,
        host: nodeOrigin,
        nodeId: NODE_ID,
        platform: 'android',
        name: 'S9',
        busy: true,
        ...fields,
      } as any,
    });
  }

  const row = () =>
    scratch.db.device.findUnique({ where: { udid_host: { udid: UDID, host: nodeOrigin } } });

  async function create(sessionId: string) {
    nextSessionId = sessionId;
    const allocation = {
      caps: { alwaysMatch: { platformName: 'Android' }, firstMatch: [{}] },
      device: {
        udid: UDID,
        host: nodeOrigin,
        nodeId: NODE_ID,
        platform: 'android',
        name: 'S9',
        claimedAt: OURS,
      },
      remote: true,
      pendingSessionId: 'pending-remote-1',
      apiKeyId: null,
      userId: 'user-1',
      allocatedAt: OURS,
    };
    return svc.completeRemoteSession(allocation as any).then(
      () => undefined,
      (err) => err,
    );
  }

  describe('when another session claimed the phone while it was being created', () => {
    it("ends the node's session with the hub's token and answers session not created", async () => {
      await phone({ claimedAt: THEIRS, claimSessionId: null });

      const err = await create('r-late');

      expect(err, 'the create was expected to fail').to.be.instanceOf(
        appiumErrors.SessionNotCreatedError,
      );
      expect(err.message).to.include('given to another session');
      expect(deletes).to.deep.equal([{ id: 'r-late', token: 'xenon-node:r-late' }]);
      expect(SESSION_MANAGER.getSession('r-late')).to.equal(undefined);
    });

    it("leaves the other session's claim, and the phone, as they were", async () => {
      await phone({ claimedAt: THEIRS, claimSessionId: 'theirs' });

      await create('r-late');

      const after = await row();
      expect(after?.busy).to.equal(true);
      expect(Number(after?.claimedAt)).to.equal(THEIRS);
      expect(after?.claimSessionId).to.equal('theirs');
    });
  });

  describe('when a step after the node created the session throws', () => {
    beforeEach(() => {
      // The hub's record of the routed session, after it is in SESSION_MANAGER.
      sinon.stub(svc as any, 'recordRoutedSession').rejects(new Error('database is locked'));
    });

    it("ends the node's session, frees the hub's claim and forgets the session", async () => {
      await phone({ claimedAt: OURS, claimSessionId: null });

      const err = await create('r-half');

      expect(err).to.be.instanceOf(appiumErrors.SessionNotCreatedError);
      expect(err.message).to.include('database is locked');
      expect(deletes).to.deep.equal([{ id: 'r-half', token: 'xenon-node:r-half' }]);
      const after = await row();
      expect(after?.busy).to.equal(false);
      expect(after?.claimSessionId).to.equal(null);
      expect(after?.claimedAt).to.equal(null);
      expect(SESSION_MANAGER.getSession('r-half')).to.equal(undefined);
    });

    it('says so when the node would not end it, and still frees the claim', async () => {
      deleteStatus = 500;
      await phone({ claimedAt: OURS, claimSessionId: null });

      const err = await create('r-stuck');

      expect(err).to.be.instanceOf(appiumErrors.SessionNotCreatedError);
      expect(err.message).to.include('could not end it');
      expect(deletes.map((d) => d.id)).to.deep.equal(['r-stuck']);
      expect((await row())?.busy).to.equal(false);
    });
  });

  it('a create that finishes keeps its session on the node', async () => {
    await phone({ claimedAt: OURS, claimSessionId: null });

    const err = await create('r-ok');

    expect(err).to.equal(undefined);
    expect(deletes).to.deep.equal([]);
    expect((await row())?.claimSessionId).to.equal('r-ok');
    SESSION_MANAGER.removeSession('r-ok');
  });
});
