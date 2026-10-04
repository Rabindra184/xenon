import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import * as DeviceService from '../../src/data-service/device-service';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { PhoneNetworkRestore } from '../../src/services/network/PhoneNetworkRestore';
import { SocketServer } from '../../src/services/SocketServer';
import { MetricsService } from '../../src/services/MetricsService';
import { NotificationService } from '../../src/services/NotificationService';
import { AI_SERVICE } from '../../src/services/AIService';
import {
  UNEXPECTED_SHUTDOWN_REASON,
  unexpectedShutdownReason,
} from '../../src/services/session/shutdownReason';
import { prisma } from '../../src/prisma';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * A session Appium ends by itself reaches `XenonPlugin.onUnexpectedShutdown`
 * with a cause. For an idle session that is Appium's new-command timeout.
 * The plugin threw the cause away and recorded "Driver shut down
 * unexpectedly", which no failure pattern matches, so an idle session on this
 * server's own phones was filed UNKNOWN and its "Why it failed" card opened
 * the general runbook rather than the Timeout one.
 */

// What @appium/base-driver 10.2 passes when a session sits idle too long.
const IDLE =
  "New Command Timeout of 60 seconds expired. Try customizing the timeout using the 'newCommandTimeout' desired capability";

describe('the reason of a session Appium ends by itself', () => {
  it("is Appium's cause: its new-command timeout", () => {
    expect(unexpectedShutdownReason(new Error(IDLE))).to.equal(IDLE);
  });

  it("is a driver's own account of giving up, which still reads as one", () => {
    expect(unexpectedShutdownReason(new Error('The driver was unexpectedly shut down!'))).to.equal(
      'The driver was unexpectedly shut down!',
    );
  });

  it('is the old fixed reason when there is no cause to tell', () => {
    for (const cause of [undefined, null, new Error(''), new Error('   '), {}, 42]) {
      expect(unexpectedShutdownReason(cause), String(cause)).to.equal(UNEXPECTED_SHUTDOWN_REASON);
    }
    // The umbrella's placeholder when a driver gives none.
    expect(unexpectedShutdownReason(new Error('Unknown error'))).to.equal(
      UNEXPECTED_SHUTDOWN_REASON,
    );
  });

  it('is the message alone, never a stack', () => {
    const err = new Error(IDLE);
    expect(unexpectedShutdownReason(err)).not.to.contain('    at ');
  });
});

describe('a session Appium ends for being idle, on a hub that records sessions', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  let restoreRegs: () => void;
  let wasHub: boolean;

  const plugin = {
    pluginArgs: { enableDashboard: true },
    xenonLog: { withSession: () => ({ info() {} }) },
  };

  const seed = (id: string) =>
    scratch.db.session.create({
      data: {
        id,
        status: 'running',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'n-1',
        has_live_video: false,
        device_udid: 'R5CT',
        device_platform: 'android',
        device_version: '14',
      },
    });

  const shutDown = (id: string, cause: unknown) =>
    XenonPlugin.prototype.onUnexpectedShutdown.call(
      plugin as any,
      { sessionId: id, caps: { udid: 'R5CT' } },
      cause,
    );

  beforeEach(async () => {
    restoreRegs = saveRegistrations(
      PhoneNetworkRestore,
      SessionMetricsService,
      SocketServer,
      MetricsService,
      NotificationService,
    );
    Container.set(PhoneNetworkRestore, { restoreSession: sinon.stub().resolves() } as any);
    Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
    Container.set(SocketServer, {
      emitToDashboard: sinon.stub(),
      emitToDashboardForDevices: sinon.stub().resolves(),
      hasScopedDashboard: sinon.stub().returns(false),
    } as any);
    Container.set(MetricsService, {
      incrementSessionSuccess: sinon.stub(),
      incrementSessionFailure: sinon.stub(),
    } as any);
    Container.set(NotificationService, { notifySessionFailed: sinon.stub().resolves() } as any);
    sinon.stub(DeviceService, 'releaseSessionDevices').resolves();
    sinon
      .stub(DeviceStoreFactory, 'getStore')
      .returns({ getDevices: async () => [], findDevices: async () => [] } as any);
    sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
    sinon.stub(AI_SERVICE, 'isEnabled').returns(false);
    wasHub = XenonPlugin.IS_HUB;
    XenonPlugin.IS_HUB = true;
    await scratch.db.session.deleteMany({});
  });

  afterEach(() => {
    XenonPlugin.IS_HUB = wasHub;
    sinon.restore();
    restoreRegs();
  });

  it("is failed with Appium's reason and filed TIMEOUT", async () => {
    await seed('s-idle');

    await shutDown('s-idle', new Error(IDLE));

    const row = await prisma.session.findUnique({ where: { id: 's-idle' } });
    expect(row?.status).to.equal('failed');
    expect(row?.failure_reason).to.equal(IDLE);
    expect(row?.failure_category).to.equal('TIMEOUT');
  });

  it('keeps the old reason, filed UNKNOWN, when Appium gives no cause', async () => {
    await seed('s-crash');

    await shutDown('s-crash', undefined);

    const row = await prisma.session.findUnique({ where: { id: 's-crash' } });
    expect(row?.status).to.equal('failed');
    expect(row?.failure_reason).to.equal(UNEXPECTED_SHUTDOWN_REASON);
    expect(row?.failure_category).to.equal('UNKNOWN');
  });
});
