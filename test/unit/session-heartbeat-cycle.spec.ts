import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { useScratchDatabase } from '../helpers/scratch-database';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import {
  HEARTBEAT_PROBE_CONCURRENCY,
  SessionHeartbeatService,
} from '../../src/services/SessionHeartbeatService';

/** A probe the test answers when it likes. */
function slowProbe() {
  let answer!: (v: { isHealthy: boolean }) => void;
  const calls: number[] = [];
  const probe = () => {
    calls.push(Date.now());
    return new Promise<{ isHealthy: boolean }>((resolve) => (answer = resolve));
  };
  return { probe, calls, answer: (healthy = true) => answer({ isHealthy: healthy }) };
}

const fakeSession = (id: string, checkHealth: () => Promise<any>): any => ({
  getId: () => id,
  isStopping: false,
  stoppedAt: undefined,
  checkHealth,
});

async function until(check: () => Promise<boolean> | boolean, ms = 2_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

describe('SessionHeartbeatService: one cycle at a time, sessions probed side by side', () => {
  const scratch = useScratchDatabase();
  const A = 'hb-cycle-a';
  const B = 'hb-cycle-b';

  const row = (id: string) => ({
    id,
    status: 'running',
    desired_capabilities: '{}',
    session_capabilities: '{}',
    node_id: 'test-node',
    has_live_video: false,
    device_udid: `udid-${id}`,
    device_platform: 'android',
    device_version: '13',
    last_heartbeat_at: null,
  });

  beforeEach(async () => {
    for (const id of [A, B]) {
      await scratch.db.session.upsert({
        where: { id },
        create: row(id),
        update: { last_heartbeat_at: null, heartbeat_pid: null, heartbeat_host: null },
      });
    }
  });

  afterEach(() => sinon.restore());

  it('starts no second cycle while one is running: each session is probed once', async () => {
    const a = slowProbe();
    sinon.stub(SESSION_MANAGER, 'getAllSessions').returns([fakeSession(A, a.probe)]);
    const svc = new SessionHeartbeatService();

    const first = (svc as any).checkAllSessions();
    const second = (svc as any).checkAllSessions();
    expect(await until(() => a.calls.length > 0)).to.equal(true);
    // Let the second call run as far as it would.
    await new Promise((r) => setTimeout(r, 50));
    expect(a.calls).to.have.length(1);

    a.answer(false);
    await Promise.all([first, second]);
    // One failure counted, not two.
    expect((svc as any).failureCounts.get(A)).to.equal(1);
  });

  it('stamps every session this process holds before any probe answers', async () => {
    const a = slowProbe();
    const b = slowProbe();
    sinon
      .stub(SESSION_MANAGER, 'getAllSessions')
      .returns([fakeSession(A, a.probe), fakeSession(B, b.probe)]);
    const svc = new SessionHeartbeatService();

    const cycle = (svc as any).checkAllSessions();
    const stamped = await until(async () => {
      const rows = await scratch.db.session.findMany({
        where: { id: { in: [A, B] } },
        select: { last_heartbeat_at: true, heartbeat_pid: true },
      });
      return rows.length === 2 && rows.every((r) => r.last_heartbeat_at && r.heartbeat_pid);
    });
    expect(stamped, "a slow probe held back another session's stamp").to.equal(true);

    a.answer();
    b.answer();
    await cycle;
  });

  it('probes sessions side by side, not one after another', async () => {
    const a = slowProbe();
    const b = slowProbe();
    sinon
      .stub(SESSION_MANAGER, 'getAllSessions')
      .returns([fakeSession(A, a.probe), fakeSession(B, b.probe)]);
    const svc = new SessionHeartbeatService();

    const cycle = (svc as any).checkAllSessions();
    expect(await until(() => a.calls.length === 1 && b.calls.length === 1)).to.equal(true);

    a.answer();
    b.answer();
    await cycle;
  });

  it('runs the next cycle once the previous one has finished', async () => {
    let probes = 0;
    sinon.stub(SESSION_MANAGER, 'getAllSessions').returns([
      fakeSession(A, async () => {
        probes += 1;
        return { isHealthy: true };
      }),
    ]);
    const svc = new SessionHeartbeatService();
    await (svc as any).checkAllSessions();
    await (svc as any).checkAllSessions();
    expect(probes).to.equal(2);
  });

  it('still stamps on a tick that finds the last cycle running', async () => {
    const a = slowProbe();
    sinon.stub(SESSION_MANAGER, 'getAllSessions').returns([fakeSession(A, a.probe)]);
    const svc = new SessionHeartbeatService();

    const first = (svc as any).checkAllSessions();
    expect(await until(() => a.calls.length === 1)).to.equal(true);
    await scratch.db.session.update({ where: { id: A }, data: { last_heartbeat_at: null } });

    const second = (svc as any).checkAllSessions();
    const stamped = await until(async () => {
      const r = await scratch.db.session.findUnique({ where: { id: A } });
      return !!r?.last_heartbeat_at;
    });
    expect(stamped).to.equal(true);
    expect(a.calls).to.have.length(1);

    a.answer();
    await Promise.all([first, second]);
  });

  it(`probes at most ${HEARTBEAT_PROBE_CONCURRENCY} sessions at once`, async () => {
    const probes = Array.from({ length: HEARTBEAT_PROBE_CONCURRENCY + 2 }, () => slowProbe());
    sinon
      .stub(SESSION_MANAGER, 'getAllSessions')
      .returns(probes.map((p, i) => fakeSession(`hb-cap-${i}`, p.probe)));
    const svc = new SessionHeartbeatService();
    const started = () => probes.filter((p) => p.calls.length > 0).length;

    const cycle = (svc as any).checkAllSessions();
    expect(await until(() => started() === HEARTBEAT_PROBE_CONCURRENCY)).to.equal(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(started()).to.equal(HEARTBEAT_PROBE_CONCURRENCY);

    probes[0].answer();
    expect(await until(() => started() === HEARTBEAT_PROBE_CONCURRENCY + 1)).to.equal(true);
    probes.slice(1).forEach((p) => {
      if (p.calls.length === 0) return;
      p.answer();
    });
    expect(await until(() => started() === probes.length)).to.equal(true);
    probes.forEach((p) => p.answer());
    await cycle;
  });
});
