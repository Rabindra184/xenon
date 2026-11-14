import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { errors as appiumErrors } from '@appium/base-driver';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { PhoneNetworkRestore } from '../../src/services/network/PhoneNetworkRestore';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { LiveSessionOwners } from '../../src/services/device-access/LiveSessionOwners';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import { usePrismaStores } from '../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

/**
 * A local create that Appium's driver finished and Xenon couldn't must not
 * leave a session running. Through 2.36:
 *
 * - A create that outlasted its pending claim (10 minutes, a first
 *   WebDriverAgent build) found its phone allocated to another session, and
 *   ran anyway: two sessions on one phone.
 * - A throw after the driver's create (the row write, the session's network)
 *   left the session half registered: the driver's session running, its claim
 *   held, its owner recorded.
 */
describe('a local create Xenon cannot finish is undone', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  usePrismaStores();
  useOwnNodeId();

  const HOST = 'http://127.0.0.1:4723';
  const UDID = 'R5CT-undo';
  const OURS = 1_700_000_000_000;
  const THEIRS = OURS + 11 * 60_000;

  let restoreRegs: () => void;
  let savedContext: Record<string, unknown>;
  let restoreLeftovers: sinon.SinonStub;
  let restoreSession: sinon.SinonStub;
  let metricsStop: sinon.SinonStub;
  let logsStop: sinon.SinonStub;
  let svc: SessionLifecycleService;

  function useContext(args: Record<string, unknown>) {
    Container.get(PluginContext).setContext(
      { ...DefaultPluginArgs, enableDashboard: false, ...args } as any,
      4723,
      OWN_NODE_ID,
      '',
    );
  }

  beforeEach(() => {
    restoreRegs = saveRegistrations(PhoneNetworkRestore, SessionMetricsService, SessionDeviceLogs);
    restoreLeftovers = sinon.stub().resolves();
    restoreSession = sinon.stub().resolves();
    metricsStop = sinon.stub().resolves();
    logsStop = sinon.stub().resolves();
    Container.set(PhoneNetworkRestore, {
      restoreLeftovers,
      restoreSession,
      restoreAll: sinon.stub().resolves(),
    } as any);
    Container.set(SessionMetricsService, { start: sinon.stub(), stop: metricsStop } as any);
    Container.set(SessionDeviceLogs, {
      start: sinon.stub().resolves(),
      stop: logsStop,
    } as any);
    const context = Container.get(PluginContext);
    savedContext = { ...context };
    useContext({});
    svc = Container.get(SessionLifecycleService);
  });

  afterEach(async () => {
    Object.assign(Container.get(PluginContext), savedContext);
    sinon.restore();
    restoreRegs();
    await scratch.db.device.deleteMany({});
    await scratch.db.portLease.deleteMany({});
  });

  async function phone(fields: Record<string, unknown>) {
    await scratch.db.device.create({
      data: {
        udid: UDID,
        host: HOST,
        nodeId: OWN_NODE_ID,
        platform: 'android',
        name: 'S9',
        busy: true,
        ...fields,
      } as any,
    });
  }

  async function row() {
    return scratch.db.device.findUnique({ where: { udid_host: { udid: UDID, host: HOST } } });
  }

  function allocation() {
    const caps: any = {
      alwaysMatch: { platformName: 'Android', 'xe:record_video': false },
      firstMatch: [{}],
    };
    return {
      caps,
      device: {
        udid: UDID,
        host: HOST,
        nodeId: OWN_NODE_ID,
        platform: 'android',
        name: 'S9',
        claimedAt: OURS,
      } as any,
      remote: false,
      pendingSessionId: 'pending-1',
      apiKeyId: null,
      userId: 'user-1',
      allocatedAt: OURS,
    };
  }

  /** The umbrella Appium hands a plugin's createSession, with its one session. */
  function umbrella(sessionId: string) {
    const sessions: Record<string, unknown> = { [sessionId]: {} };
    return {
      sessions,
      deleteSession: sinon.spy(async (id: string) => {
        delete sessions[id];
        return { protocol: 'W3C', value: null };
      }),
    };
  }

  async function create(sessionId: string, driver: any) {
    const a = allocation();
    const next = async () => ({ protocol: 'W3C', value: [sessionId, {}, 'W3C'] });
    return svc.completeLocalSession(a as any, next, driver, a.caps).then(
      () => undefined,
      (err) => err,
    );
  }

  describe('when another session claimed the phone while it was being created', () => {
    it('ends the driver session and answers session not created, naming why', async () => {
      await phone({ claimedAt: THEIRS, claimSessionId: null });
      const driver = umbrella('s-late');

      const err = await create('s-late', driver);

      expect(err, 'the create was expected to fail').to.be.instanceOf(
        appiumErrors.SessionNotCreatedError,
      );
      expect(err.message).to.include('given to another session');
      expect(driver.deleteSession.calledOnceWithExactly('s-late')).to.equal(true);
      expect(driver.sessions).to.not.have.property('s-late');
    });

    it("leaves the other session's claim, and the phone, as they were", async () => {
      await phone({ claimedAt: THEIRS, claimSessionId: null });

      await create('s-late', umbrella('s-late'));

      const after = await row();
      expect(after?.busy).to.equal(true);
      expect(Number(after?.claimedAt)).to.equal(THEIRS);
      expect(after?.claimSessionId).to.equal(null);
      expect(after?.session_id ?? null).to.equal(null);
    });

    it('keeps nothing of the session: no owner, nothing in SESSION_MANAGER', async () => {
      await phone({ claimedAt: THEIRS, claimSessionId: 'theirs' });

      await create('s-late', umbrella('s-late'));

      expect(Container.get(LiveSessionOwners).ownerOf('s-late')).to.equal(undefined);
      expect(SESSION_MANAGER.getSession('s-late')).to.equal(undefined);
      expect(restoreLeftovers.called, 'the network is never touched').to.equal(false);
    });
  });

  describe('when a step after the driver created the session throws', () => {
    beforeEach(() => {
      restoreLeftovers.rejects(new Error('database is locked'));
    });

    it('ends the driver session and answers session not created, with the reason', async () => {
      await phone({ claimedAt: OURS, claimSessionId: null });
      const driver = umbrella('s-half');

      const err = await create('s-half', driver);

      expect(err).to.be.instanceOf(appiumErrors.SessionNotCreatedError);
      expect(err.message).to.include('database is locked');
      expect(driver.deleteSession.calledOnceWithExactly('s-half')).to.equal(true);
    });

    it('frees the phone, forgets the owner and puts the network back', async () => {
      await phone({ claimedAt: OURS, claimSessionId: null });

      await create('s-half', umbrella('s-half'));

      const after = await row();
      expect(after?.busy).to.equal(false);
      expect(after?.claimSessionId).to.equal(null);
      expect(after?.claimedAt).to.equal(null);
      expect(Container.get(LiveSessionOwners).ownerOf('s-half')).to.equal(undefined);
      expect(SESSION_MANAGER.getSession('s-half')).to.equal(undefined);
      expect(restoreSession.calledWith('s-half')).to.equal(true);
    });

    it("stops a node's samplers for its hub", async () => {
      useContext({ hub: 'http://hub.test:4723' });
      await phone({ claimedAt: OURS, claimSessionId: null });

      await create('s-node', umbrella('s-node'));

      expect(metricsStop.calledWith('s-node')).to.equal(true);
      expect(logsStop.calledWith('s-node')).to.equal(true);
    });

    it('gives back the ports the create leased for the session, and no others', async () => {
      await phone({ claimedAt: OURS, claimSessionId: null });
      const now = Date.now();
      const lease = (port: number, leasedToUdid: string, extra: Record<string, unknown> = {}) =>
        scratch.db.portLease.create({
          data: {
            port,
            purpose: 'wda',
            leasedToUdid,
            leasedAt: now,
            expiresAt: now + 60_000,
            ...extra,
          },
        });
      await lease(31001, `create:${UDID}@${HOST}@${OURS}`);
      await lease(31002, UDID);
      await lease(31003, UDID, { purpose: 'systemPort', leaseId: 'lease-1' });

      await create('s-half', umbrella('s-half'));

      const left = await scratch.db.portLease.findMany({ orderBy: { port: 'asc' } });
      expect(left.map((r) => r.port)).to.deep.equal([31002, 31003]);
    });

    it('still undoes the rest when the driver cannot end the session', async () => {
      await phone({ claimedAt: OURS, claimSessionId: null });
      const driver = {
        deleteSession: sinon.stub().resolves({ protocol: 'W3C', error: new Error('gone') }),
      };

      const err = await create('s-half', driver);

      expect(err).to.be.instanceOf(appiumErrors.SessionNotCreatedError);
      expect((await row())?.busy).to.equal(false);
    });
  });

  it('a create that finishes keeps its session and its ports', async () => {
    await phone({ claimedAt: OURS, claimSessionId: null });
    const now = Date.now();
    await scratch.db.portLease.create({
      data: {
        port: 31004,
        purpose: 'wda',
        leasedToUdid: `create:${UDID}@${HOST}@${OURS}`,
        leasedAt: now,
        expiresAt: now + 60_000,
      },
    });
    const driver = umbrella('s-ok');

    const err = await create('s-ok', driver);

    expect(err).to.equal(undefined);
    expect(driver.deleteSession.called).to.equal(false);
    expect((await row())?.claimSessionId).to.equal('s-ok');
    const [own] = await scratch.db.portLease.findMany({ where: { port: 31004 } });
    expect(own.leasedToUdid, "the session's now").to.equal('session:s-ok');
    Container.get(LiveSessionOwners).forget('s-ok');
  });
});
