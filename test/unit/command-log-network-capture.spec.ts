import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import DashboardRouter from '../../src/app/routers/dashboard';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { NETWORK_CAPTURE_NOT_KEPT } from '../../src/dashboard/commandLogFields';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { SocketServer } from '../../src/services/SocketServer';
import { Container } from 'typedi';
import { useScratchDatabase } from '../helpers/scratch-database';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A session's network capture (its requests, its HAR, its mocks) is for admins
 * only: the /interceptor routes, the Network panel and the live events. The
 * command log is read by anyone who can see the session (`session_log`, bug
 * reports). A hub records every command it forwards to a node, so a test's own
 * `xenon: exportHar` put the whole capture, sign-in headers included, in front
 * of every member of the phone's team.
 */
describe('The command log keeps no network capture', () => {
  const scratch = useScratchDatabase();
  const SESSION = 'cl-session-1';
  const SECRET = 'eyJ-app-access-token';
  const HAR = {
    log: {
      entries: [{ request: { headers: [{ name: 'authorization', value: `Bearer ${SECRET}` }] } }],
    },
  };

  let restore: () => void;

  beforeEach(async () => {
    restore = saveRegistrations(SocketServer);
    Container.set(SocketServer, {
      emitToDashboardForDevices: async () => undefined,
      hasScopedDashboard: () => false,
    } as any);
    await scratch.db.sessionLog.deleteMany({});
    await scratch.db.session.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.team.deleteMany({});
    await scratch.db.team.create({ data: { id: 'team-a', name: 'Team A' } });
    await scratch.db.device.create({
      data: {
        udid: 'cl-phone-a',
        host: 'http://node:4723',
        platform: 'android',
        teamId: 'team-a',
      } as any,
    });
    await scratch.db.session.create({
      data: {
        id: SESSION,
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'node-1',
        has_live_video: false,
        device_udid: 'cl-phone-a',
        device_platform: 'android',
        device_version: '14',
      },
    });
    sinon.stub(SESSION_MANAGER, 'getSession').returns({
      getId: () => SESSION,
      getDevice: () => ({ udid: 'cl-phone-a', name: 'P', platform: 'android' }),
      getXenonOption: () => undefined,
      getScreenShot: async () => '',
    } as any);
    sinon.stub(SelectorStateService.prototype, 'onHealRecorded').resolves(null);
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  /** A command as the hub's gateway hands it over: the client's W3C body and the node's answer. */
  function forwarded(script: string, args: unknown[], answer: unknown) {
    return DASHBORD_EVENT_MANAGER.afterSessionCommand(
      SESSION,
      'execute',
      null,
      {
        body: { script, args },
        method: 'POST',
        originalUrl: `/wd/hub/session/${SESSION}/execute/sync`,
      } as any,
      {} as any,
      JSON.stringify(answer),
    );
  }

  /** What a member of the phone's team reads. */
  async function sessionLogAsMember() {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user-session',
        userId: 'cl-u-member',
        role: 'MEMBER',
        scopes: 'devices,sessions,read',
        teamIds: ['team-a'],
      };
      next();
    });
    DashboardRouter.register(app as never);
    const res = await request(app).get(`/session/${SESSION}/session_log`);
    expect(res.status).to.equal(200);
    return res.body as Array<{ body: string | null; response: string; is_success: boolean }>;
  }

  it('records which network script ran and whether it worked, never its arguments or its answer', async () => {
    await forwarded('xenon: exportHar', [], { value: HAR });
    await forwarded('xe:getRequests', [], { value: [HAR] });
    await forwarded('getMocks', [], { value: [{ respond: { body: { token: SECRET } } }] });
    await forwarded('xenon: addMock', [{ respond: { body: { token: SECRET } } }], {
      value: { id: 'm1' },
    });
    await forwarded('xenon: removeMock', [{ id: 'm1' }], { value: { removed: true } });
    await forwarded('xenon: clearMocks', [], { value: { ok: true } });

    const rows = await sessionLogAsMember();
    expect(rows).to.have.length(6);
    for (const row of rows) {
      expect(`${row.body}${row.response}`).to.not.include(SECRET);
      expect(row.is_success).to.equal(true);
      // Every one, removeMock and clearMocks included, whose answers hold no secret.
      expect(JSON.parse(row.response), row.body ?? '').to.deep.equal({
        value: NETWORK_CAPTURE_NOT_KEPT,
      });
      expect(JSON.parse(row.body ?? '{}').args).to.equal(NETWORK_CAPTURE_NOT_KEPT);
    }
    expect(rows.map((r) => JSON.parse(r.body ?? '{}').script)).to.have.members([
      'xenon: exportHar',
      'xe:getRequests',
      'getMocks',
      'xenon: addMock',
      'xenon: removeMock',
      'xenon: clearMocks',
    ]);
  });

  it('keeps a failed network script’s error, which carries no capture', async () => {
    const error = {
      value: {
        error: 'unknown error',
        message: `Interceptor not active for session ${SESSION}`,
        stacktrace: '',
      },
    };
    await forwarded('xenon: exportHar', [], error);
    const [row] = await sessionLogAsMember();
    expect(row.is_success).to.equal(false);
    expect(JSON.parse(row.response)).to.deep.equal(error);
  });

  it('on the server that drives the phone, a failed network script keeps its error but not its arguments', async () => {
    // CommandInterceptor answers these scripts before its hooks; only a throw
    // (no capture running) reaches the log, from its catch, with the
    // command's arguments as they came: [script, args].
    const error = {
      value: { error: `Interceptor not active for session ${SESSION}` },
      sessionId: SESSION,
    };
    await DASHBORD_EVENT_MANAGER.afterSessionCommand(
      SESSION,
      'execute',
      null,
      {
        body: ['xenon: addMock', [{ respond: { body: { token: SECRET } } }]],
        method: 'POST',
        originalUrl: '/execute',
      } as any,
      {} as any,
      JSON.stringify(error),
    );
    const [row] = await sessionLogAsMember();
    expect(row.body).to.not.include(SECRET);
    expect(JSON.parse(row.body ?? '[]')[0]).to.equal('xenon: addMock');
    expect(JSON.parse(row.response)).to.deep.equal(error);
    expect(row.is_success).to.equal(false);
  });

  it('logs every other script, and a script the node’s interceptor doesn’t answer, whole', async () => {
    // `plugin:` is only the autowait commands' prefix: `plugin: exportHar` is
    // never a network script, and its answer is the driver's.
    await forwarded('mobile: shell', [{ command: 'echo' }], { value: SECRET });
    await forwarded('plugin: exportHar', [], { value: SECRET });
    const rows = await sessionLogAsMember();
    expect(rows).to.have.length(2);
    for (const row of rows) expect(row.response).to.include(SECRET);
  });
});
