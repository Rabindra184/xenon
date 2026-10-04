import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import * as assetManager from '../../src/dashboard/asset-manager';
import { dashboardCommands, sessionDetailsCommandOf } from '../../src/dashboard/commands';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SocketServer } from '../../src/services/SocketServer';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * The five execute commands that write to a session's record:
 * setSessionName, setSessionStatus, debug, addTag and captureEvidence.
 *
 * A session has a record (a Session row) only on a hub with its dashboard
 * on. Elsewhere (the dashboard off, or on a node, which never keeps one for
 * the hub's sessions) setSessionName and setSessionStatus threw Prisma's
 * P2025 and debug a foreign-key error, failing the test's command, while
 * addTag and captureEvidence answered as if they had worked.
 *
 * Each now answers `{ recorded: true }` when it wrote, or `{ recorded: false,
 * message }` saying why nothing was written. None of them fails the test's
 * command: they are bookkeeping, and a test shouldn't die because its server
 * keeps no dashboard.
 */
describe('xenon: session-details commands', () => {
  const scratch = useScratchDatabase();
  const SESSION = 'session-details-1';
  let restoreContainer: () => void;
  let emitted: sinon.SinonStub;

  beforeEach(async () => {
    await scratch.db.log.deleteMany({});
    await scratch.db.sessionLog.deleteMany({});
    await scratch.db.session.deleteMany({});
    restoreContainer = saveRegistrations(SocketServer);
    const socket = new SocketServer();
    Container.set(SocketServer, socket);
    emitted = sinon.stub(socket, 'emitToDashboardForDevices').resolves();
  });
  afterEach(() => {
    SESSION_MANAGER.removeSession(SESSION);
    sinon.restore();
    restoreContainer();
  });

  async function withRecord() {
    await scratch.db.session.create({
      data: {
        id: SESSION,
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'node-1',
        has_live_video: false,
        device_udid: 'phone-1',
        device_platform: 'android',
        device_version: '14',
      },
    });
  }

  /** What the command answers, as the local interceptor and the hub's gateway both see it. */
  async function run(script: string, args: unknown[]) {
    let body: any;
    const response = {
      status: (code: number) => ({
        json: (d: unknown) => {
          body = { code, ...(d as object) };
          return d;
        },
      }),
    };
    await dashboardCommands.process(SESSION, { body: { script, args } } as any, response as any);
    return body;
  }

  describe('which scripts are session-details commands', () => {
    it('knows the five, under either prefix, and nothing else', () => {
      expect(sessionDetailsCommandOf('xenon: setSessionName')).to.equal('setSessionName');
      expect(sessionDetailsCommandOf('xe:addTag')).to.equal('addTag');
      expect(sessionDetailsCommandOf(' xenon :  captureEvidence ')).to.equal('captureEvidence');
      for (const other of [
        'xenon: smartTap',
        'xe: setAutowaitProperties',
        'xenon: addMock',
        'xenon: unknownThing',
        'mobile: shell',
        'xenonsetSessionName',
        'return 1',
        undefined,
        42,
      ]) {
        expect(sessionDetailsCommandOf(other), String(other)).to.equal(null);
      }
    });
  });

  describe('with no session record', () => {
    const cases: Array<[string, unknown[]]> = [
      ['xenon: setSessionName', ['Checkout']],
      ['xenon: setSessionStatus', [{ status: 'passed' }]],
      ['xenon: debug', ['reached checkout']],
      ['xenon: addTag', ['smoke']],
      ['xenon: captureEvidence', ['Payment confirmed']],
    ];
    for (const [script, args] of cases) {
      it(`${script} answers that nothing was recorded, and writes nothing`, async () => {
        const body = await run(script, args);
        expect(body.code).to.equal(200);
        expect(body.value).to.include({ recorded: false });
        expect(body.value.message).to.match(/no record/i);
        expect(await scratch.db.log.count()).to.equal(0);
        expect(await scratch.db.sessionLog.count()).to.equal(0);
      });
    }
  });

  describe('with a session record', () => {
    beforeEach(withRecord);

    it('setSessionName names the session', async () => {
      expect((await run('xenon: setSessionName', ['Checkout'])).value).to.deep.equal({
        recorded: true,
      });
      expect((await scratch.db.session.findUnique({ where: { id: SESSION } }))?.name).to.equal(
        'Checkout',
      );
      await run('xe: setSessionName', [{ name: 'Checkout by card' }]);
      expect((await scratch.db.session.findUnique({ where: { id: SESSION } }))?.name).to.equal(
        'Checkout by card',
      );
    });

    it('setSessionName without a name records nothing, and says so', async () => {
      const body = await run('xenon: setSessionName', []);
      expect(body.value).to.include({ recorded: false });
      expect(body.value.message).to.match(/name/);
    });

    it('setSessionStatus sets the status and reason, and tells the dashboard', async () => {
      const body = await run('xenon: setSessionStatus', [{ status: 'failed', reason: 'No total' }]);
      expect(body.value).to.deep.equal({ recorded: true });
      const row = await scratch.db.session.findUnique({ where: { id: SESSION } });
      expect(row).to.include({ status: 'failed', failure_reason: 'No total' });
      expect(emitted.firstCall.args[1]).to.include({
        id: SESSION,
        status: 'failed',
        failure_reason: 'No total',
      });

      await run('xenon: setSessionStatus', ['passed']);
      expect((await scratch.db.session.findUnique({ where: { id: SESSION } }))?.status).to.equal(
        'success',
      );
    });

    it('setSessionStatus with a status it does not know records nothing, and says so', async () => {
      const body = await run('xenon: setSessionStatus', [{ status: 'skipped' }]);
      expect(body.value).to.include({ recorded: false });
      expect(body.value.message).to.match(/skipped/);
      expect((await scratch.db.session.findUnique({ where: { id: SESSION } }))?.status).to.equal(
        'running',
      );
    });

    it('debug adds a debug line', async () => {
      expect((await run('xenon: debug', ['reached checkout'])).value).to.deep.equal({
        recorded: true,
      });
      await run('xenon: debug', [{ message: 'paid' }]);
      const lines = await scratch.db.log.findMany({ orderBy: { createdAt: 'asc' } });
      expect(lines.map((l) => [l.log_type, l.message])).to.deep.equal([
        ['DEBUG', 'reached checkout'],
        ['DEBUG', 'paid'],
      ]);
    });

    it('debug without a message records nothing, and says so', async () => {
      const body = await run('xenon: debug', []);
      expect(body.value).to.include({ recorded: false });
      expect(await scratch.db.log.count()).to.equal(0);
    });

    it('addTag adds a tag once', async () => {
      expect((await run('xenon: addTag', ['smoke'])).value).to.deep.equal({ recorded: true });
      expect((await run('xenon: addTag', [{ tag: 'smoke' }])).value).to.deep.equal({
        recorded: true,
      });
      await run('xenon: addTag', ['regression']);
      const row = await scratch.db.session.findUnique({ where: { id: SESSION } });
      expect(JSON.parse(String(row?.tags))).to.deep.equal(['smoke', 'regression']);
    });

    it('captureEvidence records a screenshot of a session this server drives', async () => {
      SESSION_MANAGER.addSession(SESSION, { getScreenShot: async () => 'aGVsbG8=' } as any);
      sinon.stub(assetManager, 'saveScreenShot').returns(`${SESSION}/screenshots/x.png`);
      const body = await run('xenon: captureEvidence', [{ reason: 'Paid', label: 'receipt' }]);
      expect(body.value).to.deep.equal({ recorded: true });
      const rows = await scratch.db.sessionLog.findMany({});
      expect(rows.map((r) => [r.command_name, r.subtitle, r.screenshot])).to.deep.equal([
        ['captureEvidence', 'Paid', `${SESSION}/screenshots/x.png`],
      ]);
    });

    it("captureEvidence records nothing, and says so, when it can't take a screenshot", async () => {
      let body = await run('xenon: captureEvidence', ['Paid']);
      expect(body.value).to.include({ recorded: false });

      SESSION_MANAGER.addSession(SESSION, {
        getScreenShot: async () => {
          throw new Error('WDA is not running');
        },
      } as any);
      body = await run('xenon: captureEvidence', ['Paid']);
      expect(body.value).to.include({ recorded: false });
      expect(body.value.message).to.match(/WDA is not running/);
      expect(await scratch.db.sessionLog.count()).to.equal(0);
    });
  });
});
