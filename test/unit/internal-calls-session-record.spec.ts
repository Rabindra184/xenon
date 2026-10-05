import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import { XenonPlugin } from '../../src/plugin';
import { commandAuthDeps, registerSessionGateway } from '../../src/app/registerCommandAuth';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { LocalSession } from '../../src/sessions/LocalSession';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { NotificationService } from '../../src/services/NotificationService';
import * as deviceService from '../../src/data-service/device-service';
import { SessionStatus } from '../../src/types/SessionStatus';
import { useScratchDatabase } from '../helpers/scratch-database';
import { usePrismaStores } from '../helpers/loki-stores';
import {
  FAKE_AUTOMATION,
  appiumBaseDriver,
  quietAppiumLogs,
  umbrellaWith,
} from '../helpers/appium-umbrella';

/**
 * Xenon's own calls to a session it runs, in Appium 3's own server(): Appium's
 * umbrella driver with Xenon's plugin and the production session gateway, on
 * a dashboard-on server, over a scratch database.
 *
 * A LocalSession asks its driver in-process first. When that fails it asks
 * again over HTTP, at `<basePath>/wd-internal/session/<id>/...` with the
 * per-process secret (gateway/internalCall.ts), and that request goes through
 * Appium's route, the umbrella and the plugin's `handle` like a test's.
 * Through 2.15 the plugin couldn't tell: the marker was on the Express request,
 * which `handle` is never given. So a performance recording's stop the driver
 * refused at the end of a session was recorded as a failed `execute` of the
 * session, and the session, whose own commands had all passed, ended failed:
 * "marked as FAILED due to error in command: execute", the driver's refusal
 * as its reason, failure analysis, a `session_failed` webhook. Observed on a
 * simulator on 2026-10-05; on an iPhone whenever the recording's start failed.
 */

const SESSION = 'internal-calls-session';
const UDID = 'iphone-1';
const BASE = '/wd/hub';
const REFUSAL = 'No Time Profiler recording was started on this device';

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** An iPhone driver as far as these calls go: it refuses the performance recording. */
function iPhoneLikeDriverClass(): any {
  const { BaseDriver, errors } = appiumBaseDriver();
  return class IPhoneLikeDriver extends BaseDriver {
    calls: string[] = [];
    pageSourceFailures = 0;

    async getUrl() {
      this.calls.push('getUrl');
      return 'https://app.example/';
    }

    async execute(script: string) {
      this.calls.push(`execute ${script}`);
      if (script === 'mobile: startPerfRecord' || script === 'mobile: stopPerfRecord') {
        throw new errors.UnknownError(REFUSAL);
      }
      return null;
    }

    async getPageSource() {
      this.calls.push('getPageSource');
      if (this.pageSourceFailures > 0) {
        this.pageSourceFailures--;
        throw new errors.UnknownError('The page source took too long');
      }
      return '<XCUIElementTypeApplication name="Shop"/>';
    }
  };
}

describe('Xenon’s own calls to a session (/wd-internal), in Appium 3’s own server()', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  usePrismaStores();

  let appiumLogs: { restore(): void };
  let server: http.Server;
  let url: string;
  let inner: any;
  let session: LocalSession;
  let notified: sinon.SinonStub;
  let isHubBefore: boolean;

  before(() => {
    appiumLogs = quietAppiumLogs();
  });
  after(() => appiumLogs.restore());

  beforeEach(async () => {
    // A hub or a standalone server, with the dashboard recording its sessions.
    isHubBefore = XenonPlugin.IS_HUB;
    XenonPlugin.IS_HUB = true;
    notified = sinon.stub(NotificationService.prototype, 'notifySessionFailed').resolves();
    await scratch.db.sessionLog.deleteMany({});
    await scratch.db.log.deleteMany({});
    await scratch.db.session.deleteMany({});

    const baseDriver = appiumBaseDriver();
    const umbrella = umbrellaWith([[XenonPlugin, 'xenon']]);
    umbrella.args.plugin = { xenon: { enableDashboard: true } };
    server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(umbrella),
      port: 0,
      hostname: '127.0.0.1',
      basePath: BASE,
      cliArgs: { basePath: BASE },
      serverUpdaters: [
        (app: any) =>
          registerSessionGateway(
            app,
            { basePath: BASE },
            commandAuthDeps({ enabled: () => false, authDisabled: () => false, logger: quiet }),
          ),
      ],
    });
    const port = (server.address() as { port: number }).port;
    url = `http://127.0.0.1:${port}`;
    // Where a LocalSession's loopback calls go: the server it runs on.
    Object.assign(umbrella.opts, { address: '127.0.0.1', port, basePath: BASE });

    // The session as Appium holds it once created.
    const Driver = iPhoneLikeDriverClass();
    inner = new Driver({}, false);
    inner.sessionId = SESSION;
    inner.caps = { platformName: 'iOS', automationName: FAKE_AUTOMATION, udid: UDID };
    inner.newCommandTimeoutMs = 0;
    umbrella.sessions[SESSION] = inner;

    // ... and as Xenon records it.
    await scratch.db.session.create({
      data: {
        id: SESSION,
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'node-1',
        has_live_video: false,
        device_udid: UDID,
        device_platform: 'ios',
        device_version: '18.0',
      },
    });
    session = new LocalSession({
      sessionId: SESSION,
      device: { udid: UDID, platform: 'ios', realDevice: true, host: url } as any,
      sessionResponse: {},
      xenonOption: {},
      driver: umbrella,
    });
    SESSION_MANAGER.addSession(SESSION, session);
  });

  afterEach(async () => {
    SESSION_MANAGER.removeSession(SESSION);
    XenonPlugin.IS_HUB = isHubBefore;
    sinon.restore();
    server.closeAllConnections();
    await new Promise<void>((resolve) => http.Server.prototype.close.call(server, () => resolve()));
  });

  /** The session's recorded commands, oldest first. */
  async function recorded() {
    const rows = await scratch.db.sessionLog.findMany({
      where: { session_id: SESSION },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({ command: row.command_name, failed: row.is_error }));
  }

  /** The session's end as every ending reaches it, and what its row says then. */
  async function end() {
    await DASHBORD_EVENT_MANAGER.onSessionStopped(SESSION);
    const row = await scratch.db.session.findUniqueOrThrow({ where: { id: SESSION } });
    return { status: row.status, reason: row.failure_reason };
  }

  /** A command the test sends, through the public route. */
  const testCommand = () => request(url).get(`${BASE}/session/${SESSION}/url`);

  it('a performance recording’s stop the driver refuses doesn’t fail a session whose commands all passed', async () => {
    await testCommand().expect(200);

    expect(await session.stopPerformanceRecording()).to.equal(null);

    // The stop was asked in-process, then over the loopback, which reached the driver.
    expect(inner.calls).to.deep.equal([
      'getUrl',
      'execute mobile: stopPerfRecord',
      'execute mobile: stopPerfRecord',
    ]);
    expect(await recorded()).to.deep.equal([{ command: 'getUrl', failed: false }]);
    expect(await end()).to.deep.equal({ status: SessionStatus.SUCCESS, reason: null });
    expect(notified.called, 'a session_failed webhook').to.equal(false);
  });

  it('nor does a refused start of the recording, at the session’s first moments', async () => {
    await session.startPerformanceRecording();

    expect(inner.calls).to.deep.equal([
      'execute mobile: startPerfRecord',
      'execute mobile: startPerfRecord',
    ]);
    await testCommand().expect(200);
    expect(await recorded()).to.deep.equal([{ command: 'getUrl', failed: false }]);
    expect(await end()).to.deep.equal({ status: SessionStatus.SUCCESS, reason: null });
  });

  it('a page source read over the loopback is not put in the session’s command log', async () => {
    inner.pageSourceFailures = 1;

    expect(await session.getPageSource()).to.equal('<XCUIElementTypeApplication name="Shop"/>');

    expect(inner.calls).to.deep.equal(['getPageSource', 'getPageSource']);
    expect(await recorded()).to.deep.equal([]);
  });

  it('a page source read that fails over the loopback too is not a failed command of the session', async () => {
    inner.pageSourceFailures = 2;

    await session.getPageSource().then(
      () => expect.fail('the read succeeded'),
      (error: any) => expect(error.response?.status).to.equal(500),
    );

    expect(inner.calls).to.deep.equal(['getPageSource', 'getPageSource']);
    expect(await recorded()).to.deep.equal([]);
    expect(await end()).to.deep.equal({ status: SessionStatus.SUCCESS, reason: null });
  });

  it('isn’t the session’s activity: only the test’s commands reset its idle clock', async () => {
    const touched = sinon.stub(deviceService, 'updateCmdExecutedTime').resolves();
    inner.pageSourceFailures = 1;

    await session.stopPerformanceRecording();
    await session.getPageSource();
    expect(inner.calls).to.have.length(4);
    expect(touched.called).to.equal(false);

    await testCommand().expect(200);
    expect(touched.calledOnceWith(SESSION)).to.equal(true);
  });

  it('the same refusal of the test’s own command is recorded and fails the session, as before', async () => {
    await request(url)
      .post(`${BASE}/session/${SESSION}/execute/sync`)
      .send({ script: 'mobile: stopPerfRecord', args: [{ profileName: 'Time Profiler' }] })
      .expect(500);

    expect(await recorded()).to.deep.equal([{ command: 'execute', failed: true }]);
    expect(await end()).to.deep.equal({ status: SessionStatus.FAILED, reason: REFUSAL });
    expect(notified.calledOnce, 'a session_failed webhook').to.equal(true);
  });
});
