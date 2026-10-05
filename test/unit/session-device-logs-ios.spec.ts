import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { DEVICE_LOG_LINE_LIMIT } from '../../src/services/logcat/deviceLogBook';
import type { IDevice } from '../../src/interfaces/IDevice';
import { useScratchDatabase } from '../helpers/scratch-database';
import { ADMIN, selectorHealthApp } from '../helpers/selector-health-fixture';

// The driver's own log class (test/helpers/driver-log.ts): an iPhone's and a
// simulator's `logs.syslog` extend it, so what Xenon reads is what the driver keeps.
import { TestDriverLog } from '../helpers/driver-log';

// How the Device logs tab reads an iPhone line's level (web log-derive.ts).
const DASHBOARD_SYSLOG = /<(Error|Fault|Warning)>/;

class TestDeviceLogs extends SessionDeviceLogs {
  protected context() {
    return { pluginArgs: { bindHostOrIp: '127.0.0.1' }, port: 4723, nodeId: 'this-server' } as any;
  }
  protected flushIntervalMs() {
    return 60_000;
  }
}

const IPHONE: IDevice = {
  udid: '00008110-000A',
  platform: 'ios',
  realDevice: true,
  host: 'http://127.0.0.1:4723',
  nodeId: 'this-server',
} as IDevice;
const SIMULATOR: IDevice = { ...IPHONE, udid: 'SIM-1', realDevice: false } as IDevice;

const syslog = (n: number, level = 'Notice') =>
  `Oct  5 20:31:${String(n % 60).padStart(2, '0')} iPhone Shop[4127] <${level}>: line ${n}`;

async function deviceLogs(
  sessionId: string,
): Promise<Array<{ message: string; timestamp: string }>> {
  const res = await request(selectorHealthApp(ADMIN)).get(`/session/${sessionId}/logs/device`);
  expect(res.status, res.text).to.equal(200);
  return res.body;
}

describe("An iPhone or simulator session's Device logs", function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  let logs: TestDeviceLogs;
  let sessionId: string;
  let driverLog: TestDriverLog;
  let count = 0;

  beforeEach(async () => {
    count += 1;
    sessionId = `dl-ios-${count}`;
    await scratch.db.session.create({
      data: {
        id: sessionId,
        device_udid: IPHONE.udid,
        device_platform: 'ios',
        device_version: '26.0',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'this-server',
        has_live_video: false,
      },
    });
    logs = new TestDeviceLogs();
    driverLog = new TestDriverLog();
  });

  afterEach(async () => {
    await logs.stop(sessionId);
  });

  it('keeps the lines from the create and from the run, each once, in order', async () => {
    // Logged during the create, before Xenon could listen: in the driver's buffer.
    for (let i = 0; i < 3; i++) driverLog.line(syslog(i));
    await logs.start({ sessionId, device: IPHONE, since: Date.now() - 60_000, driverLog });
    for (let i = 3; i < 250; i++) driverLog.line(syslog(i));
    await logs.stop(sessionId);
    expect(driverLog.listenerCount('output')).to.equal(0);
    driverLog.line(syslog(999)); // after the session: not its line

    const rows = await deviceLogs(sessionId);
    expect(rows.map((r) => r.message)).to.deep.equal(
      Array.from({ length: 250 }, (_, i) => syslog(i)),
    );
  });

  it("leaves the driver's lines to the test that asks for them", async () => {
    driverLog.line(syslog(1));
    await logs.start({ sessionId, device: IPHONE, since: Date.now() - 60_000, driverLog });
    driverLog.line(syslog(2));
    await logs.stop(sessionId);

    const forTheTest = await driverLog.getLogs();
    expect(forTheTest.map((e: { message: string }) => e.message)).to.deep.equal([
      syslog(1),
      syslog(2),
    ]);
  });

  it("keeps each line's text, so Errors only finds the phone's errors, at the time it arrived", async () => {
    await logs.start({ sessionId, device: IPHONE, since: Date.now() - 60_000, driverLog });
    const before = Date.now();
    driverLog.line(syslog(1));
    driverLog.line(syslog(2, 'Error'));
    driverLog.line(syslog(3, 'Fault'));
    const after = Date.now();
    await logs.stop(sessionId);

    const rows = await deviceLogs(sessionId);
    expect(rows.map((r) => DASHBOARD_SYSLOG.exec(r.message)?.[1] ?? null)).to.deep.equal([
      null,
      'Error',
      'Fault',
    ]);
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      expect(t).to.be.within(before, after);
    }
  });

  it("records a simulator's compact lines, without `log stream`'s banner", async () => {
    driverLog.line('Filtering the log data using "subsystem != \\"com.apple.CoreTelephony\\""');
    driverLog.line('Timestamp               Ty Process[PID:TID]');
    await logs.start({ sessionId, device: SIMULATOR, since: Date.now() - 60_000, driverLog });
    driverLog.line('2026-10-05 20:31:40.123 F  Shop[4127:8812] Terminating app');
    driverLog.line('\tThread 0 Crashed:');
    await logs.stop(sessionId);

    expect((await deviceLogs(sessionId)).map((r) => r.message)).to.deep.equal([
      '2026-10-05 20:31:40.123 F  Shop[4127:8812] Terminating app',
      '\tThread 0 Crashed:',
    ]);
  });

  it('records nothing for a session that skips log capture', async () => {
    await logs.start({ sessionId, device: IPHONE, since: Date.now(), driverLog: undefined });

    expect(logs.isRecording(sessionId)).to.equal(false);
    expect(await deviceLogs(sessionId)).to.deep.equal([]);
  });

  it(`holds to the same limit as Android, ${DEVICE_LOG_LINE_LIMIT} lines then errors`, async () => {
    await logs.start({ sessionId, device: IPHONE, since: Date.now() - 60_000, driverLog });
    for (let i = 0; i < DEVICE_LOG_LINE_LIMIT + 100; i++) {
      driverLog.line(syslog(i, i >= DEVICE_LOG_LINE_LIMIT && i % 2 === 0 ? 'Error' : 'Notice'));
    }
    await logs.stop(sessionId);

    const rows = await deviceLogs(sessionId);
    expect(rows).to.have.length(DEVICE_LOG_LINE_LIMIT + 1 + 50 + 1);
    expect(rows[DEVICE_LOG_LINE_LIMIT].message).to.match(/^Xenon: This session reached 10,000/);
    expect(rows[rows.length - 1].message).to.match(/^Xenon: 50 device log lines were left out/);
  });

  it("doesn't record a node's iPhone, whose driver is the node's", () => {
    expect(logs.appliesTo(IPHONE)).to.equal(true);
    expect(logs.appliesTo(SIMULATOR)).to.equal(true);
    expect(logs.appliesTo({ ...IPHONE, nodeId: 'a-node' } as IDevice)).to.equal(false);
  });
});
