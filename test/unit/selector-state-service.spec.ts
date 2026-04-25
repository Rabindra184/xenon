import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  SelectorStateService,
  SelectorStateConflictError,
} from '../../src/services/SelectorStateService';
import { SocketEvents } from '../../src/enums/SocketEvents';

/**
 * Build a Sinon-backed prisma double that exposes the methods we use on
 * `prisma.selectorState`. Each method is a stub so individual tests can set
 * the resolved value explicitly.
 */
function buildPrismaStub() {
  return {
    selectorState: {
      findUnique: sinon.stub(),
      upsert: sinon.stub(),
      update: sinon.stub(),
      delete: sinon.stub(),
    },
  };
}

function buildSocketStub() {
  return {
    emitToDashboard: sinon.stub(),
  };
}

const STRATEGY = 'accessibility id';
const SELECTOR = 'login-button';
const API_KEY_ID = 'apikey-uuid-1';
const SESSION_ID = 'session-uuid-1';

function makeRow(overrides: Partial<any> = {}) {
  return {
    id: 'row-1',
    original_strategy: STRATEGY,
    original_selector: SELECTOR,
    status: 'active',
    fixed_at: null,
    fixed_by_api_key: null,
    resolved_at: null,
    muted_at: null,
    muted_by_api_key: null,
    regression_count: 0,
    clean_builds_count: 0,
    last_event_at: new Date('2026-04-25T00:00:00.000Z'),
    createdAt: new Date('2026-04-25T00:00:00.000Z'),
    updatedAt: new Date('2026-04-25T00:00:00.000Z'),
    ...overrides,
  };
}

describe('SelectorStateService', () => {
  let prismaStub: ReturnType<typeof buildPrismaStub>;
  let socketStub: ReturnType<typeof buildSocketStub>;
  let svc: SelectorStateService;

  beforeEach(() => {
    prismaStub = buildPrismaStub();
    socketStub = buildSocketStub();
    svc = new SelectorStateService(prismaStub as any, socketStub as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('markFixed', () => {
    it('upserts row to status=pending with fixed_at set', async () => {
      prismaStub.selectorState.findUnique.resolves(null);
      const upsertedRow = makeRow({
        status: 'pending',
        fixed_at: new Date('2026-04-25T01:00:00.000Z'),
        fixed_by_api_key: API_KEY_ID,
      });
      prismaStub.selectorState.upsert.resolves(upsertedRow);

      await svc.markFixed({
        strategy: STRATEGY,
        selector: SELECTOR,
        apiKeyId: API_KEY_ID,
      });

      expect(prismaStub.selectorState.upsert.calledOnce).to.equal(true);
      const args = prismaStub.selectorState.upsert.firstCall.args[0];
      expect(args.where).to.deep.equal({
        original_strategy_original_selector: {
          original_strategy: STRATEGY,
          original_selector: SELECTOR,
        },
      });
      expect(args.create.status).to.equal('pending');
      expect(args.create.fixed_by_api_key).to.equal(API_KEY_ID);
      expect(args.create.clean_builds_count).to.equal(0);
      expect(args.create.fixed_at).to.be.instanceOf(Date);
      expect(args.update.status).to.equal('pending');
      expect(args.update.fixed_by_api_key).to.equal(API_KEY_ID);
      expect(args.update.clean_builds_count).to.equal(0);
      expect(args.update.resolved_at).to.equal(null);
      expect(args.update.fixed_at).to.be.instanceOf(Date);
    });

    it('emits SELECTOR_FIXED socket event with serialized payload', async () => {
      prismaStub.selectorState.findUnique.resolves(null);
      const upsertedRow = makeRow({
        status: 'pending',
        fixed_at: new Date('2026-04-25T01:00:00.000Z'),
        fixed_by_api_key: API_KEY_ID,
      });
      prismaStub.selectorState.upsert.resolves(upsertedRow);

      await svc.markFixed({
        strategy: STRATEGY,
        selector: SELECTOR,
        apiKeyId: API_KEY_ID,
      });

      expect(socketStub.emitToDashboard.calledOnce).to.equal(true);
      const [event, payload] = socketStub.emitToDashboard.firstCall.args;
      expect(event).to.equal(SocketEvents.SELECTOR_FIXED);
      expect(payload).to.include({
        original_strategy: STRATEGY,
        original_selector: SELECTOR,
        status: 'pending',
        fixed_by_api_key: API_KEY_ID,
      });
      // ISO timestamp serialization
      expect(payload.fixed_at).to.equal('2026-04-25T01:00:00.000Z');
    });

    it('throws SelectorStateConflictError when current status is muted', async () => {
      prismaStub.selectorState.findUnique.resolves(makeRow({ status: 'muted' }));

      let err: any = null;
      try {
        await svc.markFixed({
          strategy: STRATEGY,
          selector: SELECTOR,
          apiKeyId: API_KEY_ID,
        });
      } catch (e) {
        err = e;
      }
      expect(err).to.be.instanceOf(SelectorStateConflictError);
      expect(err.currentStatus).to.equal('muted');
      expect(prismaStub.selectorState.upsert.called).to.equal(false);
      expect(socketStub.emitToDashboard.called).to.equal(false);
    });
  });

  describe('mute', () => {
    it('upserts row to status=muted', async () => {
      const upsertedRow = makeRow({
        status: 'muted',
        muted_at: new Date('2026-04-25T02:00:00.000Z'),
        muted_by_api_key: API_KEY_ID,
      });
      prismaStub.selectorState.upsert.resolves(upsertedRow);

      await svc.mute({
        strategy: STRATEGY,
        selector: SELECTOR,
        apiKeyId: API_KEY_ID,
      });

      expect(prismaStub.selectorState.upsert.calledOnce).to.equal(true);
      const args = prismaStub.selectorState.upsert.firstCall.args[0];
      expect(args.create.status).to.equal('muted');
      expect(args.create.muted_by_api_key).to.equal(API_KEY_ID);
      expect(args.create.muted_at).to.be.instanceOf(Date);
      expect(args.update.status).to.equal('muted');
      expect(args.update.muted_by_api_key).to.equal(API_KEY_ID);
      expect(args.update.muted_at).to.be.instanceOf(Date);
    });

    it('emits SELECTOR_MUTED socket event', async () => {
      const upsertedRow = makeRow({
        status: 'muted',
        muted_at: new Date('2026-04-25T02:00:00.000Z'),
        muted_by_api_key: API_KEY_ID,
      });
      prismaStub.selectorState.upsert.resolves(upsertedRow);

      await svc.mute({
        strategy: STRATEGY,
        selector: SELECTOR,
        apiKeyId: API_KEY_ID,
      });

      expect(socketStub.emitToDashboard.calledOnce).to.equal(true);
      const [event, payload] = socketStub.emitToDashboard.firstCall.args;
      expect(event).to.equal(SocketEvents.SELECTOR_MUTED);
      expect(payload.status).to.equal('muted');
      expect(payload.muted_at).to.equal('2026-04-25T02:00:00.000Z');
    });
  });

  describe('unmute', () => {
    it('deletes the row when no other history exists', async () => {
      prismaStub.selectorState.findUnique.resolves(
        makeRow({
          status: 'muted',
          muted_at: new Date('2026-04-25T02:00:00.000Z'),
          muted_by_api_key: API_KEY_ID,
          regression_count: 0,
          fixed_at: null,
          resolved_at: null,
        }),
      );
      prismaStub.selectorState.delete.resolves(undefined);

      await svc.unmute({
        strategy: STRATEGY,
        selector: SELECTOR,
        apiKeyId: API_KEY_ID,
      });

      expect(prismaStub.selectorState.delete.calledOnce).to.equal(true);
      expect(prismaStub.selectorState.update.called).to.equal(false);
      expect(socketStub.emitToDashboard.calledOnce).to.equal(true);
      expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal(SocketEvents.SELECTOR_UNMUTED);
    });

    it('keeps the row and sets status=active when history exists', async () => {
      const muted = makeRow({
        status: 'muted',
        muted_at: new Date('2026-04-25T02:00:00.000Z'),
        muted_by_api_key: API_KEY_ID,
        regression_count: 3,
      });
      prismaStub.selectorState.findUnique.resolves(muted);
      prismaStub.selectorState.update.resolves(
        makeRow({ ...muted, status: 'active', muted_at: null, muted_by_api_key: null }),
      );

      await svc.unmute({
        strategy: STRATEGY,
        selector: SELECTOR,
        apiKeyId: API_KEY_ID,
      });

      expect(prismaStub.selectorState.delete.called).to.equal(false);
      expect(prismaStub.selectorState.update.calledOnce).to.equal(true);
      const args = prismaStub.selectorState.update.firstCall.args[0];
      expect(args.data.status).to.equal('active');
      expect(args.data.muted_at).to.equal(null);
      expect(socketStub.emitToDashboard.calledOnce).to.equal(true);
      expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal(SocketEvents.SELECTOR_UNMUTED);
    });

    it('is a no-op when the row exists but is not muted', async () => {
      prismaStub.selectorState.findUnique.resolves(makeRow({ status: 'active' }));

      await svc.unmute({
        strategy: STRATEGY,
        selector: SELECTOR,
        apiKeyId: API_KEY_ID,
      });

      expect(prismaStub.selectorState.delete.called).to.equal(false);
      expect(prismaStub.selectorState.update.called).to.equal(false);
      expect(socketStub.emitToDashboard.called).to.equal(false);
    });

    it('is a no-op when no row exists', async () => {
      prismaStub.selectorState.findUnique.resolves(null);

      await svc.unmute({
        strategy: STRATEGY,
        selector: SELECTOR,
        apiKeyId: API_KEY_ID,
      });

      expect(prismaStub.selectorState.delete.called).to.equal(false);
      expect(prismaStub.selectorState.update.called).to.equal(false);
      expect(socketStub.emitToDashboard.called).to.equal(false);
    });
  });

  describe('cancelVerification', () => {
    it('throws SelectorStateConflictError when status is not pending', async () => {
      prismaStub.selectorState.findUnique.resolves(makeRow({ status: 'active' }));

      let err: any = null;
      try {
        await svc.cancelVerification({
          strategy: STRATEGY,
          selector: SELECTOR,
          apiKeyId: API_KEY_ID,
        });
      } catch (e) {
        err = e;
      }
      expect(err).to.be.instanceOf(SelectorStateConflictError);
      expect(err.currentStatus).to.equal('active');
      expect(prismaStub.selectorState.delete.called).to.equal(false);
      expect(prismaStub.selectorState.update.called).to.equal(false);
      expect(socketStub.emitToDashboard.called).to.equal(false);
    });

    it('throws SelectorStateConflictError when no row exists', async () => {
      prismaStub.selectorState.findUnique.resolves(null);

      let err: any = null;
      try {
        await svc.cancelVerification({
          strategy: STRATEGY,
          selector: SELECTOR,
          apiKeyId: API_KEY_ID,
        });
      } catch (e) {
        err = e;
      }
      expect(err).to.be.instanceOf(SelectorStateConflictError);
    });

    it('deletes the row when no other history exists', async () => {
      prismaStub.selectorState.findUnique.resolves(
        makeRow({
          status: 'pending',
          fixed_at: new Date('2026-04-25T01:00:00.000Z'),
          fixed_by_api_key: API_KEY_ID,
          regression_count: 0,
          resolved_at: null,
        }),
      );
      prismaStub.selectorState.delete.resolves(undefined);

      await svc.cancelVerification({
        strategy: STRATEGY,
        selector: SELECTOR,
        apiKeyId: API_KEY_ID,
      });

      expect(prismaStub.selectorState.delete.calledOnce).to.equal(true);
      expect(prismaStub.selectorState.update.called).to.equal(false);
      expect(socketStub.emitToDashboard.calledOnce).to.equal(true);
      expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal(
        SocketEvents.SELECTOR_CANCELLED,
      );
    });

    it('keeps row and clears fixed state when history exists (resolved_at not null)', async () => {
      const pending = makeRow({
        status: 'pending',
        fixed_at: new Date('2026-04-25T01:00:00.000Z'),
        fixed_by_api_key: API_KEY_ID,
        clean_builds_count: 2,
        resolved_at: new Date('2026-04-24T00:00:00.000Z'),
      });
      prismaStub.selectorState.findUnique.resolves(pending);
      prismaStub.selectorState.update.resolves(
        makeRow({
          ...pending,
          status: 'active',
          fixed_at: null,
          clean_builds_count: 0,
        }),
      );

      await svc.cancelVerification({
        strategy: STRATEGY,
        selector: SELECTOR,
        apiKeyId: API_KEY_ID,
      });

      expect(prismaStub.selectorState.delete.called).to.equal(false);
      expect(prismaStub.selectorState.update.calledOnce).to.equal(true);
      const args = prismaStub.selectorState.update.firstCall.args[0];
      expect(args.data.status).to.equal('active');
      expect(args.data.fixed_at).to.equal(null);
      expect(args.data.clean_builds_count).to.equal(0);
      expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal(
        SocketEvents.SELECTOR_CANCELLED,
      );
    });
  });

  describe('onHealRecorded', () => {
    it('flips pending → active and increments regression_count', async () => {
      const pending = makeRow({
        status: 'pending',
        fixed_at: new Date('2026-04-25T01:00:00.000Z'),
        fixed_by_api_key: API_KEY_ID,
        regression_count: 0,
        clean_builds_count: 5,
      });
      prismaStub.selectorState.findUnique.resolves(pending);
      prismaStub.selectorState.update.resolves(
        makeRow({
          ...pending,
          status: 'active',
          fixed_at: null,
          resolved_at: null,
          regression_count: 1,
          clean_builds_count: 0,
        }),
      );

      await svc.onHealRecorded({
        strategy: STRATEGY,
        selector: SELECTOR,
        sessionId: SESSION_ID,
      });

      expect(prismaStub.selectorState.update.calledOnce).to.equal(true);
      const args = prismaStub.selectorState.update.firstCall.args[0];
      expect(args.data.status).to.equal('active');
      expect(args.data.fixed_at).to.equal(null);
      expect(args.data.resolved_at).to.equal(null);
      expect(args.data.regression_count).to.deep.equal({ increment: 1 });
      expect(args.data.clean_builds_count).to.equal(0);
      expect(socketStub.emitToDashboard.calledOnce).to.equal(true);
      expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal(
        SocketEvents.SELECTOR_REGRESSED,
      );
    });

    it('flips resolved → active, clears resolved_at, and increments regression_count', async () => {
      const resolved = makeRow({
        status: 'resolved',
        fixed_at: new Date('2026-04-25T01:00:00.000Z'),
        resolved_at: new Date('2026-04-25T02:00:00.000Z'),
        regression_count: 1,
        clean_builds_count: 5,
      });
      prismaStub.selectorState.findUnique.resolves(resolved);
      prismaStub.selectorState.update.resolves(
        makeRow({
          ...resolved,
          status: 'active',
          fixed_at: null,
          resolved_at: null,
          regression_count: 2,
          clean_builds_count: 0,
        }),
      );

      await svc.onHealRecorded({
        strategy: STRATEGY,
        selector: SELECTOR,
        sessionId: SESSION_ID,
      });

      expect(prismaStub.selectorState.update.calledOnce).to.equal(true);
      const args = prismaStub.selectorState.update.firstCall.args[0];
      expect(args.data.status).to.equal('active');
      expect(args.data.resolved_at).to.equal(null);
      expect(args.data.fixed_at).to.equal(null);
      expect(args.data.regression_count).to.deep.equal({ increment: 1 });
      expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal(
        SocketEvents.SELECTOR_REGRESSED,
      );
    });

    it('is a no-op when the row is muted', async () => {
      prismaStub.selectorState.findUnique.resolves(makeRow({ status: 'muted' }));

      await svc.onHealRecorded({
        strategy: STRATEGY,
        selector: SELECTOR,
        sessionId: SESSION_ID,
      });

      expect(prismaStub.selectorState.update.called).to.equal(false);
      expect(socketStub.emitToDashboard.called).to.equal(false);
    });

    it('is a no-op when no row exists', async () => {
      prismaStub.selectorState.findUnique.resolves(null);

      await svc.onHealRecorded({
        strategy: STRATEGY,
        selector: SELECTOR,
        sessionId: SESSION_ID,
      });

      expect(prismaStub.selectorState.update.called).to.equal(false);
      expect(socketStub.emitToDashboard.called).to.equal(false);
    });

    it('is a no-op when row is already active', async () => {
      prismaStub.selectorState.findUnique.resolves(makeRow({ status: 'active' }));

      await svc.onHealRecorded({
        strategy: STRATEGY,
        selector: SELECTOR,
        sessionId: SESSION_ID,
      });

      expect(prismaStub.selectorState.update.called).to.equal(false);
      expect(socketStub.emitToDashboard.called).to.equal(false);
    });
  });

  describe('getState', () => {
    it('returns the row when found', async () => {
      const row = makeRow({ status: 'pending' });
      prismaStub.selectorState.findUnique.resolves(row);

      const result = await svc.getState(STRATEGY, SELECTOR);
      expect(result).to.equal(row);
    });

    it('returns null when not found', async () => {
      prismaStub.selectorState.findUnique.resolves(null);

      const result = await svc.getState(STRATEGY, SELECTOR);
      expect(result).to.equal(null);
    });
  });
});
