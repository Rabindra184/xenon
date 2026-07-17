import { expect } from 'chai';
import sinon from 'sinon';
import { EventLogService } from '../../src/services/EventLogService';

describe('EventLogService', () => {
  function fakePrisma() {
    return { eventLog: { create: sinon.stub().resolves({}), deleteMany: sinon.stub().resolves({ count: 3 }) } };
  }

  it('appendSafe writes type + JSON payload asynchronously', async () => {
    const db = fakePrisma();
    const svc = new EventLogService({ client: db } as any);
    svc.appendSafe({ type: 'device_blocked', payload: { udid: 'U1' }, teamId: 't1' });
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget tick run
    expect(db.eventLog.create.calledOnce).to.equal(true);
    const arg = db.eventLog.create.firstCall.args[0].data;
    expect(arg.type).to.equal('device_blocked');
    expect(JSON.parse(arg.payload)).to.deep.equal({ udid: 'U1' });
  });

  it('appendSafe never throws even when the DB write fails', async () => {
    const db = fakePrisma();
    db.eventLog.create.rejects(new Error('disk full'));
    const svc = new EventLogService({ client: db } as any);
    expect(() => svc.appendSafe({ type: 'x', payload: {} })).to.not.throw();
    await new Promise((r) => setImmediate(r));
  });

  it('appendSafe degrades a circular payload to a placeholder instead of crashing', async () => {
    const db = fakePrisma();
    const svc = new EventLogService({ client: db } as any);
    const c: any = {};
    c.self = c;
    expect(() => svc.appendSafe({ type: 'device_blocked', payload: c })).to.not.throw();
    await new Promise((r) => setImmediate(r));
    expect(db.eventLog.create.calledOnce).to.equal(true);
    const arg = db.eventLog.create.firstCall.args[0].data;
    expect(JSON.parse(arg.payload)).to.deep.equal({ _unserializable: true, type: 'device_blocked' });
  });

  it('is a no-op when XENON_EVENT_LOG=off', async () => {
    process.env.XENON_EVENT_LOG = 'off';
    const db = fakePrisma();
    const svc = new EventLogService({ client: db } as any);
    svc.appendSafe({ type: 'x', payload: {} });
    await new Promise((r) => setImmediate(r));
    expect(db.eventLog.create.called).to.equal(false);
    delete process.env.XENON_EVENT_LOG;
  });

  it('prune deletes rows older than retention', async () => {
    const db = fakePrisma();
    const svc = new EventLogService({ client: db } as any);
    const n = await svc.prune(30);
    expect(n).to.equal(3);
    const where = db.eventLog.deleteMany.firstCall.args[0].where;
    expect(where.occurredAt.lt).to.be.a('date');
  });
});
