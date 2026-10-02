# Selector Health Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Selector Health as a list with a side panel: correct status tabs, search and paging on the server, a heals-per-day trend, an audit trail of who did what, member actions, and no cost figures anywhere.

**Architecture:** A new `SelectorEvent` table records every status change in the same transaction as the change. A new service folder `src/services/selector-health/` answers the list (`GET /healing/selectors`) and the panel (`GET /healing/selectors/detail`) with real `groupBy` queries scoped by `visibleSessionWhere`; the summary gains time spent and a day-by-day trend. The web page is rebuilt from small components (summary, trend, list, panel, dialogs) with the view held in the address bar.

**Tech Stack:** TypeScript, Express, Prisma 5.22 on SQLite, Mocha/Chai/Sinon/supertest; React 17, react-router 6, Tailwind 3.4, Vitest + Testing Library 11.

**Spec:** `docs/superpowers/specs/2026-10-02-selector-health-redesign-design.md`

## Global Constraints

- Branch `feat/selector-health-redesign`, worktree `.claude/worktrees/selector-health`, stacked on `feat/session-performance` (it reuses `web/src/components/session-detail/line-chart.tsx`).
- Node 22.19: `source ~/.nvm/nvm.sh && nvm use 22.19.0` before any npm/npx command.
- Server suite: `ANDROID_HOME=$HOME/Library/Android/sdk npm run test:all` (runs `test/unit/**` only, against a scratch database). One spec: `npx mocha --require test/setup/scratch-default-database.js <file>`; never without the `--require` for a spec that touches the database.
- Web suite: `cd web && npx vitest run`, run on its own. Web types: `cd web && npx tsc --noEmit -p .`.
- No new dependencies.
- Colours: role tokens and `rgb(var(--rgb-fg) / A)` washes only; no hex or `rgba()` literals (`web/src/design/color-literals.test.ts` ratchet; lower or remove a baseline entry when a file loses literals).
- Copy: plain words for testers. No tool names, setting keys, server topology or internals ("tuple", "etalon", "go-ios", "adb", "Brittle", "Avg conf.", "cost"). Sentence case. No `window.confirm`; dialogs use `ui/Modal`.
- Layout for 1280–1440 px, panel open included; Tailwind `min-width` breakpoints only.
- No cost: `TIER_COST_USD`, `estimateCost` and every `estCostUsd` go.
- Healing method explanations, verbatim: Resilio "Found it from its saved fingerprint"; Native "Found it again with the original selector"; Fuzzy XML "Found the closest match in the screen's structure"; OCR "Found it by reading the text on screen"; Visual AI "Found it in a screenshot with AI"; LLM "Asked a language model to find it".
- AI heals are tiers `Visual AI` and `LLM`.
- Mute reason: optional, at most 500 characters.
- A selector is visible to a caller who can see at least one session where it healed, at any time; an admin or auth-disabled caller (`visibleSessionWhere` → `undefined`) sees all. Hidden → `404 { error: 'not_found', message: 'Selector not found' }`.
- `canAct` = the caller's scopes include `sessions` or `admin`.
- ESLint: never `--fix`; per-file counts on existing files must not rise; new files have zero findings. Prettier `--write` only on files this branch creates.
- Git: stage explicit paths only; never `temp-appium/*`; no attribution lines.
- Generated Prisma client: after `node scripts/generate-prisma.js`, replace the worktree path with `/Users/rabindrabiswal/Workspace/XAenon/xenon` in the generated files.

## Review Focus

1. **Legacy heals with no strategy** (`original_strategy` null): they must list (strategy `''`), open in the panel, and accept actions. Pinned in Task 5 (list), Task 6 (panel) and Task 7 (action).
2. **Selectors with `/ [ ] ' " % & # ?` and spaces** must round-trip through the address bar, the panel query and the action body. Pinned in Task 6 (server query string) and Task 8 (`writeView`/`readView`).
3. **A page number past the end** (a bookmark after selectors were fixed) shows the last page, not an empty list. Pinned in Task 5.
4. **Activity by a deleted user, or with auth disabled**, shows the action without a name and never an id. Pinned in Task 6 (server person with `name: null`) and Task 11 (panel text).
5. **An action on the open panel** refreshes the panel and the list; a selector that leaves the tab stays open in the panel with its new status. Pinned in Task 12.

---

### Task 1: The `SelectorEvent` table

**Files:**
- Modify: `prisma/schema.prisma` (new model after `model SelectorState`)
- Create: `prisma/migrations/20261002130000_selector_event/migration.sql`
- Modify: `src/generated/client/*` (regenerated)
- Modify: `src/prisma.ts` (`MODEL_DELEGATES`)
- Modify: `test/helpers/scratch-database.ts` (`MODELS`)
- Test: `test/unit/selector-event-model.spec.ts`

**Interfaces:**
- Produces: `prisma.selectorEvent` with fields `id`, `original_strategy`, `original_selector`, `action`, `user_id` (nullable), `reason` (nullable), `createdAt`.

- [ ] **Step 1: Write the failing test**

`test/unit/selector-event-model.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';

describe('SelectorEvent table', function () {
  this.timeout(90_000);
  useScratchDatabase();

  it('keeps who did what to a selector, and why', async () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 2, 10, 0, s));
    await prisma.selectorEvent.create({
      data: {
        original_strategy: 'xpath',
        original_selector: '//a',
        action: 'muted',
        user_id: 'u-1',
        reason: 'Screen being redesigned',
        createdAt: at(0),
      },
    });
    await prisma.selectorEvent.create({
      data: {
        original_strategy: 'xpath',
        original_selector: '//a',
        action: 'unmuted',
        createdAt: at(1),
      },
    });

    const rows = await prisma.selectorEvent.findMany({
      where: { original_strategy: 'xpath', original_selector: '//a' },
      orderBy: { createdAt: 'desc' },
    });
    expect(rows.map((r) => r.action)).to.deep.equal(['unmuted', 'muted']);
    expect(rows[0]).to.include({ user_id: null, reason: null });
    expect(rows[1]).to.include({ user_id: 'u-1', reason: 'Screen being redesigned' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/selector-event-model.spec.ts`
Expected: FAIL, a TypeScript error that `selectorEvent` does not exist on the client.

- [ ] **Step 3: Add the model, the migration and the model lists**

In `prisma/schema.prisma`, after the closing `}` of `model SelectorState`:

```prisma

// What happened to a selector, and who did it: one row per status change.
// No relation to SelectorState (unmute and cancel can delete that row; the
// history stays) or to User (a deleted user's actions stay, without a name).
model SelectorEvent {
  id                String   @id @default(uuid())
  original_strategy String
  original_selector String
  action            String
  user_id           String?
  reason            String?
  createdAt         DateTime @default(now())

  @@index([original_strategy, original_selector, createdAt])
}
```

`prisma/migrations/20261002130000_selector_event/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "SelectorEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "original_strategy" TEXT NOT NULL,
    "original_selector" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SelectorEvent_original_strategy_original_selector_createdAt_idx" ON "SelectorEvent"("original_strategy", "original_selector", "createdAt");
```

In `src/prisma.ts`, `MODEL_DELEGATES`, add a line after `'sessionMetric',`:

```ts
  'selectorEvent',
```

In `test/helpers/scratch-database.ts`, `MODELS`, add after `'sessionMetric',`:

```ts
  'selectorEvent',
```

- [ ] **Step 4: Regenerate the client and restore its paths**

```bash
node scripts/generate-prisma.js
grep -rl "worktrees/selector-health" src/generated/client | xargs sed -i '' 's#/Users/rabindrabiswal/Workspace/XAenon/xenon/.claude/worktrees/selector-health#/Users/rabindrabiswal/Workspace/XAenon/xenon#g'
grep -rl "worktrees/selector-health" src/generated/client | wc -l
git status --short src/generated/client
```

Expected: the last `grep` prints `0`; only generated files that mention `SelectorEvent` (and the schema copy) change.

- [ ] **Step 5: Run the test and the schema checks**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/selector-event-model.spec.ts`
Expected: PASS, 1 passing.

Run: `node scripts/check-client-freshness.js`
Expected: exits 0.

Run: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "file:/private/tmp/claude-501/-Users-rabindrabiswal-Workspace-XAenon-xenon/9a8ed34b-ba86-40d6-a815-6a0ce62ed9a7/scratchpad/shadow-sh.db" --exit-code`
Expected: "No difference detected", exit 0.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261002130000_selector_event/migration.sql src/generated/client src/prisma.ts test/helpers/scratch-database.ts test/unit/selector-event-model.spec.ts
git commit -m "feat(selector-health): a SelectorEvent table for who changed a selector, and why"
```

---

### Task 2: Every status change records its event

**Files:**
- Modify: `src/services/SelectorStateService.ts` (whole file shown below)
- Modify: `src/services/SelectorVerificationJob.ts` (interfaces and `promoteToResolved`)
- Test: `test/unit/selector-state-service.spec.ts` (stub builder + new `describe`)
- Test: `test/unit/selector-verification-job.spec.ts` (stub + new test)

**Interfaces:**
- Consumes: `prisma.selectorEvent` (Task 1).
- Produces:
  - `export type SelectorEventAction = 'marked_fixed' | 'verification_cancelled' | 'verified' | 'broke_again' | 'muted' | 'unmuted'`
  - `export interface ActorContext extends SelectorTuple { apiKeyId: string; userId?: string | null; reason?: string | null }`
  - `export function selectorEventData(tuple: SelectorTuple, action: SelectorEventAction, userId?: string | null, reason?: string | null): { data: {...} }`

- [ ] **Step 1: Give the unit specs a transaction, and write the failing tests**

In `test/unit/selector-state-service.spec.ts`, replace `buildPrismaStub` with:

```ts
function buildPrismaStub() {
  const stub: any = {
    selectorState: {
      findUnique: sinon.stub(),
      upsert: sinon.stub(),
      update: sinon.stub(),
      delete: sinon.stub(),
    },
    selectorEvent: { create: sinon.stub().resolves({}) },
  };
  // A transaction runs its callback against the same tables, as Prisma's does.
  stub.$transaction = sinon.stub().callsFake((fn: (tx: unknown) => Promise<unknown>) => fn(stub));
  return stub;
}
```

Append inside the top-level `describe('SelectorStateService', ...)`, before its closing `});`:

```ts
  describe('what each change records', () => {
    const ctx = { strategy: STRATEGY, selector: SELECTOR, apiKeyId: API_KEY_ID, userId: 'user-1' };
    const recorded = () => prismaStub.selectorEvent.create.firstCall.args[0].data;

    it('records who marked it fixed, in the same transaction as the status', async () => {
      prismaStub.selectorState.findUnique.resolves(null);
      prismaStub.selectorState.upsert.resolves(makeRow({ status: 'pending', fixed_at: new Date() }));

      await svc.markFixed(ctx);

      expect(prismaStub.$transaction.calledOnce).to.equal(true);
      expect(recorded()).to.deep.equal({
        original_strategy: STRATEGY,
        original_selector: SELECTOR,
        action: 'marked_fixed',
        user_id: 'user-1',
        reason: null,
      });
      expect(prismaStub.selectorEvent.create.calledAfter(prismaStub.selectorState.upsert)).to.equal(true);
    });

    it('fails the change, and tells nobody, when its record cannot be written', async () => {
      prismaStub.selectorState.findUnique.resolves(null);
      prismaStub.selectorState.upsert.resolves(makeRow({ status: 'pending' }));
      prismaStub.selectorEvent.create.rejects(new Error('disk full'));

      let thrown: unknown;
      try {
        await svc.markFixed(ctx);
      } catch (e) {
        thrown = e;
      }
      expect((thrown as Error).message).to.equal('disk full');
      expect(socketStub.emitToDashboard.called).to.equal(false);
    });

    it('records the mute with its reason', async () => {
      prismaStub.selectorState.upsert.resolves(makeRow({ status: 'muted', muted_at: new Date() }));

      await svc.mute({ ...ctx, reason: 'Screen being redesigned' });

      expect(recorded()).to.include({ action: 'muted', user_id: 'user-1', reason: 'Screen being redesigned' });
    });

    it('records an unmute, and nothing for a selector that is not muted', async () => {
      prismaStub.selectorState.findUnique.resolves(makeRow({ status: 'muted', muted_at: new Date() }));
      prismaStub.selectorState.delete.resolves(makeRow());
      await svc.unmute(ctx);
      expect(recorded()).to.include({ action: 'unmuted', user_id: 'user-1' });

      prismaStub.selectorEvent.create.resetHistory();
      prismaStub.selectorState.findUnique.resolves(makeRow({ status: 'active' }));
      await svc.unmute(ctx);
      expect(prismaStub.selectorEvent.create.called).to.equal(false);
    });

    it('records a cancelled verification', async () => {
      prismaStub.selectorState.findUnique.resolves(makeRow({ status: 'pending', fixed_at: new Date() }));
      prismaStub.selectorState.delete.resolves(makeRow());

      await svc.cancelVerification(ctx);

      expect(recorded()).to.include({ action: 'verification_cancelled', user_id: 'user-1' });
    });

    it('records a selector breaking again, with nobody as its person', async () => {
      prismaStub.selectorState.findUnique.resolves(makeRow({ status: 'resolved', resolved_at: new Date() }));
      prismaStub.selectorState.update.resolves(makeRow({ status: 'active', regression_count: 1 }));

      await svc.onHealRecorded({ strategy: STRATEGY, selector: SELECTOR, sessionId: SESSION_ID });

      expect(recorded()).to.include({ action: 'broke_again', user_id: null, reason: null });
    });

    it('records nothing for a heal on a selector with no status', async () => {
      prismaStub.selectorState.findUnique.resolves(null);

      await svc.onHealRecorded({ strategy: STRATEGY, selector: SELECTOR, sessionId: SESSION_ID });

      expect(prismaStub.$transaction.called).to.equal(false);
      expect(prismaStub.selectorEvent.create.called).to.equal(false);
    });
  });
```

In `test/unit/selector-verification-job.spec.ts`, replace the `beforeEach` body's `prismaStub = {...}` with:

```ts
    prismaStub = {
      selectorState: {
        findMany: sinon.stub(),
        update: sinon.stub().resolves({}),
      },
      selectorEvent: { create: sinon.stub().resolves({}) },
      $queryRaw: sinon.stub(),
    };
    prismaStub.$transaction = sinon
      .stub()
      .callsFake((fn: (tx: unknown) => Promise<unknown>) => fn(prismaStub));
```

and add this test inside the `describe`:

```ts
  it('records the verification, with nobody as its person', async () => {
    prismaStub.selectorState.findMany.resolves([
      {
        id: 'r-1',
        original_strategy: 'xpath',
        original_selector: '//x',
        status: 'pending',
        fixed_at: new Date('2026-04-20T00:00:00Z'),
        clean_builds_count: 2,
      },
    ]);
    prismaStub.$queryRaw.resolves([
      { build_id: 'b-1', healed: 0 },
      { build_id: 'b-2', healed: 0 },
      { build_id: 'b-3', healed: 0 },
    ]);
    prismaStub.selectorState.update.resolves({
      id: 'r-1',
      original_strategy: 'xpath',
      original_selector: '//x',
      status: 'resolved',
      clean_builds_count: 3,
      resolved_at: new Date(),
    });

    await job.run();

    expect(prismaStub.selectorEvent.create.calledOnce).to.equal(true);
    expect(prismaStub.selectorEvent.create.firstCall.args[0].data).to.deep.equal({
      original_strategy: 'xpath',
      original_selector: '//x',
      action: 'verified',
      user_id: null,
      reason: null,
    });
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/selector-state-service.spec.ts test/unit/selector-verification-job.spec.ts`
Expected: the new tests FAIL (`selectorEvent.create` never called, `$transaction` not called); the older tests still pass.

- [ ] **Step 3: Write each change and its event in one transaction**

Replace `src/services/SelectorStateService.ts` with:

```ts
import { Container, Service } from 'typedi';
import { prisma as defaultPrisma } from '../prisma';
import { SocketServer } from './SocketServer';
import { SocketEvents } from '../enums/SocketEvents';
import log from '../logger';
import type { SelectorState } from '../generated/client';

/**
 * Thrown when a state-machine transition is invalid for the row's current
 * status (e.g. trying to mark a muted selector as fixed). Callers in the
 * router layer should map this to HTTP 409.
 */
export class SelectorStateConflictError extends Error {
  constructor(
    message: string,
    public currentStatus: string,
  ) {
    super(message);
    this.name = 'SelectorStateConflictError';
  }
}

/** Identifies the (strategy, selector) tuple a transition operates on. */
export interface SelectorTuple {
  strategy: string;
  selector: string;
}

/** What happened to a selector, as a SelectorEvent row records it. */
export type SelectorEventAction =
  | 'marked_fixed'
  | 'verification_cancelled'
  | 'verified'
  | 'broke_again'
  | 'muted'
  | 'unmuted';

export interface ActorContext extends SelectorTuple {
  /** API key id of the caller, for the older `*_by_api_key` columns; '' for a dashboard user. */
  apiKeyId: string;
  /** The person acting (`resolveActor(req).userId`), recorded on the SelectorEvent. */
  userId?: string | null;
  /** Why the selector is muted. Mute only. */
  reason?: string | null;
}

export interface HealRecordedContext extends SelectorTuple {
  sessionId: string;
}

/**
 * Minimal subset of `prisma.selectorState` we depend on. Defining the shape
 * locally lets tests pass plain Sinon stubs in via the constructor without
 * pulling Prisma's full type surface into the test file.
 */
interface SelectorStateDelegate {
  findUnique(args: any): Promise<SelectorState | null>;
  upsert(args: any): Promise<SelectorState>;
  update(args: any): Promise<SelectorState>;
  delete(args: any): Promise<SelectorState>;
}

interface SelectorEventDelegate {
  create(args: any): Promise<unknown>;
}

/** The tables one change writes, inside its transaction. */
export interface SelectorWriteTx {
  selectorState: SelectorStateDelegate;
  selectorEvent: SelectorEventDelegate;
}

interface PrismaLike extends SelectorWriteTx {
  $transaction<T>(fn: (tx: SelectorWriteTx) => Promise<T>): Promise<T>;
}

interface SocketLike {
  emitToDashboard(event: string, data: any): void;
}

const scopedLog = log.scope('SelectorState');

/** Compound-key `where` clause for the (strategy, selector) unique index. */
function whereTuple(strategy: string, selector: string) {
  return {
    original_strategy_original_selector: {
      original_strategy: strategy,
      original_selector: selector,
    },
  };
}

/** The SelectorEvent row for one change. */
export function selectorEventData(
  tuple: SelectorTuple,
  action: SelectorEventAction,
  userId?: string | null,
  reason?: string | null,
) {
  return {
    data: {
      original_strategy: tuple.strategy,
      original_selector: tuple.selector,
      action,
      user_id: userId ?? null,
      reason: reason ?? null,
    },
  };
}

/**
 * Convert a SelectorState row into a plain object with ISO-8601 timestamps
 * suitable for socket.io broadcast and JSON serialization.
 */
function serialize(row: SelectorState) {
  return {
    id: row.id,
    original_strategy: row.original_strategy,
    original_selector: row.original_selector,
    status: row.status,
    fixed_at: row.fixed_at ? row.fixed_at.toISOString() : null,
    fixed_by_api_key: row.fixed_by_api_key,
    resolved_at: row.resolved_at ? row.resolved_at.toISOString() : null,
    muted_at: row.muted_at ? row.muted_at.toISOString() : null,
    muted_by_api_key: row.muted_by_api_key,
    regression_count: row.regression_count,
    clean_builds_count: row.clean_builds_count,
    last_event_at: row.last_event_at ? row.last_event_at.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/**
 * Owns SelectorState lifecycle transitions. Every transition is idempotent
 * where the spec allows, emits the corresponding `SELECTOR_*` socket event,
 * and uses lazy row creation — rows only exist once a user has taken an
 * action against the selector. Each change and its SelectorEvent are one
 * transaction, so the status and its history can't disagree.
 *
 * The constructor accepts both prisma + socket as parameters (defaulting to
 * the real implementations) so tests can pass Sinon stubs without going
 * through TypeDI.
 */
@Service()
export class SelectorStateService {
  private readonly prisma: PrismaLike;
  private readonly socket: SocketLike;

  constructor(prisma?: PrismaLike, socket?: SocketLike) {
    this.prisma = prisma ?? (defaultPrisma as unknown as PrismaLike);
    this.socket = socket ?? Container.get(SocketServer);
  }

  /**
   * Mark a healed selector as "fixed pending verification". Resets the
   * clean-build counter so progress restarts from zero. Rejects if the
   * selector is currently muted (would silently re-arm regressions).
   */
  async markFixed(ctx: ActorContext): Promise<SelectorState> {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.selectorState.findUnique({
        where: whereTuple(ctx.strategy, ctx.selector),
      });
      if (existing && existing.status === 'muted') {
        throw new SelectorStateConflictError(
          `Cannot markFixed on a muted selector (${ctx.strategy}=${ctx.selector})`,
          existing.status,
        );
      }

      const now = new Date();
      const upserted = await tx.selectorState.upsert({
        where: whereTuple(ctx.strategy, ctx.selector),
        create: {
          original_strategy: ctx.strategy,
          original_selector: ctx.selector,
          status: 'pending',
          fixed_at: now,
          fixed_by_api_key: ctx.apiKeyId,
          clean_builds_count: 0,
          last_event_at: now,
        },
        update: {
          status: 'pending',
          fixed_at: now,
          fixed_by_api_key: ctx.apiKeyId,
          clean_builds_count: 0,
          resolved_at: null,
          last_event_at: now,
        },
      });
      await tx.selectorEvent.create(selectorEventData(ctx, 'marked_fixed', ctx.userId));
      return upserted;
    });

    scopedLog.info(
      `markFixed: ${ctx.strategy}=${ctx.selector} → pending (api_key=${ctx.apiKeyId})`,
    );
    this.socket.emitToDashboard(SocketEvents.SELECTOR_FIXED, serialize(row));
    return row;
  }

  /**
   * Silence a selector. Idempotent — re-muting an already-muted selector
   * just refreshes muted_at / muted_by_api_key, and records the new reason.
   */
  async mute(ctx: ActorContext): Promise<SelectorState> {
    const row = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const upserted = await tx.selectorState.upsert({
        where: whereTuple(ctx.strategy, ctx.selector),
        create: {
          original_strategy: ctx.strategy,
          original_selector: ctx.selector,
          status: 'muted',
          muted_at: now,
          muted_by_api_key: ctx.apiKeyId,
          last_event_at: now,
        },
        update: {
          // Preserve any prior fixed_at / resolved_at history (Pending → Muted spec).
          status: 'muted',
          muted_at: now,
          muted_by_api_key: ctx.apiKeyId,
          last_event_at: now,
        },
      });
      await tx.selectorEvent.create(selectorEventData(ctx, 'muted', ctx.userId, ctx.reason));
      return upserted;
    });

    scopedLog.info(`mute: ${ctx.strategy}=${ctx.selector} → muted (api_key=${ctx.apiKeyId})`);
    this.socket.emitToDashboard(SocketEvents.SELECTOR_MUTED, serialize(row));
    return row;
  }

  /**
   * Lift a mute. If the row had no other history, deletes it (lazy cleanup
   * so the table doesn't accumulate phantom rows for selectors that were
   * only ever muted). Otherwise resets to active and preserves history.
   *
   * "History" here means any of:
   *   - `regression_count > 0` (the selector has regressed at least once), OR
   *   - `fixed_at != null` (someone has marked it fixed), OR
   *   - `resolved_at != null` (it has reached the resolved terminal state).
   *
   * Calling `unmute` on a row whose status is not `'muted'` (including a
   * missing row) is a silent no-op: the existing row is returned unchanged,
   * nothing is recorded and no socket event is emitted.
   */
  async unmute(ctx: ActorContext): Promise<SelectorState | null> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.selectorState.findUnique({
        where: whereTuple(ctx.strategy, ctx.selector),
      });
      if (!existing || existing.status !== 'muted') {
        return { changed: false, row: existing };
      }

      const hasOtherHistory =
        existing.regression_count > 0 ||
        existing.fixed_at !== null ||
        existing.resolved_at !== null;

      let result: SelectorState | null;
      if (!hasOtherHistory) {
        await tx.selectorState.delete({
          where: whereTuple(ctx.strategy, ctx.selector),
        });
        result = null;
      } else {
        result = await tx.selectorState.update({
          where: whereTuple(ctx.strategy, ctx.selector),
          data: {
            status: 'active',
            muted_at: null,
            muted_by_api_key: null,
            last_event_at: new Date(),
          },
        });
      }
      await tx.selectorEvent.create(selectorEventData(ctx, 'unmuted', ctx.userId));
      return { changed: true, row: result };
    });
    if (!outcome.changed) return outcome.row;

    const result = outcome.row;
    scopedLog.info(
      `unmute: ${ctx.strategy}=${ctx.selector} → ${result ? 'active' : 'deleted'} (api_key=${ctx.apiKeyId})`,
    );
    // Emit the post-state. When the row was deleted, surface the prior tuple
    // so the dashboard can drop it from the muted list.
    this.socket.emitToDashboard(
      SocketEvents.SELECTOR_UNMUTED,
      result
        ? serialize(result)
        : {
            original_strategy: ctx.strategy,
            original_selector: ctx.selector,
            status: 'deleted',
          },
    );
    return result;
  }

  /**
   * Cancel a pending verification (user clicked "undo" before clean-builds
   * count tipped over). Only valid from status='pending'. If no other
   * history was accumulated, removes the row entirely.
   */
  async cancelVerification(ctx: ActorContext): Promise<SelectorState | null> {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.selectorState.findUnique({
        where: whereTuple(ctx.strategy, ctx.selector),
      });
      if (!existing || existing.status !== 'pending') {
        throw new SelectorStateConflictError(
          `cancelVerification requires status=pending (${ctx.strategy}=${ctx.selector})`,
          existing ? existing.status : 'none',
        );
      }

      const hasOtherHistory = existing.regression_count > 0 || existing.resolved_at !== null;

      let row: SelectorState | null;
      if (!hasOtherHistory) {
        await tx.selectorState.delete({
          where: whereTuple(ctx.strategy, ctx.selector),
        });
        row = null;
      } else {
        row = await tx.selectorState.update({
          where: whereTuple(ctx.strategy, ctx.selector),
          data: {
            status: 'active',
            fixed_at: null,
            fixed_by_api_key: null,
            clean_builds_count: 0,
            last_event_at: new Date(),
          },
        });
      }
      await tx.selectorEvent.create(selectorEventData(ctx, 'verification_cancelled', ctx.userId));
      return row;
    });

    scopedLog.info(
      `cancelVerification: ${ctx.strategy}=${ctx.selector} → ${result ? 'active' : 'deleted'} (api_key=${ctx.apiKeyId})`,
    );
    this.socket.emitToDashboard(
      SocketEvents.SELECTOR_CANCELLED,
      result
        ? serialize(result)
        : {
            original_strategy: ctx.strategy,
            original_selector: ctx.selector,
            status: 'deleted',
          },
    );
    return result;
  }

  /**
   * Heal-write hook called from the heal write path when `is_healed=true` is
   * about to be persisted. If the (strategy, selector) row is in `'pending'`
   * or `'resolved'` state, transitions it back to `'active'`, increments
   * `regression_count`, records `broke_again`, and emits `SELECTOR_REGRESSED`.
   * No-op if the row is absent, muted, or already active.
   *
   * Return value: provided for testing/integration scenarios. Production
   * callers in the heal write path (`event-manager.ts`) should treat this
   * as fire-and-forget and wrap the call with `.catch()` so a failure here
   * never blocks or breaks the heal write itself.
   */
  async onHealRecorded(ctx: HealRecordedContext): Promise<SelectorState | null> {
    // Read outside a transaction: this runs on every heal, and almost every
    // heal changes nothing.
    const existing = await this.prisma.selectorState.findUnique({
      where: whereTuple(ctx.strategy, ctx.selector),
    });
    if (!existing) return null;
    if (existing.status !== 'pending' && existing.status !== 'resolved') {
      return existing;
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.selectorState.update({
        where: whereTuple(ctx.strategy, ctx.selector),
        data: {
          status: 'active',
          fixed_at: null,
          resolved_at: null,
          regression_count: { increment: 1 },
          clean_builds_count: 0,
          last_event_at: new Date(),
        },
      });
      await tx.selectorEvent.create(selectorEventData(ctx, 'broke_again'));
      return updated;
    });

    scopedLog.warn(
      `onHealRecorded: ${ctx.strategy}=${ctx.selector} regressed from ${existing.status} (session=${ctx.sessionId})`,
    );
    this.socket.emitToDashboard(SocketEvents.SELECTOR_REGRESSED, serialize(row));
    return row;
  }

  /** Read-through accessor for callers that need the current row (or null). */
  async getState(strategy: string, selector: string): Promise<SelectorState | null> {
    return this.prisma.selectorState.findUnique({
      where: whereTuple(strategy, selector),
    });
  }
}
```

In `src/services/SelectorVerificationJob.ts`:

Add after the existing imports:

```ts
import { selectorEventData } from './SelectorStateService';
```

Replace the two delegate interfaces and `PrismaLike` with:

```ts
interface PrismaSelectorStateDelegate {
  findMany(args: any): Promise<SelectorState[]>;
  update(args: any): Promise<SelectorState>;
}

interface PrismaSelectorEventDelegate {
  create(args: any): Promise<unknown>;
}

/** The tables a promotion writes, inside its transaction. */
interface VerifyTx {
  selectorState: PrismaSelectorStateDelegate;
  selectorEvent: PrismaSelectorEventDelegate;
}

interface PrismaLike extends VerifyTx {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: any[]): Promise<T>;
  $transaction<T>(fn: (tx: VerifyTx) => Promise<T>): Promise<T>;
}
```

Replace `promoteToResolved` with:

```ts
  private async promoteToResolved(row: SelectorState): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const promoted = await tx.selectorState.update({
        where: { id: row.id },
        data: {
          status: 'resolved',
          resolved_at: now,
          clean_builds_count: CLEAN_BUILDS_TO_RESOLVE,
          last_event_at: now,
        },
      });
      await tx.selectorEvent.create(
        selectorEventData(
          { strategy: row.original_strategy, selector: row.original_selector },
          'verified',
        ),
      );
      return promoted;
    });
    log.info(
      `[${row.id}] promoted to resolved (${row.original_strategy}=${row.original_selector})`,
    );
    this.socket.emitToDashboard(SocketEvents.SELECTOR_RESOLVED, this.serialize(updated));
  }
```

- [ ] **Step 4: Run the unit specs and the real-database flow**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/selector-state-service.spec.ts test/unit/selector-verification-job.spec.ts test/unit/event-manager-regression-hook.spec.ts`
Expected: PASS, all passing.

Run: `npx mocha --require test/setup/scratch-default-database.js test/integration/selector-state-flow.spec.ts`
Expected: PASS (it migrates its own database, the new table included, and uses the real client's transactions).

- [ ] **Step 5: Commit**

```bash
git add src/services/SelectorStateService.ts src/services/SelectorVerificationJob.ts test/unit/selector-state-service.spec.ts test/unit/selector-verification-job.spec.ts
git commit -m "feat(selector-health): record every status change, and who made it, with the change"
```

---

### Task 3: No cost anywhere

**Files:**
- Modify: `src/app/routers/dashboard.ts` (lines 308–327 and each `estCostUsd`)
- Modify: `src/services/NotificationService.ts:124,135`
- Modify: `src/app/swagger-docs.ts:3135`
- Test: `test/unit/healing-no-cost.spec.ts`

**Interfaces:**
- Produces: `aggregateHotspots(...)` returns `{ totalScanned, totalHeals, distinctSelectors, sessionsTouched, byTier, hotspots }` (no `estCostUsd`); the summary, CI gate, detail and digest payloads carry no `estCostUsd`.

- [ ] **Step 1: Write the failing test**

`test/unit/healing-no-cost.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import DashboardRouter, { aggregateHotspots } from '../../src/app/routers/dashboard';
import { NotificationService } from '../../src/services/NotificationService';
import { prisma } from '../../src/prisma';

const heal = (tier: string) => ({
  session_id: 's-1',
  original_strategy: 'xpath',
  original_selector: '//a',
  healed_strategy: 'xpath',
  healed_selector: '//b',
  healing_confidence: 0.9,
  healing_tier: tier,
  createdAt: new Date(),
  duration: 1000,
});

describe('Selector Health reports no cost', () => {
  afterEach(() => sinon.restore());

  function app() {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      (req as any).auth = { kind: 'user', userId: 'sa', role: 'SUPER_ADMIN', scopes: 'admin', teamIds: undefined };
      next();
    });
    DashboardRouter.register(a as any);
    return a;
  }

  it('leaves cost out of the hotspot aggregation', async () => {
    sinon.stub(prisma.sessionLog, 'findMany').resolves([heal('LLM'), heal('OCR')] as any);
    sinon.stub(prisma.selectorState, 'findMany').resolves([]);

    const agg = await aggregateHotspots({ windowDays: 7, limit: 10 });

    expect(agg).to.not.have.property('estCostUsd');
    expect(agg.totalHeals).to.equal(2);
  });

  it('leaves cost out of the summary', async () => {
    sinon.stub(prisma.sessionLog, 'findMany').resolves([heal('LLM')] as any);
    sinon.stub(prisma.selectorState, 'count').resolves(0);

    const res = await request(app()).get('/healing/summary?windowDays=7');

    expect(res.status).to.equal(200);
    expect(res.body.current).to.not.have.property('estCostUsd');
    expect(res.body.prior).to.not.have.property('estCostUsd');
  });

  it('leaves cost out of the CI gate', async () => {
    sinon
      .stub(prisma.sessionLog, 'findMany')
      .resolves(Array.from({ length: 5 }, () => heal('LLM')) as any);
    sinon.stub(prisma.selectorState, 'findMany').resolves([]);

    const res = await request(app()).get('/healing/hotspots/violations');

    expect(res.status).to.equal(200);
    expect(res.body.violationCount).to.equal(1);
    expect(res.body).to.not.have.property('estCostUsd');
  });

  it('sends a digest with no cost in it', async () => {
    const post = sinon.stub(axios, 'post').resolves({ status: 200 } as any);
    sinon.stub(NotificationService.prototype, 'getConfigs').resolves([
      {
        id: 'w-1',
        url: 'https://hooks.example.test/x',
        type: 'slack',
        active: true,
        events: JSON.stringify(['selector_health_digest']),
        payloadTemplate: null,
      } as any,
    ]);

    await Container.get(NotificationService).dispatchEvent('selector_health_digest', {
      windowDays: 7,
      totalHeals: 3,
      distinctSelectors: 1,
      hotspots: [],
    });

    const text: string = post.firstCall.args[1].text;
    expect(text).to.include('3 heals across 1 selectors');
    expect(text).to.not.match(/\$|est\./);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/healing-no-cost.spec.ts`
Expected: 4 FAIL: each answer still has `estCostUsd`, and the digest text ends `· est. $0.00`.

- [ ] **Step 3: Remove cost**

In `src/app/routers/dashboard.ts`:
- Delete the comment block starting `// Rough per-heal cost estimates in USD.` through the end of `function estimateCost` (the `TIER_COST_USD` table and `estimateCost`).
- In `getHealingSummary`'s `aggregate`, delete the line `      estCostUsd: estimateCost(byTier),`.
- In `interface HotspotAggregation`, delete `  estCostUsd: number;`.
- In `aggregateHotspots`' return, delete `    estCostUsd: estimateCost(byTier),`.
- In `getHealingViolations`' answer, delete `    estCostUsd: agg.estCostUsd,`.
- In `sendHealingDigest`'s `payload`, delete `    estCostUsd: agg.estCostUsd,`.
- In `getHealingSelectorDetail`'s answer, delete `    estCostUsd: estimateCost(byTier),`.

In `src/services/NotificationService.ts`, delete `        const estCostUsd = payload.estCostUsd ?? 0;` and change the summary line to:

```ts
        const summary = `🩺 *Selector Health digest* — last ${windowDays}d\n${totalHeals} heals across ${distinctSelectors} selectors`;
```

In `src/app/swagger-docs.ts`, delete the line ` *                     estCostUsd: { type: number }`.

Then check nothing is left:

Run: `grep -rn "estCostUsd\|estimateCost\|TIER_COST" src --include=*.ts | grep -v src/generated`
Expected: no output.

- [ ] **Step 4: Run the test**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/healing-no-cost.spec.ts test/unit/aggregate-hotspots-session-scope.spec.ts test/unit/aggregate-hotspots-tuple-key.spec.ts`
Expected: PASS, all passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/routers/dashboard.ts src/services/NotificationService.ts src/app/swagger-docs.ts test/unit/healing-no-cost.spec.ts
git commit -m "fix(selector-health): no cost figures: they priced every heal the same, whatever model ran"
```

---

### Task 4: Time spent healing and a day-by-day trend in the summary

**Files:**
- Create: `src/services/selector-health/healingTrend.ts`
- Modify: `src/app/routers/dashboard.ts` (`getHealingSummary`, imports)
- Modify: `src/app/swagger-docs.ts` (`/api/healing/summary`)
- Test: `test/unit/healing-trend.spec.ts`

**Interfaces:**
- Produces:
  - `export const DAY_MS: number`
  - `export const AI_METHODS: ReadonlySet<string>` (`'Visual AI'`, `'LLM'`)
  - `export function parseTzOffset(raw: unknown): number`
  - `export function localDayStart(ms: number, tzOffsetMin: number): number`
  - `export interface TrendDay { t: number; heals: number; aiHeals: number }`
  - `export function dailyHeals(heals: Array<{ at: Date; method: string | null }>, since: Date, now: Date, tzOffsetMin: number): TrendDay[]`
  - Summary answer: `current.timeSpentMs`, `prior.timeSpentMs`, `trend: TrendDay[]`; query `tz` (minutes east of UTC).

- [ ] **Step 1: Write the failing test**

`test/unit/healing-trend.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import DashboardRouter from '../../src/app/routers/dashboard';
import { prisma } from '../../src/prisma';
import {
  DAY_MS,
  dailyHeals,
  localDayStart,
  parseTzOffset,
} from '../../src/services/selector-health/healingTrend';

describe('healing trend: days', () => {
  it("reads the browser's offset from tz, and nothing else", () => {
    expect(parseTzOffset('330')).to.equal(330);
    expect(parseTzOffset('-300')).to.equal(-300);
    expect(parseTzOffset('900')).to.equal(0);
    expect(parseTzOffset('5.5')).to.equal(0);
    expect(parseTzOffset(undefined)).to.equal(0);
    expect(parseTzOffset(['330'])).to.equal(0);
  });

  it("starts a day at the caller's midnight", () => {
    // 2 Oct 20:00 UTC is 3 Oct 01:30 in India (+330).
    const t = Date.UTC(2026, 9, 2, 20, 0);
    expect(localDayStart(t, 330)).to.equal(Date.UTC(2026, 9, 2, 18, 30));
    expect(localDayStart(t, 0)).to.equal(Date.UTC(2026, 9, 2));
  });

  it('counts heals and AI heals per day, with every day of the period present', () => {
    const now = new Date(Date.UTC(2026, 9, 3, 12));
    const since = new Date(now.getTime() - 3 * DAY_MS);
    const days = dailyHeals(
      [
        { at: new Date(Date.UTC(2026, 9, 1, 9)), method: 'LLM' },
        { at: new Date(Date.UTC(2026, 9, 1, 10)), method: 'Fuzzy XML' },
        { at: new Date(Date.UTC(2026, 9, 3, 1)), method: 'Visual AI' },
      ],
      since,
      now,
      0,
    );
    expect(
      days.map((d) => [new Date(d.t).toISOString().slice(0, 10), d.heals, d.aiHeals]),
    ).to.deep.equal([
      ['2026-09-30', 0, 0],
      ['2026-10-01', 2, 1],
      ['2026-10-02', 0, 0],
      ['2026-10-03', 1, 1],
    ]);
  });

  it('puts a heal on the day the caller saw it', () => {
    const now = new Date(Date.UTC(2026, 9, 3, 12));
    const since = new Date(now.getTime() - 2 * DAY_MS);
    // 1 Oct 20:00 UTC is 2 Oct 01:30 in India.
    const days = dailyHeals([{ at: new Date(Date.UTC(2026, 9, 1, 20)), method: null }], since, now, 330);
    expect(days.find((d) => d.heals === 1)?.t).to.equal(Date.UTC(2026, 9, 1, 18, 30));
  });
});

describe('GET /healing/summary: time and trend', () => {
  afterEach(() => sinon.restore());

  function app() {
    const a = express();
    a.use((req, _res, next) => {
      (req as any).auth = { kind: 'user', userId: 'sa', role: 'SUPER_ADMIN', scopes: 'admin', teamIds: undefined };
      next();
    });
    DashboardRouter.register(a as any);
    return a;
  }

  it('adds the time spent healing and one trend entry per day of the period', async () => {
    const recent = new Date(Date.now() - 60_000);
    const findMany = sinon.stub(prisma.sessionLog, 'findMany');
    findMany.onFirstCall().resolves([
      { session_id: 's-1', original_selector: '//a', healing_tier: 'LLM', createdAt: recent, duration: 2500 },
      { session_id: 's-1', original_selector: '//a', healing_tier: 'Fuzzy XML', createdAt: recent, duration: null },
    ] as any);
    findMany.onSecondCall().resolves([
      {
        session_id: 's-0',
        original_selector: '//a',
        healing_tier: 'OCR',
        createdAt: new Date(Date.now() - 9 * DAY_MS),
        duration: 4000,
      },
    ] as any);
    sinon.stub(prisma.selectorState, 'count').resolves(0);

    const res = await request(app()).get('/healing/summary?windowDays=7&tz=0');

    expect(res.status).to.equal(200);
    expect(res.body.current.timeSpentMs).to.equal(2500);
    expect(res.body.prior.timeSpentMs).to.equal(4000);
    expect(res.body.trend).to.have.length(8);
    const sum = (k: 'heals' | 'aiHeals') =>
      res.body.trend.reduce((s: number, d: Record<string, number>) => s + d[k], 0);
    expect([sum('heals'), sum('aiHeals')]).to.deep.equal([2, 1]);
    expect(findMany.firstCall.args[0].select).to.include({ createdAt: true, duration: true });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/healing-trend.spec.ts`
Expected: FAIL, cannot find module `healingTrend`.

- [ ] **Step 3: Write the trend helpers**

`src/services/selector-health/healingTrend.ts`:

```ts
/** One day, in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Heals found by a screenshot model or a language model: the slowest and least certain. */
export const AI_METHODS: ReadonlySet<string> = new Set(['Visual AI', 'LLM']);

/** The furthest any time zone is from UTC, in minutes. */
const MAX_OFFSET_MIN = 14 * 60;

/**
 * The caller's offset from UTC in minutes, east positive, from `?tz=` (the
 * browser's `-getTimezoneOffset()`). 0 when absent or not a whole number of
 * minutes within ±14 hours.
 */
export function parseTzOffset(raw: unknown): number {
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) return 0;
  const n = Number(raw);
  return Math.abs(n) <= MAX_OFFSET_MIN ? n : 0;
}

/** The instant the caller's local day holding `ms` began. */
export function localDayStart(ms: number, tzOffsetMin: number): number {
  const shift = tzOffsetMin * 60_000;
  return Math.floor((ms + shift) / DAY_MS) * DAY_MS - shift;
}

export interface TrendDay {
  /** When the caller's local day began. */
  t: number;
  heals: number;
  aiHeals: number;
}

/**
 * Heals per local day, from the day holding `since` to the day holding `now`,
 * days with none included. One fixed offset for the whole period: across a
 * daylight-saving change a heal near midnight can land on the next day.
 */
export function dailyHeals(
  heals: Array<{ at: Date; method: string | null }>,
  since: Date,
  now: Date,
  tzOffsetMin: number,
): TrendDay[] {
  const first = localDayStart(since.getTime(), tzOffsetMin);
  const last = localDayStart(now.getTime(), tzOffsetMin);
  const days: TrendDay[] = [];
  for (let t = first; t <= last; t += DAY_MS) days.push({ t, heals: 0, aiHeals: 0 });
  for (const h of heals) {
    const i = Math.round((localDayStart(h.at.getTime(), tzOffsetMin) - first) / DAY_MS);
    if (i < 0 || i >= days.length) continue;
    days[i].heals += 1;
    if (h.method && AI_METHODS.has(h.method)) days[i].aiHeals += 1;
  }
  return days;
}
```

- [ ] **Step 4: Add both to the summary**

In `src/app/routers/dashboard.ts`, add to the imports:

```ts
import { dailyHeals, parseTzOffset } from '../../services/selector-health/healingTrend';
```

In `getHealingSummary`:
- After `const windowDays = parseWindowDays(request.query.windowDays);` add `  const tz = parseTzOffset(request.query.tz);`.
- In both `select` blocks, after `healing_tier: true,` add:

```ts
        createdAt: true,
        duration: true,
```

- In `aggregate`, after `const byTier: Record<string, number> = {};` add `    let timeSpentMs = 0;`; inside the loop, after `sessions.add(r.session_id);` add `      timeSpentMs += r.duration ?? 0;`; in its return object, after `byTier,` add:

```ts
      // The commands that needed healing, start to end: what healing cost the run.
      timeSpentMs,
```

- Replace the final `return response.status(200).json({ windowDays, current, prior, resolvedCount, pendingCount, });` with:

```ts
  return response.status(200).json({
    windowDays,
    current,
    prior,
    resolvedCount,
    pendingCount,
    trend: dailyHeals(
      currentRows.map((r) => ({ at: r.createdAt, method: r.healing_tier })),
      since,
      now,
      tz,
    ),
  });
```

In `src/app/swagger-docs.ts`, in the `/api/healing/summary` block, add a parameter after `windowDays`:

```
 *       - in: query
 *         name: tz
 *         schema: { type: integer, minimum: -840, maximum: 840, default: 0 }
 *         description: "The caller's offset from UTC in minutes (east positive), so `trend` days are theirs"
```

and in `current.properties`, after `byTier`, add:

```
 *                     timeSpentMs: { type: integer, description: 'Total duration of the commands that needed healing' }
```

and after `pendingCount: { type: integer }` add:

```
 *                 trend:
 *                   type: array
 *                   description: 'Heals per day of the period, in the caller''s time zone, days with none included'
 *                   items:
 *                     type: object
 *                     properties:
 *                       t: { type: integer, description: 'When the day began, epoch ms' }
 *                       heals: { type: integer }
 *                       aiHeals: { type: integer, description: 'Heals by Visual AI or an LLM' }
```

- [ ] **Step 5: Run the tests**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/healing-trend.spec.ts test/unit/healing-no-cost.spec.ts`
Expected: PASS, all passing.

- [ ] **Step 6: Commit**

```bash
git add src/services/selector-health/healingTrend.ts src/app/routers/dashboard.ts src/app/swagger-docs.ts test/unit/healing-trend.spec.ts
git commit -m "feat(selector-health): time spent healing, and heals per day, in the summary"
```

---

### Task 5: `GET /healing/selectors`, the list

**Files:**
- Create: `src/services/selector-health/selectorKeys.ts`
- Create: `src/services/selector-health/access.ts`
- Create: `src/services/selector-health/people.ts`
- Create: `src/services/selector-health/stateView.ts`
- Create: `src/services/selector-health/selectorList.ts`
- Create: `src/app/routers/selector-health.ts`
- Modify: `src/app/routers/dashboard.ts` (`register`: mount the new routes after the healing reads)
- Modify: `src/app/swagger-docs.ts` (new `/api/healing/selectors` block after `/api/healing/summary`)
- Create: `test/helpers/selector-health-fixture.ts`
- Test: `test/unit/selector-health-list.spec.ts`

**Interfaces:**
- Consumes: `DAY_MS` (Task 4); `prisma.selectorEvent` (Task 1).
- Produces:
  - `selectorKeys.ts`: `interface SelectorKey { strategy: string; selector: string }`, `type SessionScope = Prisma.SessionWhereInput | undefined`, `keyOf(strategy, selector): string`, `tupleWhere(strategy, selector): Prisma.SessionLogWhereInput`, `sessionScope(scope, platform?): Prisma.SessionLogWhereInput`, `chunk<T>(items, size = 200): T[][]`.
  - `access.ts`: `SELECTOR_NOT_FOUND = { error: 'not_found', message: 'Selector not found' }`, `visibleKeys(keys, scope): Promise<Set<string>>`, `canSeeSelector(key, scope): Promise<boolean>`, `canActOnSelectors(scopes: string | string[] | undefined): boolean`.
  - `people.ts`: `interface Person { id: string; name: string | null }`, `peopleById(ids): Promise<Map<string, Person>>`.
  - `stateView.ts`: `interface StateView { status; cleanBuilds; fixedAt; fixedBy: Person | null; resolvedAt; mutedAt; mutedBy: Person | null; muteReason; brokeAgain }`, `interface LatestEvents`, `stateView(row, latest, people): StateView | null`, `latestEvents(keys): Promise<Map<string, LatestEvents>>`.
  - `selectorList.ts`: `TABS`, `SORTS`, `type SelectorTab`, `type SelectorSort`, `interface SelectorListQuery`, `parseSelectorListQuery(q): SelectorListQuery`, `interface SelectorListItem`, `interface SelectorListAnswer`, `listSelectors(query, scope, now?): Promise<SelectorListAnswer>`.
  - `selector-health.ts` router: `callerOf(request)`, `scopeOf(request)`, `getSelectorList`, default export `{ register }`.
  - Fixture: `HOUR`, `DAY`, `TEAM`, `USER`, `PHONE`, `BUILD`, `SEL`, `FIX`, `ADMIN`, `MEMBER_A`, `READ_ONLY_A`, `selectorHealthApp(auth)`, `seedSelectorHealth(db, now?)`.

- [ ] **Step 1: Write the fixture**

`test/helpers/selector-health-fixture.ts`:

```ts
import express from 'express';
import type { PrismaClient } from '../../src/generated/client';
import DashboardRouter from '../../src/app/routers/dashboard';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export const TEAM = { a: 'sh-team-a', b: 'sh-team-b' };
export const USER = { priya: 'sh-u-priya', alex: 'sh-u-alex', gone: 'sh-u-gone' };
export const PHONE = { shared: 'sh-phone-shared', a: 'sh-phone-a', b: 'sh-phone-b' };
export const BUILD = { id: 'sh-build-1', name: 'nightly-2026-10-01' };

/** What each selector stands for is in seedSelectorHealth. */
export const SEL = {
  hot: '//android.widget.Button[@text="Confirm"]',
  warm: 'com.acme:id/cart_total',
  bOnly: '//team-b/only',
  pending: '//being/verified',
  fixed: '//fixed/recently',
  fixedOld: '//fixed/long/ago',
  muted: '//muted/by/priya',
  mutedB: '//muted/team-b',
  legacy: '//legacy/no-strategy',
  odd: `//*[@text='50% off & "free" #1? [x]']`,
};

export const FIX = {
  hot: '//android.widget.Button[@content-desc="Confirm order"]',
  hotLlm: 'confirm_order',
  warm: 'com.acme:id/cart_total_v2',
};

export const ADMIN = {
  kind: 'user',
  userId: 'sh-u-admin',
  role: 'SUPER_ADMIN',
  scopes: 'admin,devices,sessions,read',
  teamIds: undefined,
};
export const MEMBER_A = {
  kind: 'user',
  userId: USER.priya,
  role: 'MEMBER',
  scopes: 'devices,sessions,read',
  teamIds: [TEAM.a],
};
export const READ_ONLY_A = {
  kind: 'api-key',
  userId: USER.priya,
  role: 'MEMBER',
  scopes: 'read',
  teamIds: [TEAM.a],
};

/** The dashboard routes, with `auth` as the signed-in caller. */
export function selectorHealthApp(auth: Record<string, unknown>) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { auth: Record<string, unknown> }).auth = auth;
    next();
  });
  DashboardRouter.register(a as never);
  return a;
}

/**
 * Two teams, a shared phone and one phone each, four sessions, and heals:
 * - hot: 4 heals on the shared phone (3 Visual AI, 1 LLM), the latest an hour
 *   ago; it broke again twice after being fixed;
 * - warm: 2 heals on team A's phone, 3 days ago, the slowest (20 s each);
 * - bOnly: 3 heals on team B's iPhone only;
 * - pending: being verified (2 of 3 clean builds), marked fixed by Priya;
 * - fixed: verified 2 days ago, marked fixed by a user who has been deleted;
 * - fixedOld: verified 60 days ago;
 * - muted: muted by Priya, with a reason; mutedB: muted by Alex, team B only;
 * - legacy: a heal with no strategy; odd: a selector full of punctuation.
 */
export async function seedSelectorHealth(db: PrismaClient, now = Date.now()): Promise<void> {
  await db.team.create({ data: { id: TEAM.a, name: 'Team A' } });
  await db.team.create({ data: { id: TEAM.b, name: 'Team B' } });
  for (const [id, name] of [
    [USER.priya, 'Priya'],
    [USER.alex, 'Alex'],
  ]) {
    await db.user.create({
      data: { id, name, email: `${id}@xenon.local`, passwordHash: 'x', accessKey: `ak-${id}` },
    });
  }
  const phones: Array<[string, string, string, string | null]> = [
    [PHONE.shared, 'Shared Pixel', 'android', null],
    [PHONE.a, 'Team A Galaxy', 'android', TEAM.a],
    [PHONE.b, 'Team B iPhone', 'ios', TEAM.b],
  ];
  for (const [udid, name, platform, teamId] of phones) {
    await db.device.create({ data: { udid, host: 'localhost', name, platform, teamId } as never });
  }
  await db.build.create({ data: { id: BUILD.id, name: BUILD.name } });

  const session = (id: string, udid: string, name: string, platform: string, buildId: string | null) =>
    db.session.create({
      data: {
        id,
        device_udid: udid,
        device_name: name,
        device_platform: platform,
        build_id: buildId,
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'localhost',
        has_live_video: false,
        device_version: '14',
        status: 'passed',
      } as never,
    });
  await session('sh-s-shared-1', PHONE.shared, 'Shared Pixel', 'android', BUILD.id);
  await session('sh-s-shared-2', PHONE.shared, 'Shared Pixel', 'android', null);
  await session('sh-s-a-1', PHONE.a, 'Team A Galaxy', 'android', BUILD.id);
  await session('sh-s-b-1', PHONE.b, 'Team B iPhone', 'ios', null);

  const heal = (sessionId: string, selector: string, ageMs: number, over: Record<string, unknown> = {}) =>
    db.sessionLog.create({
      data: {
        session_id: sessionId,
        url: '/element',
        method: 'POST',
        title: 'findElement',
        response: '{}',
        command_name: 'findElement',
        is_healed: true,
        original_strategy: 'xpath',
        original_selector: selector,
        healed_strategy: 'xpath',
        healed_selector: `${selector}-healed`,
        healing_tier: 'Fuzzy XML',
        healing_confidence: 0.8,
        duration: 1000,
        createdAt: new Date(now - ageMs),
        ...over,
      } as never,
    });

  for (const age of [1, 1.5, 3]) {
    await heal('sh-s-shared-1', SEL.hot, age * HOUR, {
      healed_selector: FIX.hot,
      healing_tier: 'Visual AI',
      healing_confidence: 0.9,
      duration: 3000,
    });
  }
  await heal('sh-s-shared-2', SEL.hot, 4 * HOUR, {
    healed_selector: FIX.hotLlm,
    healed_strategy: 'accessibility id',
    healing_tier: 'LLM',
    healing_confidence: 0.5,
    duration: 9000,
  });
  // A lookup of the same selector that needed no healing is never counted.
  await db.sessionLog.create({
    data: {
      session_id: 'sh-s-shared-1',
      url: '/element',
      method: 'POST',
      title: 'findElement',
      response: '{}',
      command_name: 'findElement',
      is_healed: false,
      original_strategy: 'xpath',
      original_selector: SEL.hot,
    } as never,
  });
  for (const age of [3, 3.1]) {
    await heal('sh-s-a-1', SEL.warm, age * DAY, {
      original_strategy: 'id',
      healed_strategy: 'id',
      healed_selector: FIX.warm,
      duration: 20000,
    });
  }
  for (const age of [1, 1.1, 1.2]) await heal('sh-s-b-1', SEL.bOnly, age * DAY);
  await heal('sh-s-shared-1', SEL.pending, 10 * DAY);
  await heal('sh-s-a-1', SEL.fixed, 20 * DAY);
  await heal('sh-s-shared-1', SEL.fixedOld, 89 * DAY);
  await heal('sh-s-a-1', SEL.muted, 1 * DAY);
  await heal('sh-s-b-1', SEL.mutedB, 1 * DAY);
  await heal('sh-s-shared-2', SEL.legacy, 5 * HOUR, { original_strategy: null });
  await heal('sh-s-shared-2', SEL.odd, 6 * HOUR);

  const state = (selector: string, data: Record<string, unknown>) =>
    db.selectorState.create({
      data: { original_strategy: 'xpath', original_selector: selector, ...data } as never,
    });
  await state(SEL.hot, { status: 'active', regression_count: 2 });
  await state(SEL.pending, { status: 'pending', fixed_at: new Date(now - 5 * DAY), clean_builds_count: 2 });
  await state(SEL.fixed, {
    status: 'resolved',
    fixed_at: new Date(now - 9 * DAY),
    resolved_at: new Date(now - 2 * DAY),
    clean_builds_count: 3,
  });
  await state(SEL.fixedOld, {
    status: 'resolved',
    fixed_at: new Date(now - 70 * DAY),
    resolved_at: new Date(now - 60 * DAY),
    clean_builds_count: 3,
  });
  await state(SEL.muted, { status: 'muted', muted_at: new Date(now - 1 * DAY) });
  await state(SEL.mutedB, { status: 'muted', muted_at: new Date(now - 2 * DAY) });

  const event = (
    selector: string,
    action: string,
    userId: string | null,
    ageMs: number,
    reason: string | null = null,
  ) =>
    db.selectorEvent.create({
      data: {
        original_strategy: 'xpath',
        original_selector: selector,
        action,
        user_id: userId,
        reason,
        createdAt: new Date(now - ageMs),
      },
    });
  await event(SEL.pending, 'marked_fixed', USER.priya, 5 * DAY);
  await event(SEL.fixed, 'marked_fixed', USER.gone, 9 * DAY);
  await event(SEL.fixed, 'verified', null, 2 * DAY);
  await event(SEL.muted, 'muted', USER.priya, 1 * DAY, 'Screen being redesigned');
  await event(SEL.mutedB, 'muted', USER.alex, 2 * DAY);
}
```

- [ ] **Step 2: Write the failing test**

`test/unit/selector-health-list.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  ADMIN,
  FIX,
  HOUR,
  MEMBER_A,
  READ_ONLY_A,
  SEL,
  USER,
  seedSelectorHealth,
  selectorHealthApp,
} from '../helpers/selector-health-fixture';
import { parseSelectorListQuery } from '../../src/services/selector-health/selectorList';

describe('selector list: the query', () => {
  it('reads every field, and falls back for anything it does not know', () => {
    expect(parseSelectorListQuery({})).to.deep.equal({
      tab: 'fix',
      days: 30,
      q: '',
      platform: null,
      method: null,
      sort: 'heals',
      page: 1,
      pageSize: 50,
    });
    expect(
      parseSelectorListQuery({
        tab: 'muted',
        days: '7',
        q: '  confirm ',
        platform: 'ios',
        method: 'LLM',
        sort: 'time',
        page: '3',
        pageSize: '20',
      }),
    ).to.deep.equal({
      tab: 'muted',
      days: 7,
      q: 'confirm',
      platform: 'ios',
      method: 'LLM',
      sort: 'time',
      page: 3,
      pageSize: 20,
    });
    expect(
      parseSelectorListQuery({ tab: 'active', days: '9999', sort: 'random', page: '-2', pageSize: '1000' }),
    ).to.include({ tab: 'fix', days: 365, sort: 'heals', page: 1, pageSize: 100 });
  });
});

describe('GET /healing/selectors (real queries)', function () {
  this.timeout(90_000);
  const scratch = useScratchDatabase();

  before(async () => {
    await seedSelectorHealth(scratch.db);
  });

  const list = (auth: Record<string, unknown>, qs = '') =>
    request(selectorHealthApp(auth)).get(`/healing/selectors${qs}`);
  const names = (res: request.Response) =>
    res.body.items.map((i: { selector: string }) => i.selector);

  it('lists what to fix, most heals first, with every tab counted', async () => {
    const res = await list(ADMIN);
    expect(res.status).to.equal(200);
    expect(names(res)).to.deep.equal([SEL.hot, SEL.bOnly, SEL.warm, SEL.legacy, SEL.odd]);
    expect(res.body.counts).to.deep.equal({ fix: 5, verifying: 1, fixed: 1, muted: 2 });
    expect(res.body).to.include({ tab: 'fix', days: 30, page: 1, pageSize: 50, total: 5, canAct: true });
  });

  it('describes each selector: heals, sessions, time, method, suggestion and status', async () => {
    const hot = (await list(ADMIN)).body.items[0];
    expect(hot).to.deep.include({
      strategy: 'xpath',
      selector: SEL.hot,
      heals: 4,
      sessions: 2,
      timeSpentMs: 18000,
      topMethod: 'Visual AI',
    });
    expect(hot.suggestion).to.deep.equal({ selector: FIX.hot, strategy: 'xpath', share: 0.75 });
    expect(hot.state).to.include({ status: 'active', brokeAgain: 2 });
    expect(Date.now() - Date.parse(hot.lastHealedAt)).to.be.within(0.9 * HOUR, 1.5 * HOUR);
  });

  it('lists a heal with no strategy under an empty one', async () => {
    const legacy = (await list(ADMIN)).body.items.find(
      (i: { selector: string }) => i.selector === SEL.legacy,
    );
    expect(legacy).to.deep.include({ strategy: '', heals: 1 });
  });

  it('shows a member only selectors healed in sessions they can see, and counts only those', async () => {
    const res = await list(MEMBER_A);
    expect(names(res)).to.deep.equal([SEL.hot, SEL.warm, SEL.legacy, SEL.odd]);
    expect(res.body.counts).to.deep.equal({ fix: 4, verifying: 1, fixed: 1, muted: 1 });
  });

  it('sorts by most recent and by most time spent healing', async () => {
    expect(names(await list(ADMIN, '?sort=recent'))).to.deep.equal([
      SEL.hot,
      SEL.legacy,
      SEL.odd,
      SEL.bOnly,
      SEL.warm,
    ]);
    expect(names(await list(ADMIN, '?sort=time'))).to.deep.equal([
      SEL.warm,
      SEL.hot,
      SEL.bOnly,
      SEL.legacy,
      SEL.odd,
    ]);
  });

  it('searches the selector and its suggested fix, taking the text literally', async () => {
    expect(names(await list(ADMIN, '?q=CONFIRM'))).to.deep.equal([SEL.hot]);
    expect(names(await list(ADMIN, `?q=${encodeURIComponent('cart_total_v2')}`))).to.deep.equal([SEL.warm]);
    expect(names(await list(ADMIN, `?q=${encodeURIComponent('%')}`))).to.deep.equal([SEL.odd]);
  });

  it('filters what to fix by platform and by healing method, keeping the counts whole', async () => {
    expect(names(await list(ADMIN, '?platform=ios'))).to.deep.equal([SEL.bOnly]);
    const llm = await list(ADMIN, '?method=LLM');
    expect(names(llm)).to.deep.equal([SEL.hot]);
    expect(llm.body.items[0]).to.deep.include({ heals: 1, topMethod: 'LLM' });
    expect(llm.body.counts.fix).to.equal(5);
  });

  it('pages, and shows the last page for a page past the end', async () => {
    expect(names(await list(ADMIN, '?pageSize=2&page=2'))).to.deep.equal([SEL.warm, SEL.legacy]);
    const past = await list(ADMIN, '?pageSize=2&page=99');
    expect(past.body.page).to.equal(3);
    expect(past.body.total).to.equal(5);
    expect(names(past)).to.deep.equal([SEL.odd]);
  });

  it('lists selectors being verified, with their progress and who marked them fixed', async () => {
    const res = await list(MEMBER_A, '?tab=verifying');
    expect(names(res)).to.deep.equal([SEL.pending]);
    expect(res.body.items[0].heals).to.equal(1);
    expect(res.body.items[0].state).to.deep.include({
      status: 'pending',
      cleanBuilds: 2,
      fixedBy: { id: USER.priya, name: 'Priya' },
    });
  });

  it('lists selectors fixed in the period, with or without a heal in it', async () => {
    expect(names(await list(ADMIN, '?tab=fixed'))).to.deep.equal([SEL.fixed]);
    expect(names(await list(ADMIN, '?tab=fixed&days=90'))).to.deep.equal([SEL.fixed, SEL.fixedOld]);
    const week = await list(ADMIN, '?tab=fixed&days=7');
    expect(names(week)).to.deep.equal([SEL.fixed]);
    expect(week.body.items[0]).to.deep.include({ heals: 0, sessions: 0, lastHealedAt: null, suggestion: null });
  });

  it('names nobody for an action by a user who is gone', async () => {
    const fixed = (await list(ADMIN, '?tab=fixed')).body.items[0];
    expect(fixed.state.fixedBy).to.deep.equal({ id: USER.gone, name: null });
  });

  it('lists muted selectors with who muted them and why, only those a member can see', async () => {
    const res = await list(MEMBER_A, '?tab=muted');
    expect(names(res)).to.deep.equal([SEL.muted]);
    expect(res.body.items[0].state).to.deep.include({
      status: 'muted',
      mutedBy: { id: USER.priya, name: 'Priya' },
      muteReason: 'Screen being redesigned',
    });
    expect(names(await list(ADMIN, '?tab=muted'))).to.deep.equal([SEL.muted, SEL.mutedB]);
  });

  it('searches a status tab by selector', async () => {
    expect(names(await list(ADMIN, '?tab=muted&q=team-b'))).to.deep.equal([SEL.mutedB]);
  });

  it('tells a caller without the sessions scope that they cannot act', async () => {
    expect((await list(READ_ONLY_A)).body.canAct).to.equal(false);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/selector-health-list.spec.ts`
Expected: FAIL, cannot find module `selectorList`.

- [ ] **Step 4: Write the key, access, people and status helpers**

`src/services/selector-health/selectorKeys.ts`:

```ts
import type { Prisma } from '../../generated/client';

/** One selector as the dashboard names it. A heal recorded with no strategy has strategy ''. */
export interface SelectorKey {
  strategy: string;
  selector: string;
}

/** The caller's sessions as a Session `where`; undefined for an admin, or with auth disabled. */
export type SessionScope = Prisma.SessionWhereInput | undefined;

/** One map key per selector; a heal with no strategy files under ''. */
export const keyOf = (strategy: string | null | undefined, selector: string): string =>
  `${strategy ?? ''}\u0000${selector}`;

/** Heal rows of one selector. Heals with no strategy match the empty one. */
export function tupleWhere(strategy: string, selector: string): Prisma.SessionLogWhereInput {
  return strategy
    ? { original_strategy: strategy, original_selector: selector }
    : {
        original_selector: selector,
        OR: [{ original_strategy: null }, { original_strategy: '' }],
      };
}

/** Heal rows in the caller's sessions, on one platform if given. */
export function sessionScope(scope: SessionScope, platform?: string | null): Prisma.SessionLogWhereInput {
  const parts: Prisma.SessionWhereInput[] = [];
  if (platform) parts.push({ device_platform: platform });
  if (scope) parts.push(scope);
  if (parts.length === 0) return {};
  return { session: { is: parts.length === 1 ? parts[0] : { AND: parts } } };
}

/** `items` in runs of at most `size`, so no `OR` list grows without bound. */
export function chunk<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
```

`src/services/selector-health/access.ts`:

```ts
import { prisma } from '../../prisma';
import { SelectorKey, SessionScope, chunk, keyOf, sessionScope, tupleWhere } from './selectorKeys';

/** The answer for a selector the caller may not see, the same as for one that doesn't exist. */
export const SELECTOR_NOT_FOUND = { error: 'not_found', message: 'Selector not found' };

/**
 * The keys among `keys` the caller may see: those healed, at any time, in a
 * session the caller may see. All of them for an admin or with auth disabled.
 */
export async function visibleKeys(keys: SelectorKey[], scope: SessionScope): Promise<Set<string>> {
  if (!scope) return new Set(keys.map((k) => keyOf(k.strategy, k.selector)));
  const seen = new Set<string>();
  for (const part of chunk(keys)) {
    const groups = await prisma.sessionLog.groupBy({
      by: ['original_strategy', 'original_selector'],
      where: {
        AND: [
          { is_healed: true },
          sessionScope(scope),
          { OR: part.map((k) => tupleWhere(k.strategy, k.selector)) },
        ],
      },
    });
    for (const g of groups) {
      if (g.original_selector) seen.add(keyOf(g.original_strategy, g.original_selector));
    }
  }
  return seen;
}

/** Whether the caller may see one selector, by the same rule. */
export async function canSeeSelector(key: SelectorKey, scope: SessionScope): Promise<boolean> {
  if (!scope) return true;
  const row = await prisma.sessionLog.findFirst({
    where: { AND: [{ is_healed: true }, tupleWhere(key.strategy, key.selector), sessionScope(scope)] },
    select: { id: true },
  });
  return row !== null;
}

/** Mark fixed, mute, unmute and cancel need the `sessions` scope; `admin` has every scope. */
export function canActOnSelectors(scopes: string | string[] | undefined): boolean {
  const owned = new Set(
    (Array.isArray(scopes) ? scopes : (scopes ?? '').split(',')).map((s) => s.trim()),
  );
  return owned.has('admin') || owned.has('sessions');
}
```

`src/services/selector-health/people.ts`:

```ts
import { prisma } from '../../prisma';

/** Who did something. `name` is null for a deleted user, or with auth disabled. */
export interface Person {
  id: string;
  name: string | null;
}

/** The people behind these user ids, by id. */
export async function peopleById(ids: Array<string | null | undefined>): Promise<Map<string, Person>> {
  const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
  if (wanted.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return new Map(wanted.map((id) => [id, { id, name: names.get(id) ?? null }]));
}
```

`src/services/selector-health/stateView.ts`:

```ts
import type { SelectorState } from '../../generated/client';
import { prisma } from '../../prisma';
import { Person } from './people';
import { SelectorKey, chunk, keyOf } from './selectorKeys';

/** A selector's status as the dashboard shows it. */
export interface StateView {
  status: string;
  cleanBuilds: number;
  fixedAt: string | null;
  fixedBy: Person | null;
  resolvedAt: string | null;
  mutedAt: string | null;
  mutedBy: Person | null;
  muteReason: string | null;
  /** How often it healed again after being fixed. */
  brokeAgain: number;
}

/** The latest "marked fixed" and "muted" events of one selector. */
export interface LatestEvents {
  fixed?: { user_id: string | null };
  muted?: { user_id: string | null; reason: string | null };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function stateView(
  row: SelectorState | null,
  latest: LatestEvents,
  people: Map<string, Person>,
): StateView | null {
  if (!row) return null;
  const person = (id: string | null | undefined): Person | null =>
    id ? (people.get(id) ?? { id, name: null }) : null;
  const muted = row.status === 'muted';
  return {
    status: row.status,
    cleanBuilds: row.clean_builds_count,
    fixedAt: iso(row.fixed_at),
    fixedBy: row.fixed_at ? person(latest.fixed?.user_id) : null,
    resolvedAt: iso(row.resolved_at),
    mutedAt: iso(row.muted_at),
    mutedBy: muted ? person(latest.muted?.user_id) : null,
    muteReason: muted ? (latest.muted?.reason ?? null) : null,
    brokeAgain: row.regression_count,
  };
}

/** The latest "marked fixed" and "muted" events of each selector, by key. */
export async function latestEvents(keys: SelectorKey[]): Promise<Map<string, LatestEvents>> {
  const out = new Map<string, LatestEvents>();
  for (const part of chunk(keys)) {
    const events = await prisma.selectorEvent.findMany({
      where: {
        action: { in: ['marked_fixed', 'muted'] },
        OR: part.map((k) => ({ original_strategy: k.strategy, original_selector: k.selector })),
      },
      orderBy: { createdAt: 'desc' },
      select: { original_strategy: true, original_selector: true, action: true, user_id: true, reason: true },
    });
    for (const e of events) {
      const key = keyOf(e.original_strategy, e.original_selector);
      const cur = out.get(key) ?? {};
      if (e.action === 'marked_fixed' && !cur.fixed) cur.fixed = { user_id: e.user_id };
      if (e.action === 'muted' && !cur.muted) cur.muted = { user_id: e.user_id, reason: e.reason };
      out.set(key, cur);
    }
  }
  return out;
}
```

- [ ] **Step 5: Write the list**

`src/services/selector-health/selectorList.ts`:

```ts
import type { Prisma, SelectorState } from '../../generated/client';
import { prisma } from '../../prisma';
import { visibleKeys } from './access';
import { DAY_MS } from './healingTrend';
import { peopleById } from './people';
import { SelectorKey, SessionScope, chunk, keyOf, sessionScope, tupleWhere } from './selectorKeys';
import { LatestEvents, StateView, latestEvents, stateView } from './stateView';

export const TABS = ['fix', 'verifying', 'fixed', 'muted'] as const;
export type SelectorTab = (typeof TABS)[number];
export const SORTS = ['heals', 'recent', 'time'] as const;
export type SelectorSort = (typeof SORTS)[number];

type StatusTab = Exclude<SelectorTab, 'fix'>;

/** Statuses that take a selector off "To fix". */
const OTHER_STATUSES = ['pending', 'resolved', 'muted'];

export interface SelectorListQuery {
  tab: SelectorTab;
  days: number;
  q: string;
  platform: string | null;
  method: string | null;
  sort: SelectorSort;
  page: number;
  pageSize: number;
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function whole(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback;
  return Math.min(Math.max(Number(raw), min), max);
}

function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

export function parseSelectorListQuery(q: Record<string, unknown>): SelectorListQuery {
  return {
    tab: pick(q.tab, TABS, 'fix'),
    days: whole(q.days, 30, 1, 365),
    q: text(q.q, 200),
    platform: text(q.platform, 40) || null,
    method: text(q.method, 40) || null,
    sort: pick(q.sort, SORTS, 'heals'),
    page: whole(q.page, 1, 1, 100_000),
    pageSize: whole(q.pageSize, 50, 1, 100),
  };
}

export interface SelectorListItem {
  strategy: string;
  selector: string;
  heals: number;
  sessions: number;
  lastHealedAt: string | null;
  timeSpentMs: number;
  topMethod: string | null;
  suggestion: { selector: string; strategy: string | null; share: number } | null;
  state: StateView | null;
}

export interface SelectorListAnswer {
  tab: SelectorTab;
  days: number;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<SelectorTab, number>;
  items: SelectorListItem[];
}

interface HealGroup extends SelectorKey {
  key: string;
  heals: number;
  lastHealedAt: Date | null;
  timeSpentMs: number;
}

interface PageExtras {
  sessions: number;
  topMethod: string | null;
  suggestion: { selector: string; strategy: string | null; count: number } | null;
}

/** Heals in the period, in the caller's sessions, on a platform and by a method if given. */
function healWhere(
  since: Date,
  scope: SessionScope,
  platform: string | null,
  method: string | null,
): Prisma.SessionLogWhereInput {
  return {
    AND: [
      { is_healed: true, createdAt: { gte: since }, original_selector: { not: null } },
      method ? { healing_tier: method } : {},
      sessionScope(scope, platform),
    ],
  };
}

const forKeys = (where: Prisma.SessionLogWhereInput, keys: SelectorKey[]): Prisma.SessionLogWhereInput => ({
  AND: [where, { OR: keys.map((k) => tupleWhere(k.strategy, k.selector)) }],
});

/** Heals, latest heal and time spent per selector, counted by the database: no heal is left out. */
async function healGroups(where: Prisma.SessionLogWhereInput): Promise<Map<string, HealGroup>> {
  const groups = await prisma.sessionLog.groupBy({
    by: ['original_strategy', 'original_selector'],
    where,
    _count: { _all: true },
    _max: { createdAt: true },
    _sum: { duration: true },
  });
  const out = new Map<string, HealGroup>();
  for (const g of groups) {
    const selector = g.original_selector;
    if (!selector) continue;
    const key = keyOf(g.original_strategy, selector);
    const prev = out.get(key);
    const last = g._max.createdAt ?? null;
    const prevLast = prev?.lastHealedAt ?? null;
    out.set(key, {
      key,
      strategy: g.original_strategy ?? '',
      selector,
      heals: (prev?.heals ?? 0) + g._count._all,
      lastHealedAt: prevLast && last ? (prevLast > last ? prevLast : last) : (prevLast ?? last),
      timeSpentMs: (prev?.timeSpentMs ?? 0) + (g._sum.duration ?? 0),
    });
  }
  return out;
}

/** The value counted most often; the first one seen on a tie. */
function topOf<T>(counts: Map<T, number>): T | null {
  let top: T | null = null;
  let best = -1;
  for (const [value, n] of counts) {
    if (n > best) {
      top = value;
      best = n;
    }
  }
  return top;
}

/** Sessions, top method and top suggestion, for one page's selectors only. */
async function pageExtras(where: Prisma.SessionLogWhereInput, keys: SelectorKey[]): Promise<Map<string, PageExtras>> {
  const out = new Map<string, PageExtras>();
  if (keys.length === 0) return out;
  const scoped = forKeys(where, keys);
  const [bySession, byMethod, byFix] = await Promise.all([
    prisma.sessionLog.groupBy({ by: ['original_strategy', 'original_selector', 'session_id'], where: scoped }),
    prisma.sessionLog.groupBy({
      by: ['original_strategy', 'original_selector', 'healing_tier'],
      where: scoped,
      _count: { _all: true },
    }),
    prisma.sessionLog.groupBy({
      by: ['original_strategy', 'original_selector', 'healed_selector', 'healed_strategy'],
      where: { AND: [scoped, { healed_selector: { not: null } }] },
      _count: { _all: true },
    }),
  ]);
  const entry = (key: string): PageExtras => {
    let e = out.get(key);
    if (!e) {
      e = { sessions: 0, topMethod: null, suggestion: null };
      out.set(key, e);
    }
    return e;
  };
  for (const g of bySession) entry(keyOf(g.original_strategy, g.original_selector ?? '')).sessions += 1;

  const methods = new Map<string, Map<string, number>>();
  for (const g of byMethod) {
    if (!g.healing_tier) continue;
    const key = keyOf(g.original_strategy, g.original_selector ?? '');
    const m = methods.get(key) ?? new Map<string, number>();
    m.set(g.healing_tier, (m.get(g.healing_tier) ?? 0) + g._count._all);
    methods.set(key, m);
  }
  for (const [key, m] of methods) entry(key).topMethod = topOf(m);

  const fixes = new Map<string, Map<string, number>>();
  const fixOf = new Map<string, { selector: string; strategy: string | null }>();
  for (const g of byFix) {
    if (!g.healed_selector) continue;
    const key = keyOf(g.original_strategy, g.original_selector ?? '');
    const fixKey = keyOf(g.healed_strategy, g.healed_selector);
    fixOf.set(fixKey, { selector: g.healed_selector, strategy: g.healed_strategy ?? null });
    const m = fixes.get(key) ?? new Map<string, number>();
    m.set(fixKey, (m.get(fixKey) ?? 0) + g._count._all);
    fixes.set(key, m);
  }
  for (const [key, m] of fixes) {
    const top = topOf(m);
    const fix = top ? fixOf.get(top) : undefined;
    if (top && fix) entry(key).suggestion = { ...fix, count: m.get(top) ?? 0 };
  }
  return out;
}

/** Selectors whose suggested fix contains `needle` (lower case), compared here so `%` and `_` are plain text. */
async function keysWithFixMatching(where: Prisma.SessionLogWhereInput, needle: string): Promise<Set<string>> {
  const pairs = await prisma.sessionLog.groupBy({
    by: ['original_strategy', 'original_selector', 'healed_selector'],
    where: { AND: [where, { healed_selector: { not: null } }] },
  });
  const out = new Set<string>();
  for (const p of pairs) {
    if (p.original_selector && p.healed_selector?.toLowerCase().includes(needle)) {
      out.add(keyOf(p.original_strategy, p.original_selector));
    }
  }
  return out;
}

const time = (d: Date | null | undefined) => d?.getTime() ?? 0;
const byKey = (a: HealGroup, b: HealGroup) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const byLast = (a: HealGroup, b: HealGroup) => time(b.lastHealedAt) - time(a.lastHealedAt);

const SORTERS: Record<SelectorSort, (a: HealGroup, b: HealGroup) => number> = {
  heals: (a, b) => b.heals - a.heals || byLast(a, b) || byKey(a, b),
  recent: (a, b) => byLast(a, b) || b.heals - a.heals || byKey(a, b),
  time: (a, b) => b.timeSpentMs - a.timeSpentMs || b.heals - a.heals || byKey(a, b),
};

const STATUS_OF: Record<StatusTab, string> = { verifying: 'pending', fixed: 'resolved', muted: 'muted' };

const NEWEST_FIRST: Record<StatusTab, (a: SelectorState, b: SelectorState) => number> = {
  verifying: (a, b) => time(b.fixed_at) - time(a.fixed_at),
  fixed: (a, b) => time(b.resolved_at) - time(a.resolved_at),
  muted: (a, b) => time(b.muted_at) - time(a.muted_at),
};

/** `page` of `all`, or its last page when `page` is past the end. */
function pageOf<T>(all: T[], page: number, size: number): { page: number; slice: T[] } {
  const last = Math.max(1, Math.ceil(all.length / size));
  const p = Math.min(page, last);
  return { page: p, slice: all.slice((p - 1) * size, p * size) };
}

const keyOfState = (s: SelectorState) => keyOf(s.original_strategy, s.original_selector);
const toKey = (s: SelectorState): SelectorKey => ({ strategy: s.original_strategy, selector: s.original_selector });

async function stateRows(keys: SelectorKey[]): Promise<SelectorState[]> {
  const out: SelectorState[] = [];
  for (const part of chunk(keys)) {
    out.push(
      ...(await prisma.selectorState.findMany({
        where: { OR: part.map((k) => ({ original_strategy: k.strategy, original_selector: k.selector })) },
      })),
    );
  }
  return out;
}

async function stateViews(rows: SelectorState[]): Promise<Map<string, StateView>> {
  const latest = await latestEvents(rows.map(toKey));
  const people = await peopleById(
    Array.from(latest.values()).flatMap((l: LatestEvents) => [l.fixed?.user_id, l.muted?.user_id]),
  );
  const out = new Map<string, StateView>();
  for (const r of rows) {
    const view = stateView(r, latest.get(keyOfState(r)) ?? {}, people);
    if (view) out.set(keyOfState(r), view);
  }
  return out;
}

function item(
  k: SelectorKey,
  g: HealGroup | undefined,
  extras: PageExtras | undefined,
  state: StateView | null,
): SelectorListItem {
  const heals = g?.heals ?? 0;
  const s = extras?.suggestion;
  return {
    strategy: k.strategy,
    selector: k.selector,
    heals,
    sessions: extras?.sessions ?? 0,
    lastHealedAt: g?.lastHealedAt ? g.lastHealedAt.toISOString() : null,
    timeSpentMs: g?.timeSpentMs ?? 0,
    topMethod: extras?.topMethod ?? null,
    suggestion: s && heals > 0 ? { selector: s.selector, strategy: s.strategy, share: s.count / heals } : null,
    state,
  };
}

/**
 * One tab of the list. "To fix" groups the period's heals by selector and
 * leaves out those with another status; the other tabs start from the
 * selectors with their status. Only selectors the caller may see.
 */
export async function listSelectors(
  query: SelectorListQuery,
  scope: SessionScope,
  now = new Date(),
): Promise<SelectorListAnswer> {
  const since = new Date(now.getTime() - query.days * DAY_MS);
  const states = await prisma.selectorState.findMany({ where: { status: { in: OTHER_STATUSES } } });
  const visible = await visibleKeys(states.map(toKey), scope);
  const seen = states.filter((s) => visible.has(keyOfState(s)));
  const inTab: Record<StatusTab, SelectorState[]> = {
    verifying: seen.filter((s) => s.status === STATUS_OF.verifying),
    fixed: seen.filter((s) => s.status === STATUS_OF.fixed && !!s.resolved_at && s.resolved_at >= since),
    muted: seen.filter((s) => s.status === STATUS_OF.muted),
  };
  const notToFix = new Set(states.map(keyOfState));
  const allHeals = healWhere(since, scope, null, null);
  const base = await healGroups(allHeals);
  const counts: Record<SelectorTab, number> = {
    fix: Array.from(base.keys()).filter((k) => !notToFix.has(k)).length,
    verifying: inTab.verifying.length,
    fixed: inTab.fixed.length,
    muted: inTab.muted.length,
  };
  const answer = (total: number, page: number, items: SelectorListItem[]): SelectorListAnswer => ({
    tab: query.tab,
    days: query.days,
    page,
    pageSize: query.pageSize,
    total,
    counts,
    items,
  });
  const needle = query.q.toLowerCase();

  if (query.tab === 'fix') {
    const filtered = !!(query.platform || query.method);
    const where = filtered ? healWhere(since, scope, query.platform, query.method) : allHeals;
    const groups = filtered ? await healGroups(where) : base;
    let candidates = Array.from(groups.values()).filter((g) => !notToFix.has(g.key));
    if (needle) {
      const viaFix = await keysWithFixMatching(where, needle);
      candidates = candidates.filter((g) => g.selector.toLowerCase().includes(needle) || viaFix.has(g.key));
    }
    candidates.sort(SORTERS[query.sort]);
    const { page, slice } = pageOf(candidates, query.page, query.pageSize);
    const [extras, rows] = await Promise.all([pageExtras(where, slice), stateRows(slice)]);
    const views = await stateViews(rows);
    return answer(
      candidates.length,
      page,
      slice.map((g) => item(g, g, extras.get(g.key), views.get(g.key) ?? null)),
    );
  }

  let rows = inTab[query.tab];
  if (needle) rows = rows.filter((s) => s.original_selector.toLowerCase().includes(needle));
  rows = rows.slice().sort(NEWEST_FIRST[query.tab]);
  const { page, slice } = pageOf(rows, query.page, query.pageSize);
  const keys = slice.map(toKey);
  const [groups, extras, views] = await Promise.all([
    keys.length > 0 ? healGroups(forKeys(allHeals, keys)) : Promise.resolve(new Map<string, HealGroup>()),
    pageExtras(allHeals, keys),
    stateViews(slice),
  ]);
  return answer(
    rows.length,
    page,
    keys.map((k) => {
      const key = keyOf(k.strategy, k.selector);
      return item(k, groups.get(key), extras.get(key), views.get(key) ?? null);
    }),
  );
}
```

- [ ] **Step 6: Write the route and mount it**

`src/app/routers/selector-health.ts`:

```ts
import { Request, Response, Router } from 'express';
import type { Prisma } from '../../generated/client';
import log from '../../logger';
import { SessionCaller, visibleSessionWhere } from '../../services/device-access/sessionVisibility';
import { canActOnSelectors } from '../../services/selector-health/access';
import { listSelectors, parseSelectorListQuery } from '../../services/selector-health/selectorList';

type Caller = SessionCaller & { scopes?: string | string[] };

export const callerOf = (request: Request): Caller | undefined =>
  (request as Request & { auth?: Caller }).auth;

/** The caller's sessions as a Session `where`; undefined for an admin, or with auth disabled. */
export async function scopeOf(request: Request): Promise<Prisma.SessionWhereInput | undefined> {
  return (await visibleSessionWhere(callerOf(request))) as Prisma.SessionWhereInput | undefined;
}

/** One tab of Selector Health's list, the four tab counts, and whether the caller may act. */
export async function getSelectorList(request: Request, response: Response) {
  try {
    const query = parseSelectorListQuery(request.query as Record<string, unknown>);
    const answer = await listSelectors(query, await scopeOf(request));
    return response.status(200).json({ ...answer, canAct: canActOnSelectors(callerOf(request)?.scopes) });
  } catch (err) {
    log.error(`[SelectorHealth] list failed: ${(err as Error)?.message ?? err}`);
    return response.status(500).json({ error: 'internal' });
  }
}

function register(router: Router) {
  router.get('/healing/selectors', getSelectorList);
}

export default { register };
```

In `src/app/routers/dashboard.ts`, add the import:

```ts
import selectorHealthRoutes from './selector-health';
```

and in `register`, directly after `  router.get('/healing/selector-health', getSelectorHealth);`:

```ts
  // The Selector Health page's list and panel (selector-health.ts).
  selectorHealthRoutes.register(router);
```

In `src/app/swagger-docs.ts`, after the `/api/healing/summary` block's closing ` */`, add:

```
/**
 * @swagger
 * /api/healing/selectors:
 *   get:
 *     summary: One tab of the Selector Health list
 *     description: |
 *       `fix` groups the period's heals by selector and leaves out selectors
 *       being verified, fixed or muted; the other tabs list the selectors with
 *       that status (`fixed`: verified within the period). Only selectors
 *       healed, at any time, in sessions the caller can see. `counts` follow
 *       the period, not the search or filters. A page past the end answers the
 *       last page.
 *     tags: [Selector Health]
 *     parameters:
 *       - { in: query, name: tab, schema: { type: string, enum: [fix, verifying, fixed, muted], default: fix } }
 *       - { in: query, name: days, schema: { type: integer, minimum: 1, maximum: 365, default: 30 } }
 *       - { in: query, name: q, schema: { type: string }, description: 'Text in the selector, or (fix) in its suggested fix' }
 *       - { in: query, name: platform, schema: { type: string }, description: 'fix only' }
 *       - { in: query, name: method, schema: { type: string }, description: 'Healing method, e.g. LLM; fix only' }
 *       - { in: query, name: sort, schema: { type: string, enum: [heals, recent, time], default: heals }, description: 'fix only' }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100, default: 50 } }
 *     responses:
 *       200: { description: '`{ tab, days, page, pageSize, total, counts, canAct, items }`' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
```

- [ ] **Step 7: Run the test**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/selector-health-list.spec.ts`
Expected: PASS, 15 passing.

- [ ] **Step 8: Lint the new files**

Run: `npx eslint src/services/selector-health src/app/routers/selector-health.ts test/helpers/selector-health-fixture.ts test/unit/selector-health-list.spec.ts`
Expected: no findings. Fix any by hand (prettier `--write` is allowed on these new files).

- [ ] **Step 9: Commit**

```bash
git add src/services/selector-health/selectorKeys.ts src/services/selector-health/access.ts src/services/selector-health/people.ts src/services/selector-health/stateView.ts src/services/selector-health/selectorList.ts src/app/routers/selector-health.ts src/app/routers/dashboard.ts src/app/swagger-docs.ts test/helpers/selector-health-fixture.ts test/unit/selector-health-list.spec.ts
git commit -m "feat(selector-health): GET /healing/selectors: every heal counted, tabs from status, search, sort and paging"
```

---

### Task 6: `GET /healing/selectors/detail`, the panel

**Files:**
- Create: `src/services/selector-health/selectorDetail.ts`
- Modify: `src/app/routers/selector-health.ts` (new handler + route)
- Modify: `src/app/swagger-docs.ts` (new `/api/healing/selectors/detail` block)
- Test: `test/unit/selector-health-detail.spec.ts`

**Interfaces:**
- Consumes: `canSeeSelector`, `SELECTOR_NOT_FOUND`, `canActOnSelectors` (Task 5 `access.ts`); `sessionScope`, `tupleWhere`, `SessionScope` (`selectorKeys.ts`); `peopleById`, `Person`; `stateView`, `StateView`; `DAY_MS`, `dailyHeals`, `parseTzOffset` (Task 4); `callerOf`, `scopeOf` (Task 5 router).
- Produces:
  - `parseSelectorDetailQuery(q): { strategy; selector; days; tz } | null`
  - `selectorDetail(query, scope, now?): Promise<SelectorDetail | null>` with `SelectorDetail = { strategy, selector, days, heals, sessions, timeSpentMs, firstHealedAt, lastHealedAt, daily: {t, heals}[], suggestions: {selector, strategy, count, share, methods, averageConfidence}[], platforms: {name, count}[], builds: {id, name, count}[], devices: {udid, name, count}[], recent: {id, sessionId, buildId, at, device, platform, method, confidence, healedSelector}[], state: StateView | null, activity: {action, at, by: Person | null, reason}[] }`
  - Route answer: `SelectorDetail & { canAct: boolean }`; `400` without a selector; `404 SELECTOR_NOT_FOUND` for a hidden or unknown selector (for a member).

- [ ] **Step 1: Write the failing test**

`test/unit/selector-health-detail.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  ADMIN,
  BUILD,
  DAY,
  FIX,
  MEMBER_A,
  PHONE,
  READ_ONLY_A,
  SEL,
  USER,
  seedSelectorHealth,
  selectorHealthApp,
} from '../helpers/selector-health-fixture';
import { parseSelectorDetailQuery } from '../../src/services/selector-health/selectorDetail';

describe('selector panel: the query', () => {
  it('needs a selector, and reads the rest with defaults', () => {
    expect(parseSelectorDetailQuery({})).to.equal(null);
    expect(parseSelectorDetailQuery({ selector: '//a' })).to.deep.equal({
      strategy: '',
      selector: '//a',
      days: 30,
      tz: 0,
    });
    expect(
      parseSelectorDetailQuery({ strategy: 'xpath', selector: '//a', days: '7', tz: '330' }),
    ).to.deep.equal({ strategy: 'xpath', selector: '//a', days: 7, tz: 330 });
  });
});

describe('GET /healing/selectors/detail (real queries)', function () {
  this.timeout(90_000);
  const scratch = useScratchDatabase();

  before(async () => {
    await seedSelectorHealth(scratch.db);
  });

  const detail = (auth: Record<string, unknown>, query: Record<string, string>) =>
    request(selectorHealthApp(auth)).get('/healing/selectors/detail').query(query);

  it('answers everything the panel shows', async () => {
    const res = await detail(ADMIN, { strategy: 'xpath', selector: SEL.hot, days: '30', tz: '0' });
    expect(res.status).to.equal(200);
    const b = res.body;
    expect(b).to.deep.include({
      strategy: 'xpath',
      selector: SEL.hot,
      days: 30,
      heals: 4,
      sessions: 2,
      timeSpentMs: 18000,
      canAct: true,
    });
    expect(
      b.suggestions.map((s: Record<string, unknown>) => [s.selector, s.strategy, s.count, s.share, s.methods]),
    ).to.deep.equal([
      [FIX.hot, 'xpath', 3, 0.75, ['Visual AI']],
      [FIX.hotLlm, 'accessibility id', 1, 0.25, ['LLM']],
    ]);
    expect(b.suggestions[0].averageConfidence).to.be.closeTo(0.9, 1e-9);
    expect(b.platforms).to.deep.equal([{ name: 'android', count: 4 }]);
    expect(b.builds).to.deep.equal([
      { id: BUILD.id, name: BUILD.name, count: 3 },
      { id: null, name: 'No build', count: 1 },
    ]);
    expect(b.devices).to.deep.equal([{ udid: PHONE.shared, name: 'Shared Pixel', count: 4 }]);
    expect(b.recent).to.have.length(4);
    expect(b.recent[0]).to.include({
      sessionId: 'sh-s-shared-1',
      buildId: BUILD.id,
      device: 'Shared Pixel',
      method: 'Visual AI',
      healedSelector: FIX.hot,
    });
    expect(b.recent[3]).to.include({ sessionId: 'sh-s-shared-2', buildId: null, method: 'LLM' });
    expect(b.daily).to.have.length(31);
    expect(b.daily.reduce((s: number, d: { heals: number }) => s + d.heals, 0)).to.equal(4);
    expect(b.state).to.include({ status: 'active', brokeAgain: 2 });
    expect(b.activity).to.deep.equal([]);
  });

  it('shows who did what, newest first, naming nobody for a user who is gone', async () => {
    const b = (await detail(ADMIN, { strategy: 'xpath', selector: SEL.fixed })).body;
    expect(b.activity.map((a: Record<string, unknown>) => [a.action, a.by])).to.deep.equal([
      ['verified', null],
      ['marked_fixed', { id: USER.gone, name: null }],
    ]);
    expect(b.state).to.deep.include({ status: 'resolved', fixedBy: { id: USER.gone, name: null } });
  });

  it("gives a member a muted selector's reason, and who muted it", async () => {
    const b = (await detail(MEMBER_A, { strategy: 'xpath', selector: SEL.muted })).body;
    expect(b.activity).to.have.length(1);
    expect(b.activity[0]).to.deep.include({
      action: 'muted',
      by: { id: USER.priya, name: 'Priya' },
      reason: 'Screen being redesigned',
    });
    expect(b.state).to.deep.include({
      mutedBy: { id: USER.priya, name: 'Priya' },
      muteReason: 'Screen being redesigned',
    });
  });

  it("answers another team's selector exactly as one that doesn't exist", async () => {
    const hidden = await detail(MEMBER_A, { strategy: 'xpath', selector: SEL.bOnly });
    const missing = await detail(MEMBER_A, { strategy: 'xpath', selector: '//nothing/here' });
    expect(hidden.status).to.equal(404);
    expect(hidden.body).to.deep.equal({ error: 'not_found', message: 'Selector not found' });
    expect(missing.status).to.equal(404);
    expect(missing.body).to.deep.equal(hidden.body);
  });

  it('opens a heal recorded with no strategy, and a selector full of punctuation', async () => {
    expect((await detail(MEMBER_A, { strategy: '', selector: SEL.legacy })).body.heals).to.equal(1);
    expect((await detail(MEMBER_A, { strategy: 'xpath', selector: SEL.odd })).body.heals).to.equal(1);
  });

  it("counts days in the caller's time zone", async () => {
    const b = (await detail(ADMIN, { strategy: 'xpath', selector: SEL.hot, days: '7', tz: '330' })).body;
    expect(b.daily).to.have.length(8);
    for (const d of b.daily) expect((d.t + 330 * 60_000) % DAY).to.equal(0);
  });

  it('needs a selector', async () => {
    expect((await detail(ADMIN, {})).status).to.equal(400);
  });

  it('says a read-only caller cannot act', async () => {
    const b = (await detail(READ_ONLY_A, { strategy: 'xpath', selector: SEL.hot })).body;
    expect(b.canAct).to.equal(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/selector-health-detail.spec.ts`
Expected: FAIL, cannot find module `selectorDetail`.

- [ ] **Step 3: Write the panel's answer**

`src/services/selector-health/selectorDetail.ts`:

```ts
import { prisma } from '../../prisma';
import { canSeeSelector } from './access';
import { DAY_MS, dailyHeals, parseTzOffset } from './healingTrend';
import { Person, peopleById } from './people';
import { SessionScope, sessionScope, tupleWhere } from './selectorKeys';
import { StateView, stateView } from './stateView';

export interface SelectorDetailQuery {
  strategy: string;
  selector: string;
  days: number;
  tz: number;
}

/** A selector longer than this is no selector anyone wrote. */
const MAX_SELECTOR = 4000;

export function parseSelectorDetailQuery(q: Record<string, unknown>): SelectorDetailQuery | null {
  const selector = typeof q.selector === 'string' ? q.selector : '';
  if (!selector || selector.length > MAX_SELECTOR) return null;
  const strategy = typeof q.strategy === 'string' ? q.strategy.slice(0, 200) : '';
  const days =
    typeof q.days === 'string' && /^\d+$/.test(q.days) ? Math.min(Math.max(Number(q.days), 1), 365) : 30;
  return { strategy, selector, days, tz: parseTzOffset(q.tz) };
}

export interface SelectorDetail {
  strategy: string;
  selector: string;
  days: number;
  heals: number;
  sessions: number;
  timeSpentMs: number;
  firstHealedAt: string | null;
  lastHealedAt: string | null;
  daily: Array<{ t: number; heals: number }>;
  suggestions: Array<{
    selector: string;
    strategy: string | null;
    count: number;
    share: number;
    methods: string[];
    averageConfidence: number | null;
  }>;
  platforms: Array<{ name: string; count: number }>;
  builds: Array<{ id: string | null; name: string; count: number }>;
  devices: Array<{ udid: string; name: string; count: number }>;
  recent: Array<{
    id: string;
    sessionId: string;
    buildId: string | null;
    at: string;
    device: string | null;
    platform: string | null;
    method: string | null;
    confidence: number | null;
    healedSelector: string | null;
  }>;
  state: StateView | null;
  activity: Array<{ action: string; at: string; by: Person | null; reason: string | null }>;
}

const TOP = 5;
const RECENT = 20;
const ACTIVITY = 50;

interface FixTally {
  selector: string;
  strategy: string | null;
  count: number;
  methods: Set<string>;
  confidenceSum: number;
  confidenceCount: number;
}

function bump<T extends { count: number }>(m: Map<string, T>, key: string, make: () => T): void {
  const v = m.get(key) ?? make();
  v.count += 1;
  m.set(key, v);
}

const topCounts = <T extends { count: number }>(m: Map<string, T>): T[] =>
  Array.from(m.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP);

/**
 * Everything the panel shows for one selector over the period, or null when
 * the caller may not see it (a member, and no session they can see healed
 * it). Status and activity are lab-wide: one row per selector.
 */
export async function selectorDetail(
  query: SelectorDetailQuery,
  scope: SessionScope,
  now = new Date(),
): Promise<SelectorDetail | null> {
  if (!(await canSeeSelector({ strategy: query.strategy, selector: query.selector }, scope))) {
    return null;
  }
  const since = new Date(now.getTime() - query.days * DAY_MS);
  const rows = await prisma.sessionLog.findMany({
    where: {
      AND: [
        { is_healed: true, createdAt: { gte: since } },
        tupleWhere(query.strategy, query.selector),
        sessionScope(scope),
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      session_id: true,
      createdAt: true,
      healed_selector: true,
      healed_strategy: true,
      healing_tier: true,
      healing_confidence: true,
      duration: true,
      session: {
        select: {
          build_id: true,
          device_udid: true,
          device_name: true,
          device_platform: true,
          build: { select: { name: true } },
        },
      },
    },
  });

  const sessions = new Set<string>();
  let timeSpentMs = 0;
  const fixes = new Map<string, FixTally>();
  const platforms = new Map<string, { name: string; count: number }>();
  const builds = new Map<string, { id: string | null; name: string; count: number }>();
  const devices = new Map<string, { udid: string; name: string; count: number }>();
  for (const r of rows) {
    sessions.add(r.session_id);
    timeSpentMs += r.duration ?? 0;
    if (r.healed_selector) {
      const fixKey = `${r.healed_strategy ?? ''}\u0000${r.healed_selector}`;
      const f: FixTally = fixes.get(fixKey) ?? {
        selector: r.healed_selector,
        strategy: r.healed_strategy ?? null,
        count: 0,
        methods: new Set<string>(),
        confidenceSum: 0,
        confidenceCount: 0,
      };
      f.count += 1;
      if (r.healing_tier) f.methods.add(r.healing_tier);
      if (typeof r.healing_confidence === 'number') {
        f.confidenceSum += r.healing_confidence;
        f.confidenceCount += 1;
      }
      fixes.set(fixKey, f);
    }
    const platform = r.session.device_platform || 'unknown';
    bump(platforms, platform, () => ({ name: platform, count: 0 }));
    const buildId = r.session.build_id ?? null;
    bump(builds, buildId ?? '', () => ({
      id: buildId,
      name: r.session.build?.name || buildId || 'No build',
      count: 0,
    }));
    const udid = r.session.device_udid;
    if (udid) bump(devices, udid, () => ({ udid, name: r.session.device_name || udid, count: 0 }));
  }

  const [state, events] = await Promise.all([
    prisma.selectorState.findUnique({
      where: {
        original_strategy_original_selector: {
          original_strategy: query.strategy,
          original_selector: query.selector,
        },
      },
    }),
    prisma.selectorEvent.findMany({
      where: { original_strategy: query.strategy, original_selector: query.selector },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY,
    }),
  ]);
  const people = await peopleById(events.map((e) => e.user_id));
  const fixedEvent = events.find((e) => e.action === 'marked_fixed');
  const mutedEvent = events.find((e) => e.action === 'muted');

  return {
    strategy: query.strategy,
    selector: query.selector,
    days: query.days,
    heals: rows.length,
    sessions: sessions.size,
    timeSpentMs,
    firstHealedAt: rows.length > 0 ? rows[rows.length - 1].createdAt.toISOString() : null,
    lastHealedAt: rows.length > 0 ? rows[0].createdAt.toISOString() : null,
    daily: dailyHeals(
      rows.map((r) => ({ at: r.createdAt, method: r.healing_tier })),
      since,
      now,
      query.tz,
    ).map((d) => ({ t: d.t, heals: d.heals })),
    suggestions: Array.from(fixes.values())
      .sort((a, b) => b.count - a.count)
      .map((f) => ({
        selector: f.selector,
        strategy: f.strategy,
        count: f.count,
        share: rows.length > 0 ? f.count / rows.length : 0,
        methods: Array.from(f.methods),
        averageConfidence: f.confidenceCount > 0 ? f.confidenceSum / f.confidenceCount : null,
      })),
    platforms: topCounts(platforms),
    builds: topCounts(builds),
    devices: topCounts(devices),
    recent: rows.slice(0, RECENT).map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      buildId: r.session.build_id ?? null,
      at: r.createdAt.toISOString(),
      device: r.session.device_name || r.session.device_udid || null,
      platform: r.session.device_platform || null,
      method: r.healing_tier ?? null,
      confidence: r.healing_confidence ?? null,
      healedSelector: r.healed_selector ?? null,
    })),
    state: stateView(
      state,
      {
        fixed: fixedEvent ? { user_id: fixedEvent.user_id } : undefined,
        muted: mutedEvent ? { user_id: mutedEvent.user_id, reason: mutedEvent.reason } : undefined,
      },
      people,
    ),
    activity: events.map((e) => ({
      action: e.action,
      at: e.createdAt.toISOString(),
      by: e.user_id ? (people.get(e.user_id) ?? { id: e.user_id, name: null }) : null,
      reason: e.reason ?? null,
    })),
  };
}
```

- [ ] **Step 4: Add the route and its docs**

In `src/app/routers/selector-health.ts`, add imports:

```ts
import { SELECTOR_NOT_FOUND } from '../../services/selector-health/access';
import { parseSelectorDetailQuery, selectorDetail } from '../../services/selector-health/selectorDetail';
```

(merge `SELECTOR_NOT_FOUND` into the existing `access` import), add the handler:

```ts
/** Everything the side panel shows for one selector, and whether the caller may act on it. */
export async function getSelectorDetail(request: Request, response: Response) {
  const query = parseSelectorDetailQuery(request.query as Record<string, unknown>);
  if (!query) {
    return response.status(400).json({ error: 'bad_request', message: 'selector is required' });
  }
  try {
    const detail = await selectorDetail(query, await scopeOf(request));
    if (!detail) return response.status(404).json(SELECTOR_NOT_FOUND);
    return response.status(200).json({ ...detail, canAct: canActOnSelectors(callerOf(request)?.scopes) });
  } catch (err) {
    log.error(`[SelectorHealth] detail failed: ${(err as Error)?.message ?? err}`);
    return response.status(500).json({ error: 'internal' });
  }
}
```

and in `register`, after the list route:

```ts
  router.get('/healing/selectors/detail', getSelectorDetail);
```

In `src/app/swagger-docs.ts`, after the `/api/healing/selectors` block, add:

```
/**
 * @swagger
 * /api/healing/selectors/detail:
 *   get:
 *     summary: Everything the Selector Health side panel shows for one selector
 *     description: |
 *       Its heals in the period (suggested fixes with their share, methods and
 *       confidence; heals per day; platforms, builds and devices; the latest 20
 *       heals), its status, the latest 50 status changes with who made them,
 *       and whether the caller may act. A selector no session the caller can
 *       see has healed answers 404, exactly as an unknown one.
 *     tags: [Selector Health]
 *     parameters:
 *       - { in: query, name: selector, required: true, schema: { type: string } }
 *       - { in: query, name: strategy, schema: { type: string }, description: "Empty for heals recorded with no strategy" }
 *       - { in: query, name: days, schema: { type: integer, minimum: 1, maximum: 365, default: 30 } }
 *       - { in: query, name: tz, schema: { type: integer, minimum: -840, maximum: 840, default: 0 } }
 *     responses:
 *       200: { description: 'The panel for one selector' }
 *       400: { description: 'No selector given' }
 *       404: { description: '`{ error: "not_found", message: "Selector not found" }`' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
```

- [ ] **Step 5: Run the tests**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/selector-health-detail.spec.ts test/unit/selector-health-list.spec.ts`
Expected: PASS, all passing.

- [ ] **Step 6: Lint and commit**

Run: `npx eslint src/services/selector-health src/app/routers/selector-health.ts test/unit/selector-health-detail.spec.ts`
Expected: no findings.

```bash
git add src/services/selector-health/selectorDetail.ts src/app/routers/selector-health.ts src/app/swagger-docs.ts test/unit/selector-health-detail.spec.ts
git commit -m "feat(selector-health): GET /healing/selectors/detail for the side panel, by strategy and selector"
```

---

### Task 7: Members may act; every action names its person

**Files:**
- Modify: `src/app/routers/dashboard.ts` (`postSelectorStateAction`, its route line and comment, imports)
- Modify: `src/app/swagger-docs.ts` (`/api/healing/selector/state`)
- Modify: `test/unit/healing-state-endpoints.spec.ts` (the context it expects, new cases)
- Test: `test/unit/selector-health-actions.spec.ts`

**Interfaces:**
- Consumes: `canSeeSelector`, `SELECTOR_NOT_FOUND` (Task 5); `ActorContext.userId`/`reason` (Task 2); `resolveActor` (`src/services/device-access/actor.ts`).
- Produces: `POST /healing/selector/state` body `{ original_strategy: string (may be ''), original_selector: string, action, reason?: string (≤ 500, mute only) }`; guards `roleGuard('MEMBER')` + `scopeGuard(['sessions'])`; `404 SELECTOR_NOT_FOUND` for a selector the caller can't see; `400` for a bad reason. `export const MUTE_REASON_MAX = 500`.

- [ ] **Step 1: Write the failing tests**

In `test/unit/healing-state-endpoints.spec.ts`, change the first test's expectation to:

```ts
    expect(markFixedStub.firstCall.args[0]).to.deep.equal({
      strategy: 'xpath',
      selector: '//x',
      apiKeyId: 'apikey-1',
      userId: null,
      reason: null,
    });
```

and add inside `describe('POST /healing/selector/state — postSelectorStateAction', ...)`:

```ts
  it('passes the mute reason on, trimmed', async () => {
    muteStub.resolves({ status: 'muted' } as any);
    const { req, res } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'mute', reason: '  Redesign  ' },
    });
    await postSelectorStateAction(req, res);
    expect(muteStub.firstCall.args[0].reason).to.equal('Redesign');
  });

  it('keeps a reason only for a mute', async () => {
    markFixedStub.resolves({ status: 'pending' } as any);
    const { req, res } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'mark_fixed', reason: 'why' },
    });
    await postSelectorStateAction(req, res);
    expect(markFixedStub.firstCall.args[0].reason).to.equal(null);
  });

  it('refuses a reason longer than 500 characters', async () => {
    const { req, res, statusStub } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'mute', reason: 'x'.repeat(501) },
    });
    await postSelectorStateAction(req, res);
    expect(statusStub.calledWith(400)).to.be.true;
    expect(muteStub.called).to.be.false;
  });

  it('accepts a selector recorded with no strategy', async () => {
    markFixedStub.resolves({ status: 'pending' } as any);
    const { req, res } = mockReqRes({
      body: { original_strategy: '', original_selector: '//x', action: 'mark_fixed' },
    });
    await postSelectorStateAction(req, res);
    expect(markFixedStub.firstCall.args[0].strategy).to.equal('');
  });

  it('records the person acting, not their key', async () => {
    markFixedStub.resolves({ status: 'pending' } as any);
    const { req, res } = mockReqRes({
      body: { original_strategy: 'xpath', original_selector: '//x', action: 'mark_fixed' },
    });
    req.auth = { userId: 'u-9', role: 'ADMIN', scopes: 'admin', teamIds: undefined };
    await postSelectorStateAction(req, res);
    expect(markFixedStub.firstCall.args[0].userId).to.equal('u-9');
  });
```

`test/unit/selector-health-actions.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import { Container } from 'typedi';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  ADMIN,
  MEMBER_A,
  READ_ONLY_A,
  SEL,
  USER,
  seedSelectorHealth,
  selectorHealthApp,
} from '../helpers/selector-health-fixture';
import { SelectorStateService } from '../../src/services/SelectorStateService';

describe('POST /healing/selector/state (real queries)', function () {
  this.timeout(90_000);
  const scratch = useScratchDatabase();

  before(async () => {
    await seedSelectorHealth(scratch.db);
    // The service's transactions use the scratch database's own client.
    Container.set(
      SelectorStateService,
      new SelectorStateService(scratch.db as never, { emitToDashboard: () => undefined }),
    );
  });

  after(() => {
    Container.remove(SelectorStateService);
  });

  const act = (auth: Record<string, unknown>, body: Record<string, unknown>) =>
    request(selectorHealthApp(auth)).post('/healing/selector/state').send(body);

  it('lets a member mute a selector they can see, recording them and their reason', async () => {
    const res = await act(MEMBER_A, {
      original_strategy: 'id',
      original_selector: SEL.warm,
      action: 'mute',
      reason: '  Moving to the new cart  ',
    });
    expect(res.status).to.equal(200);
    const state = await scratch.db.selectorState.findUnique({
      where: { original_strategy_original_selector: { original_strategy: 'id', original_selector: SEL.warm } },
    });
    expect(state?.status).to.equal('muted');
    const events = await scratch.db.selectorEvent.findMany({ where: { original_selector: SEL.warm } });
    expect(events.map((e) => [e.action, e.user_id, e.reason])).to.deep.equal([
      ['muted', USER.priya, 'Moving to the new cart'],
    ]);
  });

  it("refuses a member another team's selector, as if it didn't exist", async () => {
    const res = await act(MEMBER_A, {
      original_strategy: 'xpath',
      original_selector: SEL.bOnly,
      action: 'mark_fixed',
    });
    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({ error: 'not_found', message: 'Selector not found' });
    expect(await scratch.db.selectorState.count({ where: { original_selector: SEL.bOnly } })).to.equal(0);
  });

  it('lets an admin act on any selector', async () => {
    const res = await act(ADMIN, {
      original_strategy: 'xpath',
      original_selector: SEL.bOnly,
      action: 'mark_fixed',
    });
    expect(res.status).to.equal(200);
    expect(res.body.state.status).to.equal('pending');
  });

  it('refuses a caller without the sessions scope', async () => {
    const res = await act(READ_ONLY_A, {
      original_strategy: 'xpath',
      original_selector: SEL.hot,
      action: 'mute',
    });
    expect(res.status).to.equal(403);
  });

  it('marks fixed a selector recorded with no strategy', async () => {
    const res = await act(MEMBER_A, {
      original_strategy: '',
      original_selector: SEL.legacy,
      action: 'mark_fixed',
    });
    expect(res.status).to.equal(200);
    const state = await scratch.db.selectorState.findFirst({ where: { original_selector: SEL.legacy } });
    expect(state).to.include({ original_strategy: '', status: 'pending' });
  });

  it('refuses a reason over 500 characters', async () => {
    const res = await act(MEMBER_A, {
      original_strategy: 'xpath',
      original_selector: SEL.hot,
      action: 'mute',
      reason: 'x'.repeat(501),
    });
    expect(res.status).to.equal(400);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/healing-state-endpoints.spec.ts test/unit/selector-health-actions.spec.ts`
Expected: FAIL: the context lacks `userId`/`reason`; `''` strategy answers 400; a member gets 403 (admin-only route); no reason check.

- [ ] **Step 3: Open the action to members, check visibility, record the person**

In `src/app/routers/dashboard.ts`, add imports:

```ts
import type { Prisma } from '../../generated/client';
import { resolveActor } from '../../services/device-access/actor';
import { SELECTOR_NOT_FOUND, canSeeSelector } from '../../services/selector-health/access';
```

Replace the comment above `VALID_SELECTOR_ACTIONS` and `postSelectorStateAction` with:

```ts
// SelectorState lifecycle action endpoint — mark fixed / mute / unmute /
// cancel verification. The action vocabulary is closed (any value not in
// VALID_ACTIONS rejects with 400). A member may act on a selector they can
// see (healed in a session they can see); any other answers 404, as an
// unknown one. The person acting is recorded (SelectorEvent), with the
// reason for a mute. A SelectorStateConflictError surfaces as 409 with
// `currentStatus`; anything else logs and surfaces as 500.
const VALID_SELECTOR_ACTIONS = ['mark_fixed', 'mute', 'unmute', 'cancel_verification'] as const;
type SelectorAction = (typeof VALID_SELECTOR_ACTIONS)[number];

/** The longest reason a mute may give. */
export const MUTE_REASON_MAX = 500;

export async function postSelectorStateAction(request: Request, response: Response) {
  const { original_strategy, original_selector, action, reason } = (request.body ?? {}) as {
    original_strategy?: unknown;
    original_selector?: unknown;
    action?: unknown;
    reason?: unknown;
  };
  // The strategy may be '': heals recorded before strategies were.
  if (
    typeof original_strategy !== 'string' ||
    typeof original_selector !== 'string' ||
    !original_selector ||
    typeof action !== 'string' ||
    !action
  ) {
    return response.status(400).json({
      error: 'original_strategy, original_selector, and action are required',
    });
  }
  if (!(VALID_SELECTOR_ACTIONS as readonly string[]).includes(action)) {
    return response.status(400).json({
      error: `action must be one of ${VALID_SELECTOR_ACTIONS.join(', ')}`,
    });
  }
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > MUTE_REASON_MAX)) {
    return response.status(400).json({
      error: `reason must be text of at most ${MUTE_REASON_MAX} characters`,
    });
  }

  const scope = (await visibleSessionWhere(authOf(request))) as Prisma.SessionWhereInput | undefined;
  if (!(await canSeeSelector({ strategy: original_strategy, selector: original_selector }, scope))) {
    return response.status(404).json(SELECTOR_NOT_FOUND);
  }

  const muteReason = action === 'mute' && typeof reason === 'string' ? reason.trim() : '';
  const ctx = {
    strategy: original_strategy,
    selector: original_selector,
    apiKeyId: request.apiKey?.id ?? '',
    userId: resolveActor(request).userId ?? null,
    reason: muteReason || null,
  };
  const service = Container.get(SelectorStateService);

  try {
    let row;
    switch (action as SelectorAction) {
      case 'mark_fixed':
        row = await service.markFixed(ctx);
        break;
      case 'mute':
        row = await service.mute(ctx);
        break;
      case 'unmute':
        row = await service.unmute(ctx);
        break;
      case 'cancel_verification':
        row = await service.cancelVerification(ctx);
        break;
    }
    return response.json({ state: row });
  } catch (err: any) {
    if (err instanceof SelectorStateConflictError) {
      return response.status(409).json({ error: err.message, currentStatus: err.currentStatus });
    }
    log.error(`[Dashboard] selector state action failed: ${err?.message ?? err}`);
    return response.status(500).json({ error: 'internal' });
  }
}
```

In `register`, replace the comment block starting `// SelectorState lifecycle: state mutations require admin` and the `router.post('/healing/selector/state', ...)` line with:

```ts
  // SelectorState lifecycle: members act on selectors they can see (the
  // handler checks, and records who acted); the `sessions` scope is needed,
  // which `admin` implies. The two reads stay global, not team-scoped: a
  // selector's mute or fix is one lab-wide row with no team column, shared
  // by every team whose tests use that selector. The one heal-derived field,
  // the muted list's `last_healed_at`, is the caller's.
  router.post('/healing/selector/state', roleGuard('MEMBER'), scopeGuard(['sessions']), postSelectorStateAction);
```

In `src/app/swagger-docs.ts`, in the `/api/healing/selector/state` block, replace its description to say: members may act on selectors healed in sessions they can see (404 otherwise), the caller needs the `sessions` scope, `original_strategy` may be empty, and add the body property:

```
 *               reason: { type: string, maxLength: 500, description: 'Why the selector is muted; mute only' }
```

(Read the block first and edit only those lines.)

- [ ] **Step 4: Run the tests**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/healing-state-endpoints.spec.ts test/unit/selector-health-actions.spec.ts test/unit/selector-health-list.spec.ts`
Expected: PASS, all passing.

- [ ] **Step 5: Lint the changed files against main's counts**

Run: `for f in src/app/routers/dashboard.ts test/unit/healing-state-endpoints.spec.ts; do echo "$(git show main:$f | npx eslint --stdin --stdin-filename $f -f json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s)[0];console.log(r.errorCount+r.warningCount)})') -> $(npx eslint $f -f json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s)[0];console.log(r.errorCount+r.warningCount)})') $f"; done; npx eslint test/unit/selector-health-actions.spec.ts`
Expected: each `a -> b` has `b <= a`; the new spec has no findings.

- [ ] **Step 6: Commit**

```bash
git add src/app/routers/dashboard.ts src/app/swagger-docs.ts test/unit/healing-state-endpoints.spec.ts test/unit/selector-health-actions.spec.ts
git commit -m "feat(selector-health): members mark fixed and mute what they can see; each action records its person and reason"
```

---

### Task 8: Web foundation: types, API calls, the address, the words

**Files:**
- Modify: `web/src/interfaces/IHealingEvent.ts`
- Modify: `web/src/api-service/index.ts` (healing section)
- Create: `web/src/components/selector-health/view-state.ts`
- Create: `web/src/components/selector-health/format.ts`
- Modify: `web/src/components/session-detail/line-chart.tsx` (`formatTime`)
- Test: `web/src/components/selector-health/view-state.test.ts`
- Test: `web/src/components/selector-health/format.test.ts`
- Test: `web/src/api-service/selector-health.test.ts`
- Test: `web/src/components/session-detail/line-chart.test.tsx` (one new case)

**Interfaces:**
- Consumes: server answers from Tasks 4–7.
- Produces:
  - Types: `IHealingTrendDay`, `SelectorTab`, `SelectorSort`, `ISelectorPerson`, `ISelectorStateView`, `ISelectorListItem`, `ISelectorListResponse`, `SelectorEventAction`, `ISelectorSuggestion`, `ISelectorRecentHeal`, `ISelectorActivity`, `ISelectorDetailResponse`; `IHealingPeriodAggregate.timeSpentMs`; `IHealingSummaryResponse.trend`.
  - API: `getHealingSummary(windowDays = 30, tz = 0)`, `getHealingSelectors(query)`, `getSelectorPanel(strategy, selector, days, tz): Promise<{ status: number; body: ISelectorDetailResponse | null }>`, `postSelectorStateAction({ ..., reason? })`.
  - `view-state.ts`: `PERIODS`, `PeriodDays`, `OpenSelector`, `SelectorHealthView`, `DEFAULT_VIEW`, `readView(params)`, `writeView(view)`, `legacyDetailTarget(params)`, `selectorKey(s)`.
  - `format.ts`: `formatDuration`, `formatRelative`, `formatDay`, `formatDate`, `compareNote`, `Tone`, `TAB_LABELS`, `SORT_LABELS`, `METHODS`, `METHOD_EXPLANATIONS`, `PLATFORMS`, `shareText`, `statusText`, `activityText`, `personText`, `strategyLabel`.
  - `LineChart` prop `formatTime?: (t: number) => string`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/selector-health/view-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW,
  SelectorHealthView,
  legacyDetailTarget,
  readView,
  writeView,
} from './view-state';

const read = (qs: string) => readView(new URLSearchParams(qs));

describe('the address holds the view', () => {
  it('reads defaults from an empty address, and writes nothing for them', () => {
    expect(read('')).toEqual(DEFAULT_VIEW);
    expect(writeView(DEFAULT_VIEW).toString()).toBe('');
  });

  it('round-trips every field, a selector full of punctuation included', () => {
    const view: SelectorHealthView = {
      tab: 'muted',
      days: 7,
      q: 'a b&c',
      platform: 'ios',
      method: 'Visual AI',
      sort: 'time',
      page: 3,
      open: { strategy: 'xpath', selector: `//*[@text='50% off & "free" #1? [x]'] / a+b` },
    };
    expect(read(writeView(view).toString())).toEqual(view);
  });

  it('keeps a selector recorded with no strategy open', () => {
    const view: SelectorHealthView = { ...DEFAULT_VIEW, open: { strategy: '', selector: '//legacy' } };
    expect(read(writeView(view).toString()).open).toEqual({ strategy: '', selector: '//legacy' });
  });

  it('reads the old tab names, and ignores values it does not know', () => {
    expect(read('tab=active').tab).toBe('fix');
    expect(read('tab=pending').tab).toBe('verifying');
    expect(read('tab=resolved').tab).toBe('fixed');
    expect(read('tab=bogus&days=12&sort=x&page=0')).toEqual(DEFAULT_VIEW);
  });

  it('sends an old detail link to the panel, or to a search when it named no strategy', () => {
    expect(legacyDetailTarget(new URLSearchParams('value=%2F%2Fa&strategy=xpath&windowDays=7'))).toBe(
      '/selector-health?days=7&strategy=xpath&selector=%2F%2Fa',
    );
    expect(legacyDetailTarget(new URLSearchParams('value=%2F%2Fa'))).toBe('/selector-health?q=%2F%2Fa');
    expect(legacyDetailTarget(new URLSearchParams(''))).toBe('/selector-health');
  });
});
```

`web/src/components/selector-health/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  METHOD_EXPLANATIONS,
  activityText,
  compareNote,
  formatDuration,
  formatRelative,
  shareText,
  statusText,
  strategyLabel,
} from './format';
import { ISelectorStateView } from '../../interfaces/IHealingEvent';

describe('Selector Health wording', () => {
  it('says how long, in the largest unit that reads well', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(400)).toBe('<1 s');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(14 * 60_000)).toBe('14 min');
    expect(formatDuration(2.34 * 3_600_000)).toBe('2.3 h');
    expect(formatDuration(30 * 3_600_000)).toBe('30 h');
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(formatRelative(null, now)).toBe('—');
    expect(formatRelative('2026-10-02T11:59:40Z', now)).toBe('just now');
    expect(formatRelative('2026-10-02T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelative('2026-10-02T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-10-01T09:00:00Z', now)).toBe('yesterday');
    expect(formatRelative('2026-09-28T09:00:00Z', now)).toBe('4 days ago');
  });

  it('compares with the period before, in words, fewer being good', () => {
    expect(compareNote(7, 9, 30, 'count')).toEqual({ text: '2 fewer than the 30 days before', tone: 'good' });
    expect(compareNote(265, 190, 30, 'percent')).toEqual({
      text: '39% more than the 30 days before',
      tone: 'bad',
    });
    expect(compareNote(5, 5, 7, 'percent')).toEqual({ text: 'Same as the 7 days before', tone: 'neutral' });
    expect(compareNote(4, 0, 7, 'count')).toEqual({ text: 'None the 7 days before', tone: 'bad' });
    expect(compareNote(1001, 1000, 30, 'percent')).toEqual({
      text: 'About the same as the 30 days before',
      tone: 'neutral',
    });
    expect(compareNote(60_000, 240_000, 30, 'duration')).toEqual({
      text: '3 min less than the 30 days before',
      tone: 'good',
    });
  });

  it('names a status, a share, an activity and a selector type plainly', () => {
    expect(statusText(null)).toBe('To fix');
    expect(statusText({ status: 'pending', cleanBuilds: 2 } as ISelectorStateView)).toBe(
      'Being verified, 2 of 3 clean builds',
    );
    expect(statusText({ status: 'resolved' } as ISelectorStateView)).toBe('Fixed');
    expect(shareText(0.824)).toBe('82% of heals');
    expect(activityText({ action: 'muted', at: '', by: { id: 'u', name: 'Priya' }, reason: null })).toBe(
      'Muted by Priya',
    );
    expect(
      activityText({ action: 'marked_fixed', at: '', by: { id: 'gone', name: null }, reason: null }),
    ).toBe('Marked fixed');
    expect(strategyLabel('')).toBe('Unknown type');
    expect(strategyLabel('xpath')).toBe('XPath');
    expect(METHOD_EXPLANATIONS['Visual AI']).toBe('Found it in a screenshot with AI');
  });
});
```

`web/src/api-service/selector-health.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import XenonApiService from './index';

describe('Selector Health calls', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for one selector by strategy and value, and keeps the answer status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({ error: 'not_found', message: 'Selector not found' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await XenonApiService.getSelectorPanel('xpath', `//a[@t='50% & #']`, 7, 330);

    expect(r).toEqual({ status: 404, body: { error: 'not_found', message: 'Selector not found' } });
    const url = new URL(fetchMock.mock.calls[0][0] as string, 'http://x');
    expect(url.pathname).toBe('/xenon/api/healing/selectors/detail');
    expect(url.searchParams.get('strategy')).toBe('xpath');
    expect(url.searchParams.get('selector')).toBe(`//a[@t='50% & #']`);
    expect(url.searchParams.get('days')).toBe('7');
    expect(url.searchParams.get('tz')).toBe('330');
  });

  it('sends a mute reason with the action', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ state: null }) });
    vi.stubGlobal('fetch', fetchMock);

    await XenonApiService.postSelectorStateAction({
      original_strategy: 'xpath',
      original_selector: '//a',
      action: 'mute',
      reason: 'Redesign',
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      original_strategy: 'xpath',
      original_selector: '//a',
      action: 'mute',
      reason: 'Redesign',
    });
  });
});
```

Append to `web/src/components/session-detail/line-chart.test.tsx`, inside its `describe` for `LineChart`:

```tsx
  it('names the hovered point with formatTime when given', () => {
    render(
      <LineChart
        ariaLabel="Heals per day"
        times={[0, 86_400_000]}
        series={[{ key: 'h', label: 'Heals', color: 'var(--color-info)', values: [1, 2] }]}
        formatValue={(v) => String(v)}
        formatTime={(t) => `day ${t / 86_400_000}`}
      />,
    );
    const box = screen.getByTestId('line-chart');
    box.getBoundingClientRect = () =>
      ({ left: 0, width: 400, top: 0, height: 140, right: 400, bottom: 140, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireEvent.mouseMove(box, { clientX: 400 });

    expect(screen.getByRole('tooltip').textContent).toContain('day 1');
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd web && npx vitest run src/components/selector-health src/api-service/selector-health.test.ts src/components/session-detail/line-chart.test.tsx`
Expected: FAIL: `view-state` and `format` don't exist, `getSelectorPanel` is not a function, the tooltip shows `0:24:00:00`-style elapsed time.

- [ ] **Step 3: Types**

In `web/src/interfaces/IHealingEvent.ts`, replace `IHealingPeriodAggregate` and `IHealingSummaryResponse` with:

```ts
export interface IHealingPeriodAggregate {
  totalHeals: number;
  distinctSelectors: number;
  sessionsTouched: number;
  byTier: Record<string, number>;
  /** Total duration of the commands that needed healing. */
  timeSpentMs: number;
}

/** Heals in one day of the period, in the caller's time zone. */
export interface IHealingTrendDay {
  /** When the day began, epoch ms. */
  t: number;
  heals: number;
  /** Heals by Visual AI or an LLM. */
  aiHeals: number;
}

export interface IHealingSummaryResponse {
  windowDays: number;
  current: IHealingPeriodAggregate;
  prior: IHealingPeriodAggregate;
  resolvedCount?: number;
  pendingCount?: number;
  trend: IHealingTrendDay[];
}
```

delete the `estCostUsd: number;` line from `IHealingSelectorDetail`, and append:

```ts
export type SelectorTab = 'fix' | 'verifying' | 'fixed' | 'muted';
export type SelectorSort = 'heals' | 'recent' | 'time';

/** Who did something. `name` is null for someone the server no longer knows. */
export interface ISelectorPerson {
  id: string;
  name: string | null;
}

export interface ISelectorStateView {
  status: SelectorStateStatus;
  cleanBuilds: number;
  fixedAt: string | null;
  fixedBy: ISelectorPerson | null;
  resolvedAt: string | null;
  mutedAt: string | null;
  mutedBy: ISelectorPerson | null;
  muteReason: string | null;
  /** How often it healed again after being fixed. */
  brokeAgain: number;
}

export interface ISelectorListItem {
  /** '' for a heal recorded with no strategy. */
  strategy: string;
  selector: string;
  heals: number;
  sessions: number;
  lastHealedAt: string | null;
  timeSpentMs: number;
  topMethod: string | null;
  suggestion: { selector: string; strategy: string | null; share: number } | null;
  state: ISelectorStateView | null;
}

export interface ISelectorListResponse {
  tab: SelectorTab;
  days: number;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<SelectorTab, number>;
  canAct: boolean;
  items: ISelectorListItem[];
}

export type SelectorEventAction =
  | 'marked_fixed'
  | 'verification_cancelled'
  | 'verified'
  | 'broke_again'
  | 'muted'
  | 'unmuted';

export interface ISelectorSuggestion {
  selector: string;
  strategy: string | null;
  count: number;
  share: number;
  methods: string[];
  averageConfidence: number | null;
}

export interface ISelectorRecentHeal {
  id: string;
  sessionId: string;
  buildId: string | null;
  at: string;
  device: string | null;
  platform: string | null;
  method: string | null;
  confidence: number | null;
  healedSelector: string | null;
}

export interface ISelectorActivity {
  action: SelectorEventAction;
  at: string;
  by: ISelectorPerson | null;
  reason: string | null;
}

export interface ISelectorDetailResponse {
  strategy: string;
  selector: string;
  days: number;
  heals: number;
  sessions: number;
  timeSpentMs: number;
  firstHealedAt: string | null;
  lastHealedAt: string | null;
  daily: Array<{ t: number; heals: number }>;
  suggestions: ISelectorSuggestion[];
  platforms: Array<{ name: string; count: number }>;
  builds: Array<{ id: string | null; name: string; count: number }>;
  devices: Array<{ udid: string; name: string; count: number }>;
  recent: ISelectorRecentHeal[];
  state: ISelectorStateView | null;
  activity: ISelectorActivity[];
  canAct: boolean;
}
```

- [ ] **Step 4: API calls**

In `web/src/api-service/index.ts`, replace `getHealingSummary` with:

```ts
  /** `tz`: the browser's offset from UTC in minutes, so the trend's days are the viewer's. */
  public static getHealingSummary(windowDays = 30, tz = 0) {
    return apiClient.makeGETRequest(
      `/healing/summary?windowDays=${windowDays}&tz=${tz}&t=${Date.now()}`,
    );
  }

  /** One tab of Selector Health's list. */
  public static getHealingSelectors(query: {
    tab: string;
    days: number;
    q?: string;
    platform?: string;
    method?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const p = new URLSearchParams({
      tab: query.tab,
      days: String(query.days),
      sort: query.sort ?? 'heals',
      page: String(query.page ?? 1),
      pageSize: String(query.pageSize ?? 50),
      t: String(Date.now()),
    });
    if (query.q) p.set('q', query.q);
    if (query.platform) p.set('platform', query.platform);
    if (query.method) p.set('method', query.method);
    return apiClient.makeGETRequest(`/healing/selectors?${p.toString()}`);
  }

  /**
   * Everything the side panel shows for one selector. Bypasses `apiClient`
   * so the caller sees a 404 (a selector it can't see) as such.
   */
  public static async getSelectorPanel(
    strategy: string,
    selector: string,
    days: number,
    tz: number,
  ): Promise<{ status: number; body: ISelectorDetailResponse | null }> {
    const p = new URLSearchParams({
      strategy,
      selector,
      days: String(days),
      tz: String(tz),
      t: String(Date.now()),
    });
    const res = await fetch(`/xenon/api/healing/selectors/detail?${p.toString()}`, {
      credentials: 'include',
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }
```

add `import { ISelectorDetailResponse } from '../interfaces/IHealingEvent';` to the file's imports, and in `postSelectorStateAction`'s payload type add `reason?: string;` after `action: ...;`.

- [ ] **Step 5: The address**

`web/src/components/selector-health/view-state.ts`:

```ts
import { SelectorSort, SelectorTab } from '../../interfaces/IHealingEvent';

export const PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];

/** The selector open in the side panel. `strategy` is '' for a heal recorded with no strategy. */
export interface OpenSelector {
  strategy: string;
  selector: string;
}

/** Everything the page shows, held in the address so it can be bookmarked or shared. */
export interface SelectorHealthView {
  tab: SelectorTab;
  days: PeriodDays;
  q: string;
  platform: string;
  method: string;
  sort: SelectorSort;
  page: number;
  open: OpenSelector | null;
}

export const DEFAULT_VIEW: SelectorHealthView = {
  tab: 'fix',
  days: 30,
  q: '',
  platform: '',
  method: '',
  sort: 'heals',
  page: 1,
  open: null,
};

const TABS: readonly SelectorTab[] = ['fix', 'verifying', 'fixed', 'muted'];
const SORTS: readonly SelectorSort[] = ['heals', 'recent', 'time'];
/** The tab names links used before the redesign. */
const OLD_TABS: Record<string, SelectorTab> = {
  active: 'fix',
  pending: 'verifying',
  resolved: 'fixed',
  muted: 'muted',
};

const periodOf = (raw: string | null): PeriodDays =>
  PERIODS.find((d) => String(d) === raw) ?? DEFAULT_VIEW.days;

export function readView(params: URLSearchParams): SelectorHealthView {
  const tabRaw = params.get('tab') ?? '';
  const sortRaw = params.get('sort') ?? '';
  const page = Number(params.get('page'));
  const selector = params.get('selector');
  return {
    tab: TABS.find((t) => t === tabRaw) ?? OLD_TABS[tabRaw] ?? DEFAULT_VIEW.tab,
    days: periodOf(params.get('days')),
    q: params.get('q') ?? '',
    platform: params.get('platform') ?? '',
    method: params.get('method') ?? '',
    sort: SORTS.find((s) => s === sortRaw) ?? DEFAULT_VIEW.sort,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    open: selector ? { strategy: params.get('strategy') ?? '', selector } : null,
  };
}

/** The address for `view`, leaving out what is the default. */
export function writeView(view: SelectorHealthView): URLSearchParams {
  const p = new URLSearchParams();
  if (view.tab !== DEFAULT_VIEW.tab) p.set('tab', view.tab);
  if (view.days !== DEFAULT_VIEW.days) p.set('days', String(view.days));
  if (view.q) p.set('q', view.q);
  if (view.platform) p.set('platform', view.platform);
  if (view.method) p.set('method', view.method);
  if (view.sort !== DEFAULT_VIEW.sort) p.set('sort', view.sort);
  if (view.page !== 1) p.set('page', String(view.page));
  if (view.open) {
    p.set('strategy', view.open.strategy);
    p.set('selector', view.open.selector);
  }
  return p;
}

/**
 * Where a link to the retired detail page (`/selector-health/detail?value=
 * &strategy=&windowDays=`) goes now: the panel, or a search for the selector
 * when the link named no strategy, since a selector is found by both.
 */
export function legacyDetailTarget(params: URLSearchParams): string {
  const value = params.get('value') ?? '';
  const strategy = params.get('strategy');
  const days = periodOf(params.get('windowDays'));
  const view: SelectorHealthView = !value
    ? { ...DEFAULT_VIEW, days }
    : strategy !== null
      ? { ...DEFAULT_VIEW, days, open: { strategy, selector: value } }
      : { ...DEFAULT_VIEW, days, q: value };
  const qs = writeView(view).toString();
  return qs ? `/selector-health?${qs}` : '/selector-health';
}

/** One key per selector, the server's own: strategy and value. */
export const selectorKey = (s: OpenSelector): string => `${s.strategy}\u0000${s.selector}`;
```

- [ ] **Step 6: The words**

`web/src/components/selector-health/format.ts`:

```ts
import { formatStrategy } from '../../utils/strategy-labels';
import {
  ISelectorActivity,
  ISelectorPerson,
  ISelectorStateView,
  SelectorEventAction,
  SelectorSort,
  SelectorTab,
} from '../../interfaces/IHealingEvent';

export type Tone = 'good' | 'bad' | 'neutral';

export const TAB_LABELS: Record<SelectorTab, string> = {
  fix: 'To fix',
  verifying: 'Being verified',
  fixed: 'Fixed',
  muted: 'Muted',
};

export const SORT_LABELS: Record<SelectorSort, string> = {
  heals: 'Most heals',
  recent: 'Most recent',
  time: 'Most time spent healing',
};

/** Healing methods in the order Xenon tries them. */
export const METHODS = ['Resilio', 'Native', 'Fuzzy XML', 'OCR', 'Visual AI', 'LLM'] as const;

export const METHOD_EXPLANATIONS: Record<string, string> = {
  Resilio: 'Found it from its saved fingerprint',
  Native: 'Found it again with the original selector',
  'Fuzzy XML': "Found the closest match in the screen's structure",
  OCR: 'Found it by reading the text on screen',
  'Visual AI': 'Found it in a screenshot with AI',
  LLM: 'Asked a language model to find it',
};

export const PLATFORMS = [
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
  { value: 'tvos', label: 'tvOS' },
];

/** How long, in the largest unit that reads well. */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) return '0 s';
  const s = ms / 1000;
  if (s < 1) return '<1 s';
  if (Math.round(s) < 60) return `${Math.round(s)} s`;
  const min = s / 60;
  if (Math.round(min) < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const min = Math.floor(Math.max(0, now - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** A day on a chart, e.g. "Tue, 30 Sep". */
export function formatDay(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** A date in a list, e.g. "12 Sep 2026". */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** This period against the one before, in words; fewer is good. */
export function compareNote(
  current: number,
  prior: number,
  days: number,
  kind: 'count' | 'percent' | 'duration',
): { text: string; tone: Tone } {
  const before = `the ${days} days before`;
  if (current === prior) return { text: `Same as ${before}`, tone: 'neutral' };
  if (prior === 0) return { text: `None ${before}`, tone: 'bad' };
  const up = current > prior;
  const tone: Tone = up ? 'bad' : 'good';
  if (kind === 'count') {
    return { text: `${Math.abs(current - prior)} ${up ? 'more' : 'fewer'} than ${before}`, tone };
  }
  if (kind === 'duration') {
    return { text: `${formatDuration(Math.abs(current - prior))} ${up ? 'more' : 'less'} than ${before}`, tone };
  }
  const pct = Math.round((Math.abs(current - prior) / prior) * 100);
  if (pct === 0) return { text: `About the same as ${before}`, tone: 'neutral' };
  return { text: `${pct}% ${up ? 'more' : 'fewer'} than ${before}`, tone };
}

export function shareText(share: number): string {
  return `${Math.round(share * 100)}% of heals`;
}

/** A selector's type, e.g. "XPath"; a heal recorded with no strategy has none. */
export function strategyLabel(strategy: string | null): string {
  return strategy ? formatStrategy(strategy) : 'Unknown type';
}

export function statusText(state: ISelectorStateView | null): string {
  switch (state?.status) {
    case 'pending':
      return `Being verified, ${state.cleanBuilds} of 3 clean builds`;
    case 'resolved':
      return 'Fixed';
    case 'muted':
      return 'Muted';
    default:
      return 'To fix';
  }
}

/** " by Priya", or nothing when nobody known did it. Never an id. */
export function personText(p: ISelectorPerson | null): string {
  return p?.name ? ` by ${p.name}` : '';
}

const ACTION_TEXT: Record<SelectorEventAction, string> = {
  marked_fixed: 'Marked fixed',
  verification_cancelled: 'Verification cancelled',
  verified: 'Verified after 3 clean builds',
  broke_again: 'Broke again',
  muted: 'Muted',
  unmuted: 'Unmuted',
};

export function activityText(a: ISelectorActivity): string {
  return `${ACTION_TEXT[a.action] ?? 'Changed'}${personText(a.by)}`;
}
```

- [ ] **Step 7: `formatTime` on the chart**

In `web/src/components/session-detail/line-chart.tsx`, add to `LineChartProps` after `formatValue`:

```ts
  /** The tooltip's time label; elapsed time from the first sample when absent. */
  formatTime?: (t: number) => string;
```

add `formatTime,` to the destructured props, and replace `{formatElapsed(times[hover])}` with `{(formatTime ?? formatElapsed)(times[hover])}`.

- [ ] **Step 8: Run the tests and types**

Run: `cd web && npx vitest run src/components/selector-health src/api-service/selector-health.test.ts src/components/session-detail`
Expected: PASS, all passing.

Run: `cd web && npx tsc --noEmit -p .`
Expected: no errors (the old detail page still compiles: it no longer reads `estCostUsd`; if it does, delete that stat tile from it).

- [ ] **Step 9: Commit**

```bash
git add web/src/interfaces/IHealingEvent.ts web/src/api-service/index.ts web/src/api-service/selector-health.test.ts web/src/components/selector-health/view-state.ts web/src/components/selector-health/view-state.test.ts web/src/components/selector-health/format.ts web/src/components/selector-health/format.test.ts web/src/components/session-detail/line-chart.tsx web/src/components/session-detail/line-chart.test.tsx
git commit -m "feat(web): Selector Health's types, calls, address and wording"
```

---

### Task 9: Summary, trend, broke-again banner and the copy button

**Files:**
- Create: `web/src/components/selector-health/summary-strip.tsx` (+ `summary-strip.test.tsx`)
- Create: `web/src/components/selector-health/trend-chart.tsx` (+ `trend-chart.test.tsx`)
- Modify: `web/src/components/selector-health/regression-banner.tsx` (rewrite) (+ `regression-banner.test.tsx`)
- Modify: `web/src/components/selector-health/copy-language-modal.tsx` (`CopyButton` takes a strategy and value; kit buttons) (+ `copy-language-modal.test.tsx`)
- Modify: `web/src/components/selector-health/selector-health-page.tsx` (one call site: `<CopyButton strategy=… value=…>`)

**Interfaces:**
- Consumes: `IHealingSummaryResponse`, `IHealingTrendDay`, `compareNote`, `formatDuration`, `formatDay` (Task 8), `StatTile`, `Card`, `LineChart`, `niceMax`, `Button`, `Modal`.
- Produces: `SummaryStrip({ summary, days })`, `TrendChart({ trend: IHealingTrendDay[] | null, days })`, `RegressionBanner()`, `CopyButton({ strategy, value, onCopied })`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/selector-health/summary-strip.test.tsx`:

```tsx
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryStrip } from './summary-strip';
import { IHealingSummaryResponse } from '../../interfaces/IHealingEvent';

const summary: IHealingSummaryResponse = {
  windowDays: 30,
  current: { totalHeals: 265, distinctSelectors: 7, sessionsTouched: 61, byTier: {}, timeSpentMs: 14 * 60_000 },
  prior: { totalHeals: 190, distinctSelectors: 9, sessionsTouched: 50, byTier: {}, timeSpentMs: 11 * 60_000 },
  trend: [],
};

describe('SummaryStrip', () => {
  it('shows the four numbers, each compared with the period before', () => {
    render(<SummaryStrip summary={summary} days={30} />);
    expect(screen.getByText('Selectors that needed healing')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('2 fewer than the 30 days before').className).toContain('color-success');
    expect(screen.getByText('39% more than the 30 days before').className).toContain('color-danger');
    expect(screen.getByText('Sessions affected')).toBeTruthy();
    expect(screen.getByText('14 min')).toBeTruthy();
    expect(screen.getByText('3 min more than the 30 days before')).toBeTruthy();
  });

  it('shows dashes until the summary arrives', () => {
    render(<SummaryStrip summary={null} days={30} />);
    expect(screen.getAllByText('—')).toHaveLength(4);
  });
});
```

`web/src/components/selector-health/trend-chart.test.tsx`:

```tsx
import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrendChart } from './trend-chart';
import { formatDay } from './format';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 8, 30);
const trend = [
  { t: t0, heals: 3, aiHeals: 1 },
  { t: t0 + DAY, heals: 5, aiHeals: 0 },
  { t: t0 + 2 * DAY, heals: 0, aiHeals: 0 },
];

describe('TrendChart', () => {
  it('draws heals and AI heals per day, with their totals', () => {
    render(<TrendChart trend={trend} days={30} />);
    expect(screen.getByRole('img', { name: 'Heals per day' })).toBeTruthy();
    expect(screen.getByText('All heals').parentElement?.textContent).toContain('8');
    expect(screen.getByText('Heals that used AI').parentElement?.textContent).toContain('1');
  });

  it('names the hovered day', () => {
    render(<TrendChart trend={trend} days={30} />);
    const box = screen.getByTestId('line-chart');
    box.getBoundingClientRect = () =>
      ({ left: 0, width: 400, top: 0, height: 120, right: 400, bottom: 120, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.mouseMove(box, { clientX: 200 });
    expect(screen.getByRole('tooltip').textContent).toContain(formatDay(t0 + DAY));
  });

  it('says so when there were no heals', () => {
    render(<TrendChart trend={[{ t: t0, heals: 0, aiHeals: 0 }]} days={7} />);
    expect(screen.getByText('No heals in the last 7 days.')).toBeTruthy();
  });
});
```

`web/src/components/selector-health/regression-banner.test.tsx`:

```tsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (data: unknown) => void>(),
  navigate: vi.fn(),
}));
vi.mock('../../hooks/useSocket', () => ({
  useSocket: () => ({
    on: (event: string, fn: (data: unknown) => void) => {
      h.handlers.set(event, fn);
      return () => h.handlers.delete(event);
    },
  }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}));

import { RegressionBanner } from './regression-banner';

describe('RegressionBanner', () => {
  it('says a fixed selector broke again, and leads to the selectors to fix', () => {
    render(<RegressionBanner />);
    act(() => h.handlers.get('selector_regressed')?.({ original_strategy: 'xpath', original_selector: '//a' }));
    expect(screen.getByRole('alert').textContent).toContain('A selector you fixed broke again');
    expect(screen.getByRole('alert').textContent).toContain('//a');
    fireEvent.click(screen.getByRole('button', { name: 'Show selectors to fix' }));
    expect(h.navigate).toHaveBeenCalledWith('/selector-health');
  });

  it('counts several at once', () => {
    render(<RegressionBanner />);
    act(() => {
      h.handlers.get('selector_regressed')?.({ original_strategy: 'xpath', original_selector: '//a' });
      h.handlers.get('selector_regressed')?.({ original_strategy: 'xpath', original_selector: '//b' });
    });
    expect(screen.getByRole('alert').textContent).toContain('2 selectors you fixed broke again');
  });
});
```

`web/src/components/selector-health/copy-language-modal.test.tsx`:

```tsx
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CopyButton } from './copy-language-modal';

describe('CopyButton', () => {
  afterEach(() => localStorage.removeItem('xenon.copyLang'));

  it('copies the fix as code in the remembered language', async () => {
    localStorage.setItem('xenon.copyLang', 'python');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onCopied = vi.fn();
    render(<CopyButton strategy="accessibility id" value="confirm_order" onCopied={onCopied} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy as Py' }));

    await waitFor(() => expect(onCopied).toHaveBeenCalledWith('python'));
    expect(writeText.mock.calls[0][0]).toContain('confirm_order');
  });

  it('asks for a language the first time', () => {
    render(<CopyButton strategy="xpath" value="//a" onCopied={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as code' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd web && npx vitest run src/components/selector-health`
Expected: FAIL: the new modules don't exist; the banner says "regressed"; `CopyButton` wants a `hotspot`.

- [ ] **Step 3: Summary and trend**

`web/src/components/selector-health/summary-strip.tsx`:

```tsx
import React from 'react';
import { StatTile } from '../ui/stat-tile';
import { IHealingSummaryResponse } from '../../interfaces/IHealingEvent';
import { compareNote, formatDuration } from './format';

interface Props {
  summary: IHealingSummaryResponse | null;
  days: number;
}

const count = (n: number) => n.toLocaleString();

/** The period's four numbers, each compared with the period before it. */
export const SummaryStrip: React.FC<Props> = ({ summary, days }) => {
  const cur = summary?.current;
  const prior = summary?.prior;
  const tiles = [
    {
      label: 'Selectors that needed healing',
      value: cur?.distinctSelectors,
      before: prior?.distinctSelectors,
      kind: 'count' as const,
      show: count,
    },
    { label: 'Heals', value: cur?.totalHeals, before: prior?.totalHeals, kind: 'percent' as const, show: count },
    {
      label: 'Sessions affected',
      value: cur?.sessionsTouched,
      before: prior?.sessionsTouched,
      kind: 'percent' as const,
      show: count,
    },
    {
      label: 'Time spent healing',
      value: cur?.timeSpentMs,
      before: prior?.timeSpentMs,
      kind: 'duration' as const,
      show: formatDuration,
    },
  ];
  return (
    <div className="grid grid-cols-4 gap-3">
      {tiles.map((t) => {
        const note =
          t.value !== undefined && t.before !== undefined ? compareNote(t.value, t.before, days, t.kind) : null;
        return (
          <StatTile
            key={t.label}
            label={t.label}
            value={t.value !== undefined ? t.show(t.value) : '—'}
            note={note?.text}
            noteTone={note?.tone ?? 'neutral'}
          />
        );
      })}
    </div>
  );
};
```

`web/src/components/selector-health/trend-chart.tsx`:

```tsx
import React, { useMemo } from 'react';
import { Card } from '../ui/Card';
import { ChartSeries, LineChart, niceMax } from '../session-detail/line-chart';
import { IHealingTrendDay } from '../../interfaces/IHealingEvent';
import { formatDay } from './format';

const ALL = 'var(--color-info)';
const AI = 'var(--color-warning)';

interface Props {
  /** null while the summary loads. */
  trend: IHealingTrendDay[] | null;
  days: number;
}

const Legend: React.FC<{ color: string; label: string; total: number }> = ({ color, label, total }) => (
  <span className="flex items-center gap-1.5">
    <span className="inline-block h-0.5 w-3" style={{ background: color }} />
    <span>{label}</span>
    <span className="tabular-nums text-[var(--text)]">{total.toLocaleString()}</span>
  </span>
);

/** Heals per day over the period, with a second line for the heals that used AI. */
export const TrendChart: React.FC<Props> = ({ trend, days }) => {
  const list = useMemo(() => trend ?? [], [trend]);
  const start = list[0]?.t ?? 0;
  const total = list.reduce((s, d) => s + d.heals, 0);
  const ai = list.reduce((s, d) => s + d.aiHeals, 0);
  const times = useMemo(() => list.map((d) => d.t - start), [list, start]);
  const series: ChartSeries[] = useMemo(
    () => [
      { key: 'heals', label: 'All heals', color: ALL, values: list.map((d) => d.heals) },
      { key: 'ai', label: 'Heals that used AI', color: AI, values: list.map((d) => d.aiHeals) },
    ],
    [list],
  );
  const peak = list.reduce((m, d) => Math.max(m, d.heals), 0);

  let body: React.ReactNode;
  if (trend === null) {
    body = <div className="text-xs text-[var(--text-dim)]">Loading…</div>;
  } else if (total === 0) {
    body = <div className="text-xs text-[var(--text-dim)]">No heals in the last {days} days.</div>;
  } else {
    body = (
      <>
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
          <Legend color={ALL} label="All heals" total={total} />
          <Legend color={AI} label="Heals that used AI" total={ai} />
        </div>
        <LineChart
          times={times}
          series={series}
          yMax={niceMax(peak)}
          formatValue={(v) => String(Math.round(v))}
          formatTime={(t) => formatDay(start + t)}
          ariaLabel="Heals per day"
          height={120}
        />
      </>
    );
  }
  return <Card header="Heals per day">{body}</Card>;
};
```

- [ ] **Step 4: The banner, in plain words**

Replace `web/src/components/selector-health/regression-banner.tsx` with:

```tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import { Button } from '../ui/button';

interface BrokeAgain {
  selector: string;
  receivedAt: number;
}

const AUTO_DISMISS_MS = 30_000;
// Several inside this window fold into one "N selectors" banner.
const AGGREGATE_WINDOW_MS = 5 * 60_000;

/**
 * A live note when a selector someone marked fixed heals again (the
 * `selector_regressed` event). It goes after 30 s, or on dismiss.
 */
export function RegressionBanner() {
  const { on } = useSocket();
  const navigate = useNavigate();
  const [events, setEvents] = useState<BrokeAgain[]>([]);

  useEffect(() => {
    const unsub = on('selector_regressed', (data: { original_selector?: string } | undefined) => {
      setEvents((curr) => {
        const cutoff = Date.now() - AGGREGATE_WINDOW_MS;
        return [
          ...curr.filter((x) => x.receivedAt >= cutoff),
          { selector: data?.original_selector ?? '', receivedAt: Date.now() },
        ];
      });
    });
    return () => {
      if (unsub) unsub();
    };
  }, [on]);

  useEffect(() => {
    if (events.length === 0) return;
    const t = setTimeout(() => setEvents([]), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [events]);

  if (events.length === 0) return null;
  const single = events.length === 1 ? events[0] : null;
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-lg border border-[var(--color-warning)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text)]"
    >
      <RefreshCw size={14} className="shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {single ? (
          <>
            A selector you fixed broke again:{' '}
            <code className="font-mono text-xs" title={single.selector}>
              {single.selector}
            </code>
          </>
        ) : (
          `${events.length} selectors you fixed broke again in the last 5 minutes.`
        )}
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          navigate('/selector-health');
          setEvents([]);
        }}
      >
        Show selectors to fix
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setEvents([])}
        className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <X size={13} />
      </button>
    </div>
  );
}
```

- [ ] **Step 5: The copy button takes a strategy and a value**

In `web/src/components/selector-health/copy-language-modal.tsx`:
- Replace the import of `IHealingHotspot` with `import { Button } from '../ui/button';`.
- In `CopyLanguageModal`'s footer, replace the two `<button className="sh-action-btn…">` elements with:

```tsx
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCopy}>Copy as {shortLabel(lang)}</Button>
```

- Replace the modal body's class names: the hint `<p>` gets `className="mb-3 text-xs text-[var(--text-muted)]"`; the `<ul>` gets `className="mb-3 space-y-1"`; each `<label>` gets `className="flex items-center gap-2 text-sm text-[var(--text)]"`; the "Preview" label gets `className="mb-1 text-[11px] font-semibold text-[var(--text-dim)]"`; the `<pre>` gets `className="mb-3 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] p-3 font-mono text-[11px] text-[var(--text)]"`; the remember `<label>` gets `className="flex items-center gap-2 text-xs text-[var(--text-muted)]"`.
- Replace `interface ButtonProps` and `CopyButton` with:

```tsx
interface ButtonProps {
  /** The fix's strategy, e.g. "xpath". */
  strategy: string;
  /** The fix's selector. */
  value: string;
  onCopied: (lang: Language) => void;
}

// Two-mode copy button: a stored language enables a direct one-click copy
// (and shows the language as the label); the chevron always opens the
// modal so users can switch language anytime. First-time use opens the
// modal automatically because there's no stored language to bias toward.
export function CopyButton({ strategy, value, onCopied }: ButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const stored = getStoredLanguage();
  // A Visual AI heal is a place on screen, not a selector: there's no code to copy.
  const isVisual = strategy === 'xenon:visual';

  const directCopy = async () => {
    if (!stored) {
      setModalOpen(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(snippet(stored, strategy, value));
    } catch {
      /* no clipboard permission */
    }
    setJustCopied(true);
    onCopied(stored);
    setTimeout(() => setJustCopied(false), 1500);
  };

  const label = stored ? `Copy as ${shortLabel(stored)}` : 'Copy as code';
  return (
    <span className="inline-flex shrink-0">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="rounded-r-none"
        onClick={(e) => {
          e.stopPropagation();
          void directCopy();
        }}
        disabled={isVisual && !value}
        aria-label={label}
        title={isVisual ? 'Found by its place on screen: there is no selector to copy' : label}
      >
        {justCopied ? <Check size={12} /> : <Copy size={12} />}
        <span>{justCopied ? 'Copied' : stored ? label : 'Copy as…'}</span>
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="rounded-l-none border-l-0 px-1.5"
        onClick={(e) => {
          e.stopPropagation();
          setModalOpen(true);
        }}
        title="Choose copy language"
        aria-label="Choose copy language"
      >
        <ChevronDown size={12} />
      </Button>
      <CopyLanguageModal
        open={modalOpen}
        initialLang={stored ?? undefined}
        strategy={strategy}
        value={value}
        onCopy={(lang) => {
          setJustCopied(true);
          onCopied(lang);
          setTimeout(() => setJustCopied(false), 1500);
        }}
        onClose={() => setModalOpen(false)}
      />
    </span>
  );
}
```

In `web/src/components/selector-health/selector-health-page.tsx` (replaced in Task 12), change its one `<CopyButton hotspot={h} …>` to `<CopyButton strategy={h.suggestedStrategy ?? h.originalStrategy ?? ''} value={h.suggestedRewrite ?? ''} …>` so it compiles until then.

- [ ] **Step 6: Run the tests and types**

Run: `cd web && npx vitest run src/components/selector-health`
Expected: PASS, all passing.

Run: `cd web && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/selector-health/summary-strip.tsx web/src/components/selector-health/summary-strip.test.tsx web/src/components/selector-health/trend-chart.tsx web/src/components/selector-health/trend-chart.test.tsx web/src/components/selector-health/regression-banner.tsx web/src/components/selector-health/regression-banner.test.tsx web/src/components/selector-health/copy-language-modal.tsx web/src/components/selector-health/copy-language-modal.test.tsx web/src/components/selector-health/selector-health-page.tsx
git commit -m "feat(web): Selector Health's summary, trend, broke-again banner and copy button"
```

---

### Task 10: The list

**Files:**
- Create: `web/src/components/selector-health/selector-bits.tsx`
- Create: `web/src/components/selector-health/selector-list.tsx`
- Test: `web/src/components/selector-health/selector-list.test.tsx`

**Interfaces:**
- Consumes: `SelectorHealthView`, `DEFAULT_VIEW`, `OpenSelector`, `selectorKey` (Task 8); `ISelectorListResponse`, `ISelectorListItem`; `TAB_LABELS`, `SORT_LABELS`, `METHODS`, `METHOD_EXPLANATIONS`, `PLATFORMS`, `formatRelative`, `formatDate`, `personText`, `shareText`, `strategyLabel`.
- Produces:
  - `selector-bits.tsx`: `Chip({ title?, tone?: 'neutral' | 'warning', children })`, `SelectorText({ strategy, text, extra? })`.
  - `selector-list.tsx`: `SEARCH_DELAY_MS = 300`; `SelectorList({ view, data, loading, compact, selectedKey, onView(patch), onOpen(s) })`. Rows carry `data-selector-row` and `data-key={selectorKey(...)}`.

- [ ] **Step 1: Write the failing test**

`web/src/components/selector-health/selector-list.test.tsx`:

```tsx
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SEARCH_DELAY_MS, SelectorList } from './selector-list';
import { DEFAULT_VIEW, SelectorHealthView } from './view-state';
import { ISelectorListItem, ISelectorListResponse, ISelectorStateView } from '../../interfaces/IHealingEvent';

const HOT = '//android.widget.Button[@text="Confirm"]';
const FIX = "//android.widget.Button[@content-desc='Confirm order']";

const item = (over: Partial<ISelectorListItem> = {}): ISelectorListItem => ({
  strategy: 'xpath',
  selector: HOT,
  heals: 137,
  sessions: 48,
  lastHealedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  timeSpentMs: 60_000,
  topMethod: 'Visual AI',
  suggestion: { selector: FIX, strategy: 'xpath', share: 0.82 },
  state: null,
  ...over,
});

const state = (over: Partial<ISelectorStateView>): ISelectorStateView => ({
  status: 'active',
  cleanBuilds: 0,
  fixedAt: null,
  fixedBy: null,
  resolvedAt: null,
  mutedAt: null,
  mutedBy: null,
  muteReason: null,
  brokeAgain: 0,
  ...over,
});

const data = (over: Partial<ISelectorListResponse> = {}): ISelectorListResponse => ({
  tab: 'fix',
  days: 30,
  page: 1,
  pageSize: 50,
  total: 312,
  counts: { fix: 312, verifying: 2, fixed: 4, muted: 1 },
  canAct: true,
  items: [item(), item({ selector: '//b', heals: 2, sessions: 1 })],
  ...over,
});

function renderList(props: Partial<React.ComponentProps<typeof SelectorList>> = {}) {
  const onView = vi.fn();
  const onOpen = vi.fn();
  render(
    <SelectorList
      view={DEFAULT_VIEW}
      data={data()}
      loading={false}
      compact={false}
      selectedKey={null}
      onView={onView}
      onOpen={onOpen}
      {...props}
    />,
  );
  return { onView, onOpen };
}

const view = (over: Partial<SelectorHealthView>): SelectorHealthView => ({ ...DEFAULT_VIEW, ...over });

describe('SelectorList', () => {
  afterEach(() => vi.useRealTimers());

  it('shows every tab with its count, the open one selected', () => {
    renderList();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['To fix312', 'Being verified2', 'Fixed4', 'Muted1']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('switches tab, back to the first page', () => {
    const { onView } = renderList();
    fireEvent.click(screen.getByRole('tab', { name: /Muted/ }));
    expect(onView).toHaveBeenCalledWith({ tab: 'muted', page: 1 });
  });

  it('shows the selector and its suggested fix in full, with the share of heals', () => {
    renderList();
    expect(screen.getAllByText(HOT)[0].getAttribute('title')).toBe(HOT);
    expect(screen.getAllByText(FIX)[0]).toBeTruthy();
    expect(screen.getAllByText('82% of heals')[0]).toBeTruthy();
    expect(screen.getByText('48 sessions')).toBeTruthy();
    expect(screen.getAllByText('Visual AI')[0].getAttribute('title')).toBe('Found it in a screenshot with AI');
  });

  it('opens a row by click or by Enter', () => {
    const { onOpen } = renderList();
    const rows = screen.getAllByRole('row').slice(1);
    fireEvent.click(rows[0]);
    fireEvent.keyDown(rows[1], { key: 'Enter' });
    expect(onOpen.mock.calls).toEqual([
      [{ strategy: 'xpath', selector: HOT }],
      [{ strategy: 'xpath', selector: '//b' }],
    ]);
  });

  it('narrows to selector, heals and last healed beside the panel', () => {
    renderList({ compact: true });
    expect(screen.queryByText('Suggested fix')).toBeNull();
    expect(screen.queryByText('Healed by')).toBeNull();
    expect(screen.getByText('Last healed')).toBeTruthy();
  });

  it('marks a selector that broke again', () => {
    renderList({ data: data({ items: [item({ state: state({ brokeAgain: 2 }) })] }) });
    expect(screen.getByText('Broke again')).toBeTruthy();
  });

  it('searches after a pause, from the first page', () => {
    vi.useFakeTimers();
    const { onView } = renderList();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'confirm' } });
    expect(onView).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(onView).toHaveBeenCalledWith({ q: 'confirm', page: 1 });
  });

  it('filters and sorts what to fix, and only that tab', () => {
    const { onView } = renderList();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'time' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Platform' }), { target: { value: 'ios' } });
    expect(onView.mock.calls).toEqual([[{ sort: 'time', page: 1 }], [{ platform: 'ios', page: 1 }]]);
  });

  it('has no filters or sort on a status tab', () => {
    renderList({ view: view({ tab: 'muted' }), data: data({ tab: 'muted' }) });
    expect(screen.queryByRole('combobox', { name: 'Sort' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Platform' })).toBeNull();
  });

  it('pages', () => {
    const { onView } = renderList();
    expect(screen.getByText('1–50 of 312')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onView).toHaveBeenCalledWith({ page: 2 });
  });

  it('shows who marked a selector fixed and how far its verification is', () => {
    renderList({
      view: view({ tab: 'verifying' }),
      data: data({
        tab: 'verifying',
        items: [
          item({
            state: state({
              status: 'pending',
              cleanBuilds: 2,
              fixedAt: new Date().toISOString(),
              fixedBy: { id: 'u', name: 'Priya' },
            }),
          }),
        ],
      }),
    });
    expect(screen.getByText('2 of 3 clean builds')).toBeTruthy();
    expect(screen.getByText(/by Priya/)).toBeTruthy();
  });

  it('shows who muted a selector, and why, never an id', () => {
    renderList({
      view: view({ tab: 'muted' }),
      data: data({
        tab: 'muted',
        items: [
          item({
            state: state({
              status: 'muted',
              mutedAt: '2026-09-12T10:00:00Z',
              mutedBy: { id: 'u-gone', name: null },
              muteReason: 'Screen being redesigned',
            }),
          }),
        ],
      }),
    });
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('Screen being redesigned')).toBeTruthy();
    expect(row.textContent).not.toContain('u-gone');
  });

  it('says what an empty tab means', () => {
    renderList({ data: data({ items: [], total: 0 }) });
    expect(screen.getByText('Nothing to fix in the last 30 days')).toBeTruthy();
  });

  it('says when a search found nothing', () => {
    renderList({ view: view({ q: 'zzz' }), data: data({ items: [], total: 0 }) });
    expect(screen.getByText('No selectors match “zzz”')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd web && npx vitest run src/components/selector-health/selector-list.test.tsx`
Expected: FAIL, cannot find `./selector-list`.

- [ ] **Step 3: Shared bits**

`web/src/components/selector-health/selector-bits.tsx`:

```tsx
import React from 'react';
import { strategyLabel } from './format';

/** A small label: a selector's type, a healing method, a status note. */
export const Chip: React.FC<{ title?: string; tone?: 'neutral' | 'warning'; children: React.ReactNode }> = ({
  title,
  tone = 'neutral',
  children,
}) => (
  <span
    title={title}
    className={`inline-block max-w-full truncate rounded px-1.5 py-px text-[10px] font-medium ${
      tone === 'warning'
        ? 'border border-[var(--color-warning)] text-[var(--color-warning)]'
        : 'bg-[rgb(var(--rgb-fg)/0.06)] text-[var(--text-muted)]'
    }`}
  >
    {children}
  </span>
);

/** A selector with its type above it, up to two lines, the whole of it on hover. */
export const SelectorText: React.FC<{ strategy: string | null; text: string; extra?: React.ReactNode }> = ({
  strategy,
  text,
  extra,
}) => (
  <div className="min-w-0">
    <div className="mb-0.5 flex min-w-0 items-center gap-1.5">
      <Chip>{strategyLabel(strategy)}</Chip>
      {extra}
    </div>
    <code className="line-clamp-2 break-all font-mono text-[11px] leading-snug text-[var(--text)]" title={text}>
      {text}
    </code>
  </div>
);
```

- [ ] **Step 4: The list**

`web/src/components/selector-health/selector-list.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Button } from '../ui/button';
import {
  ISelectorListItem,
  ISelectorListResponse,
  SelectorSort,
  SelectorTab,
} from '../../interfaces/IHealingEvent';
import { OpenSelector, SelectorHealthView, selectorKey } from './view-state';
import {
  METHODS,
  METHOD_EXPLANATIONS,
  PLATFORMS,
  SORT_LABELS,
  TAB_LABELS,
  formatDate,
  formatRelative,
  personText,
  shareText,
} from './format';
import { Chip, SelectorText } from './selector-bits';

export const SEARCH_DELAY_MS = 300;

const TABS: SelectorTab[] = ['fix', 'verifying', 'fixed', 'muted'];
const SORTS: SelectorSort[] = ['heals', 'recent', 'time'];

interface Props {
  view: SelectorHealthView;
  data: ISelectorListResponse | null;
  loading: boolean;
  /** The side panel is open: keep the columns that fit beside it. */
  compact: boolean;
  selectedKey: string | null;
  onView: (patch: Partial<SelectorHealthView>) => void;
  onOpen: (s: OpenSelector) => void;
}

interface Column {
  key: string;
  label: string;
  /** A CSS width; the selector column takes what is left. */
  width?: string;
  cell: (it: ISelectorListItem) => React.ReactNode;
}

const muted = (text: string) => <span className="text-xs text-[var(--text-muted)]">{text}</span>;

function columns(tab: SelectorTab, compact: boolean, days: number): Column[] {
  const selector: Column = {
    key: 'selector',
    label: 'Selector',
    cell: (it) => (
      <SelectorText
        strategy={it.strategy}
        text={it.selector}
        extra={
          tab === 'fix' && it.state && it.state.brokeAgain > 0 ? <Chip tone="warning">Broke again</Chip> : null
        }
      />
    ),
  };
  const heals = (label: string): Column => ({
    key: 'heals',
    label,
    width: '96px',
    cell: (it) => (
      <div>
        <div className="font-semibold tabular-nums text-[var(--text)]">{it.heals.toLocaleString()}</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          {it.sessions} {it.sessions === 1 ? 'session' : 'sessions'}
        </div>
      </div>
    ),
  });
  const last: Column = {
    key: 'last',
    label: 'Last healed',
    width: '104px',
    cell: (it) => muted(formatRelative(it.lastHealedAt)),
  };
  switch (tab) {
    case 'fix':
      return compact
        ? [selector, heals('Heals'), last]
        : [
            selector,
            heals('Heals'),
            last,
            {
              key: 'method',
              label: 'Healed by',
              width: '112px',
              cell: (it) =>
                it.topMethod ? <Chip title={METHOD_EXPLANATIONS[it.topMethod]}>{it.topMethod}</Chip> : muted('—'),
            },
            {
              key: 'fix',
              label: 'Suggested fix',
              width: '34%',
              cell: (it) =>
                it.suggestion ? (
                  <SelectorText
                    strategy={it.suggestion.strategy}
                    text={it.suggestion.selector}
                    extra={<span className="text-[10px] text-[var(--text-muted)]">{shareText(it.suggestion.share)}</span>}
                  />
                ) : (
                  muted('None yet')
                ),
            },
          ];
    case 'verifying': {
      const progress: Column = {
        key: 'progress',
        label: 'Progress',
        width: '150px',
        cell: (it) => <span className="text-xs text-[var(--text)]">{it.state?.cleanBuilds ?? 0} of 3 clean builds</span>,
      };
      return compact
        ? [selector, progress]
        : [
            selector,
            progress,
            {
              key: 'marked',
              label: 'Marked fixed',
              width: '180px',
              cell: (it) => muted(`${formatRelative(it.state?.fixedAt ?? null)}${personText(it.state?.fixedBy ?? null)}`),
            },
            heals(`Heals, ${days} days`),
          ];
    }
    case 'fixed': {
      const verified: Column = {
        key: 'verified',
        label: 'Verified',
        width: '140px',
        cell: (it) => muted(formatDate(it.state?.resolvedAt ?? null)),
      };
      return compact ? [selector, verified] : [selector, verified, heals(`Heals, ${days} days`)];
    }
    case 'muted': {
      const when: Column = {
        key: 'muted',
        label: 'Muted',
        width: '180px',
        cell: (it) => muted(`${formatDate(it.state?.mutedAt ?? null)}${personText(it.state?.mutedBy ?? null)}`),
      };
      return compact
        ? [selector, when]
        : [
            selector,
            when,
            {
              key: 'reason',
              label: 'Reason',
              width: '26%',
              cell: (it) =>
                it.state?.muteReason ? (
                  <span className="line-clamp-2 text-xs text-[var(--text)]">{it.state.muteReason}</span>
                ) : (
                  muted('No reason given')
                ),
            },
            heals(`Heals, ${days} days`),
          ];
    }
  }
}

function emptyText(tab: SelectorTab, q: string, days: number): { title: string; description: string } {
  if (q) return { title: `No selectors match “${q}”`, description: 'Try fewer or different words.' };
  switch (tab) {
    case 'fix':
      return {
        title: `Nothing to fix in the last ${days} days`,
        description: 'Every selector your tests used was found without healing.',
      };
    case 'verifying':
      return {
        title: 'Nothing being verified',
        description: 'When you mark a selector fixed, Xenon watches its next 3 clean builds here.',
      };
    case 'fixed':
      return {
        title: `Nothing fixed in the last ${days} days`,
        description: 'Selectors that pass 3 clean builds after being marked fixed show here.',
      };
    case 'muted':
      return {
        title: 'Nothing muted',
        description: 'A muted selector is left out of this list, the CI gate and the digest.',
      };
  }
}

/** The tabs, the search and filters, and one page of selectors. */
export const SelectorList: React.FC<Props> = ({ view, data, loading, compact, selectedKey, onView, onOpen }) => {
  const [q, setQ] = useState(view.q);
  useEffect(() => setQ(view.q), [view.q]);
  useEffect(() => {
    if (q === view.q) return undefined;
    const id = setTimeout(() => onView({ q, page: 1 }), SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [q, view.q, onView]);

  const cols = columns(view.tab, compact, view.days);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? view.page;
  const size = data?.pageSize ?? 50;
  const lastPage = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const empty = emptyText(view.tab, view.q, view.days);

  return (
    <section aria-label="Selectors" className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div role="tablist" aria-label="Selector status" className="flex gap-1 border-b border-[var(--border)] px-3">
        {TABS.map((t) => {
          const active = view.tab === t;
          const count = data?.counts?.[t];
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (!active) onView({ tab: t, page: 1 });
              }}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm ${
                active
                  ? 'border-[var(--color-accent)] font-medium text-[var(--text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {TAB_LABELS[t]}
              <span className="rounded-full bg-[rgb(var(--rgb-fg)/0.08)] px-1.5 text-[11px] tabular-nums">
                {typeof count === 'number' ? count.toLocaleString() : '–'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <Input
          type="search"
          aria-label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={view.tab === 'fix' ? 'Search selectors and fixes' : 'Search selectors'}
          className="min-w-[220px] flex-1"
        />
        {view.tab === 'fix' && (
          <>
            <Select
              selectSize="sm"
              aria-label="Platform"
              value={view.platform}
              onChange={(e) => onView({ platform: e.target.value, page: 1 })}
            >
              <option value="">All platforms</option>
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Select
              selectSize="sm"
              aria-label="Healing method"
              value={view.method}
              onChange={(e) => onView({ method: e.target.value, page: 1 })}
            >
              <option value="">All healing methods</option>
              {METHODS.map((m) => (
                <option key={m} value={m} title={METHOD_EXPLANATIONS[m]}>
                  {m}
                </option>
              ))}
            </Select>
            <Select
              selectSize="sm"
              aria-label="Sort"
              value={view.sort}
              onChange={(e) => onView({ sort: e.target.value as SelectorSort, page: 1 })}
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </Select>
          </>
        )}
      </div>

      {loading && !data ? (
        <div className="px-4 py-10 text-center text-xs text-[var(--text-dim)]">Loading selectors…</div>
      ) : items.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description} />
      ) : (
        <table className="w-full table-fixed text-left">
          <colgroup>
            {cols.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2 text-[11px] font-medium text-[var(--text-muted)]">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const key = selectorKey(it);
              const selected = key === selectedKey;
              const open = () => onOpen({ strategy: it.strategy, selector: it.selector });
              return (
                <tr
                  key={key}
                  tabIndex={0}
                  data-selector-row=""
                  data-key={key}
                  aria-current={selected ? 'true' : undefined}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open();
                    }
                  }}
                  className={`cursor-pointer border-t border-[var(--border)] align-top outline-none hover:bg-[rgb(var(--rgb-fg)/0.03)] focus-visible:bg-[rgb(var(--rgb-fg)/0.05)] ${
                    selected ? 'bg-[rgb(var(--rgb-fg)/0.06)]' : ''
                  }`}
                >
                  {cols.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-xs">
                      {c.cell(it)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)]">
          <span className="tabular-nums">
            {from}–{to} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onView({ page: page - 1 })}>
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= lastPage}
              onClick={() => onView({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};
```

- [ ] **Step 5: Run the test**

Run: `cd web && npx vitest run src/components/selector-health/selector-list.test.tsx`
Expected: PASS, all passing.

- [ ] **Step 6: Lint, format and commit**

Run: `cd .. && npx prettier --write web/src/components/selector-health/selector-bits.tsx web/src/components/selector-health/selector-list.tsx web/src/components/selector-health/selector-list.test.tsx && npx eslint web/src/components/selector-health/selector-bits.tsx web/src/components/selector-health/selector-list.tsx web/src/components/selector-health/selector-list.test.tsx`
Expected: no findings.

```bash
git add web/src/components/selector-health/selector-bits.tsx web/src/components/selector-health/selector-list.tsx web/src/components/selector-health/selector-list.test.tsx
git commit -m "feat(web): the Selector Health list: tabs with counts, search, filters, full selectors, paging"
```

---

### Task 11: The side panel and its dialogs

**Files:**
- Create: `web/src/components/selector-health/selector-dialogs.tsx` (+ `selector-dialogs.test.tsx`)
- Create: `web/src/components/selector-health/selector-panel.tsx` (+ `selector-panel.test.tsx`)

**Interfaces:**
- Consumes: `getSelectorPanel`, `postSelectorStateAction` (Task 8); `ISelectorDetailResponse`; `OpenSelector`; `CopyButton` (Task 9); `Chip` (Task 10); `LineChart`; `format.ts` helpers.
- Produces:
  - `MUTE_REASON_MAX = 500`; `MarkFixedDialog`, `CancelVerificationDialog` (`{ open, busy, onClose, onConfirm() }`), `MuteDialog` (`{ open, busy, onClose, onConfirm(reason: string) }`).
  - `SelectorPanel({ target, days, tz, refreshKey, onClose, onChanged })`, an `<aside aria-label="Selector details">`. It reloads when `target`, `days`, `tz` or `refreshKey` change, and calls `onChanged()` after an action (success or not).

- [ ] **Step 1: Write the failing tests**

`web/src/components/selector-health/selector-dialogs.test.tsx`:

```tsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MarkFixedDialog, MuteDialog, MUTE_REASON_MAX } from './selector-dialogs';

describe('Selector Health dialogs', () => {
  it('confirms marking fixed, saying what happens next', () => {
    const onConfirm = vi.fn();
    render(<MarkFixedDialog open busy={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByText(/watches the next 3 clean builds/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark fixed' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('mutes with an optional reason, trimmed, of at most 500 characters', () => {
    const onConfirm = vi.fn();
    render(<MuteDialog open busy={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    const reason = screen.getByLabelText('Reason (optional)');
    expect(reason.getAttribute('maxLength')).toBe(String(MUTE_REASON_MAX));
    fireEvent.change(reason, { target: { value: '  Screen being redesigned  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(onConfirm).toHaveBeenCalledWith('Screen being redesigned');
  });
});
```

`web/src/components/selector-health/selector-panel.test.tsx`:

```tsx
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import XenonApiService from '../../api-service';
import { ISelectorDetailResponse, ISelectorStateView } from '../../interfaces/IHealingEvent';

const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast: h.toast }) }));

import { SelectorPanel } from './selector-panel';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 8, 30);

const DETAIL: ISelectorDetailResponse = {
  strategy: 'xpath',
  selector: '//a',
  days: 30,
  heals: 4,
  sessions: 2,
  timeSpentMs: 18000,
  firstHealedAt: new Date(t0).toISOString(),
  lastHealedAt: new Date(t0 + DAY).toISOString(),
  daily: [
    { t: t0, heals: 1 },
    { t: t0 + DAY, heals: 3 },
  ],
  suggestions: [
    { selector: '//fix', strategy: 'xpath', count: 3, share: 0.75, methods: ['Visual AI'], averageConfidence: 0.9 },
    { selector: 'confirm', strategy: 'accessibility id', count: 1, share: 0.25, methods: ['LLM'], averageConfidence: 0.5 },
  ],
  platforms: [{ name: 'android', count: 4 }],
  builds: [
    { id: 'b1', name: 'nightly-2026-10-01', count: 3 },
    { id: null, name: 'No build', count: 1 },
  ],
  devices: [{ udid: 'p1', name: 'Shared Pixel', count: 4 }],
  recent: [
    {
      id: 'r1',
      sessionId: 's1',
      buildId: null,
      at: new Date().toISOString(),
      device: 'Shared Pixel',
      platform: 'android',
      method: 'LLM',
      confidence: 0.5,
      healedSelector: 'confirm',
    },
  ],
  state: null,
  activity: [{ action: 'muted', at: '2026-09-12T10:00:00Z', by: { id: 'u-gone', name: null }, reason: 'Redesign' }],
  canAct: true,
};

const pending: ISelectorStateView = {
  status: 'pending',
  cleanBuilds: 2,
  fixedAt: new Date().toISOString(),
  fixedBy: { id: 'u', name: 'Priya' },
  resolvedAt: null,
  mutedAt: null,
  mutedBy: null,
  muteReason: null,
  brokeAgain: 0,
};

function renderPanel(over: Partial<ISelectorDetailResponse> = {}, status = 200) {
  vi.spyOn(XenonApiService, 'getSelectorPanel').mockResolvedValue({
    status,
    body: status === 200 ? { ...DETAIL, ...over } : null,
  });
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <SelectorPanel
        target={{ strategy: 'xpath', selector: '//a' }}
        days={30}
        tz={0}
        refreshKey={0}
        onClose={onClose}
        onChanged={onChanged}
      />
    </MemoryRouter>,
  );
  return { onChanged, onClose };
}

describe('SelectorPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    h.toast.mockReset();
  });

  it('shows the selector, its status and every section', async () => {
    renderPanel();
    expect(await screen.findByText('//fix')).toBeTruthy();
    const panel = screen.getByRole('complementary', { name: 'Selector details' });
    expect(within(panel).getByText('To fix')).toBeTruthy();
    expect(within(panel).getByText(/75% of heals/)).toBeTruthy();
    expect(within(panel).getByText('18 s')).toBeTruthy();
    expect(within(panel).getByText('nightly-2026-10-01')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Session' }).getAttribute('href')).toBe('/builds/none/sessions/s1');
  });

  it('shows an action by someone the server no longer knows without a name or an id', async () => {
    renderPanel();
    const activity = await screen.findByRole('region', { name: 'Activity' });
    expect(activity.textContent).toContain('Muted');
    expect(activity.textContent).toContain('Redesign');
    expect(activity.textContent).not.toContain('u-gone');
  });

  it('hides the actions from someone who may not act', async () => {
    renderPanel({ canAct: false });
    await screen.findByText('//fix');
    expect(screen.queryByRole('button', { name: 'Mark fixed' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mute…' })).toBeNull();
  });

  it('offers the actions that fit the status', async () => {
    renderPanel({ state: pending });
    expect(await screen.findByRole('button', { name: 'Cancel verification' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark fixed' })).toBeNull();
    expect(screen.getByText('Being verified, 2 of 3 clean builds')).toBeTruthy();
  });

  it('marks fixed after confirming, then tells the page', async () => {
    const post = vi.spyOn(XenonApiService, 'postSelectorStateAction').mockResolvedValue({ state: null });
    const { onChanged } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark fixed' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark fixed' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith({ original_strategy: 'xpath', original_selector: '//a', action: 'mark_fixed' });
    expect(h.toast).toHaveBeenCalledWith('Marked fixed. Xenon is watching the next 3 clean builds.', 'success');
  });

  it('mutes with the reason given', async () => {
    const post = vi.spyOn(XenonApiService, 'postSelectorStateAction').mockResolvedValue({ state: null });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Mute…' }));
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Redesign' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mute' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith({
        original_strategy: 'xpath',
        original_selector: '//a',
        action: 'mute',
        reason: 'Redesign',
      }),
    );
  });

  it('says plainly when someone changed the selector first, and refreshes', async () => {
    vi.spyOn(XenonApiService, 'postSelectorStateAction').mockRejectedValue(
      Object.assign(new Error('Cannot markFixed on a muted selector (xpath=//a)'), { status: 409 }),
    );
    const { onChanged } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark fixed' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark fixed' }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith('Someone changed this selector just now. It has been refreshed.', 'error'),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("says a selector isn't available when the server doesn't know it", async () => {
    renderPanel({}, 404);
    expect(await screen.findByText(/This selector isn't available/)).toBeTruthy();
  });

  it('says when there were no heals in the period', async () => {
    renderPanel({ heals: 0, suggestions: [], recent: [], daily: [], platforms: [], builds: [], devices: [] });
    expect(await screen.findByText('No heals in the last 30 days.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd web && npx vitest run src/components/selector-health/selector-dialogs.test.tsx src/components/selector-health/selector-panel.test.tsx`
Expected: FAIL, the modules don't exist.

- [ ] **Step 3: The dialogs**

`web/src/components/selector-health/selector-dialogs.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/button';

export const MUTE_REASON_MAX = 500;

interface ConfirmProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const MarkFixedDialog: React.FC<ConfirmProps> = ({ open, busy, onClose, onConfirm }) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Mark this selector fixed?"
    footer={
      <>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          Mark fixed
        </Button>
      </>
    }
  >
    <p className="text-sm text-[var(--text-muted)]">
      Xenon watches the next 3 clean builds. If this selector heals again, it goes back to To fix.
    </p>
  </Modal>
);

export const CancelVerificationDialog: React.FC<ConfirmProps> = ({ open, busy, onClose, onConfirm }) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Cancel verification?"
    footer={
      <>
        <Button variant="secondary" onClick={onClose}>
          Keep verifying
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          Cancel verification
        </Button>
      </>
    }
  >
    <p className="text-sm text-[var(--text-muted)]">
      The selector goes back to To fix, and its clean builds start again from zero.
    </p>
  </Modal>
);

export const MuteDialog: React.FC<{
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}> = ({ open, busy, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mute this selector?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(reason.trim())} disabled={busy}>
            Mute
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[var(--text-muted)]">
        A muted selector is left out of this list, the CI gate and the digest, for everyone, until
        someone unmutes it.
      </p>
      <label htmlFor="mute-reason" className="block text-xs font-medium text-[var(--text)]">
        Reason (optional)
      </label>
      <textarea
        id="mute-reason"
        value={reason}
        maxLength={MUTE_REASON_MAX}
        rows={3}
        placeholder="Screen being redesigned"
        onChange={(e) => setReason(e.target.value)}
        className="mt-1 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]"
      />
      <div className="mt-1 text-right text-[11px] tabular-nums text-[var(--text-dim)]">
        {reason.length}/{MUTE_REASON_MAX}
      </div>
    </Modal>
  );
};
```

- [ ] **Step 4: The panel**

`web/src/components/selector-health/selector-panel.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Link2, X } from 'lucide-react';
import XenonApiService from '../../api-service';
import { useToast } from '../ui/toast';
import { Button } from '../ui/button';
import { LineChart } from '../session-detail/line-chart';
import { platformLabel } from '../../lib/labels';
import { ISelectorActivity, ISelectorDetailResponse, ISelectorStateView } from '../../interfaces/IHealingEvent';
import { CopyButton } from './copy-language-modal';
import { CancelVerificationDialog, MarkFixedDialog, MuteDialog } from './selector-dialogs';
import { Chip } from './selector-bits';
import { OpenSelector } from './view-state';
import {
  METHOD_EXPLANATIONS,
  activityText,
  formatDate,
  formatDay,
  formatDuration,
  formatRelative,
  shareText,
  statusText,
  strategyLabel,
} from './format';

type Action = 'mark_fixed' | 'mute' | 'unmute' | 'cancel_verification';
type Dialog = 'mark_fixed' | 'mute' | 'cancel_verification' | null;

const DONE: Record<Action, string> = {
  mark_fixed: 'Marked fixed. Xenon is watching the next 3 clean builds.',
  mute: 'Muted.',
  unmute: 'Unmuted.',
  cancel_verification: 'Verification cancelled.',
};

interface Props {
  target: OpenSelector;
  days: number;
  tz: number;
  /** Bumped by the page to ask again (a live event, an action). */
  refreshKey: number;
  onClose: () => void;
  /** After an action, so the page can refresh the list. */
  onChanged: () => void;
}

const STATUS_TONE: Record<string, string> = {
  pending: 'border-[var(--color-info)] text-[var(--color-info)]',
  resolved: 'border-[var(--color-success)] text-[var(--color-success)]',
  muted: 'border-[var(--border-strong)] text-[var(--text-muted)]',
};

const StatusPill: React.FC<{ state: ISelectorStateView | null }> = ({ state }) => (
  <span
    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
      STATUS_TONE[state?.status ?? ''] ?? 'border-[var(--color-danger)] text-[var(--color-danger)]'
    }`}
  >
    {statusText(state)}
  </span>
);

const IconButton: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({
  label,
  onClick,
  children,
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[rgb(var(--rgb-fg)/0.06)] hover:text-[var(--text)]"
  >
    {children}
  </button>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section aria-label={title}>
    <h3 className="mb-2 text-xs font-semibold text-[var(--text)]">{title}</h3>
    {children}
  </section>
);

const Breakdown: React.FC<{ title: string; rows: Array<{ key: string; label: string; count: number }> }> = ({
  title,
  rows,
}) =>
  rows.length === 0 ? null : (
    <div className="mb-3">
      <div className="mb-1 text-[11px] text-[var(--text-dim)]">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="flex justify-between gap-3 py-0.5 text-xs">
          <span className="min-w-0 truncate text-[var(--text)]" title={r.label}>
            {r.label}
          </span>
          <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{r.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );

const ActivityList: React.FC<{ activity: ISelectorActivity[] }> = ({ activity }) => (
  <Section title="Activity">
    {activity.length === 0 ? (
      <p className="text-xs text-[var(--text-muted)]">Nobody has marked this selector fixed or muted it.</p>
    ) : (
      <ul>
        {activity.map((a, i) => (
          <li key={`${a.at}-${i}`} className="flex justify-between gap-3 py-1 text-[11px]">
            <span className="min-w-0">
              <span className="text-[var(--text)]">{activityText(a)}</span>
              {a.reason && <span className="text-[var(--text-muted)]">: “{a.reason}”</span>}
            </span>
            <span className="shrink-0 text-[var(--text-dim)]">{formatDate(a.at)}</span>
          </li>
        ))}
      </ul>
    )}
  </Section>
);

/**
 * One selector beside the list: its status and actions, the fixes the
 * healer found, its numbers, where it heals, its latest heals and who did
 * what to it.
 */
export const SelectorPanel: React.FC<Props> = ({ target, days, tz, refreshKey, onClose, onChanged }) => {
  const { toast } = useToast();
  const [detail, setDetail] = useState<ISelectorDetailResponse | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  // Another selector: clear the old one, rather than show it under the new name.
  useEffect(() => {
    setDetail(null);
    setPhase('loading');
  }, [target.strategy, target.selector]);

  useEffect(() => {
    let alive = true;
    XenonApiService.getSelectorPanel(target.strategy, target.selector, days, tz)
      .then(({ status, body }) => {
        if (!alive) return;
        if (status === 404) {
          setDetail(null);
          setPhase('missing');
        } else if (status === 200 && body) {
          setDetail(body);
          setPhase('ready');
        } else {
          setPhase('failed');
        }
      })
      .catch(() => {
        if (alive) setPhase('failed');
      });
    return () => {
      alive = false;
    };
  }, [target.strategy, target.selector, days, tz, refreshKey]);

  const act = async (action: Action, reason?: string) => {
    setBusy(true);
    try {
      await XenonApiService.postSelectorStateAction({
        original_strategy: target.strategy,
        original_selector: target.selector,
        action,
        ...(reason ? { reason } : {}),
      });
      toast(DONE[action], 'success');
    } catch (err) {
      const status = (err as { status?: number }).status;
      toast(
        status === 409
          ? 'Someone changed this selector just now. It has been refreshed.'
          : status === 404
            ? "This selector isn't available any more."
            : "That didn't work. Try again.",
        'error',
      );
    } finally {
      setBusy(false);
      setDialog(null);
      onChanged();
    }
  };

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done, 'success');
    } catch {
      toast("Couldn't copy: your browser blocked it.", 'error');
    }
  };

  const status = detail?.state?.status ?? 'active';
  const chart = useMemo(() => {
    const daily = detail?.daily ?? [];
    const start = daily[0]?.t ?? 0;
    return { start, times: daily.map((d) => d.t - start), values: daily.map((d) => d.heals) };
  }, [detail]);

  return (
    <aside
      aria-label="Selector details"
      className="sticky top-4 flex max-h-[calc(100vh-7rem)] w-[480px] shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
    >
      <header className="border-b border-[var(--border)] p-4">
        <div className="flex items-center gap-2">
          <Chip>{strategyLabel(target.strategy)}</Chip>
          {detail && <StatusPill state={detail.state} />}
          <span className="ml-auto flex items-center gap-0.5">
            <IconButton label="Copy selector" onClick={() => void copy(target.selector, 'Selector copied')}>
              <Copy size={14} />
            </IconButton>
            <IconButton label="Copy link to this selector" onClick={() => void copy(window.location.href, 'Link copied')}>
              <Link2 size={14} />
            </IconButton>
            <IconButton label="Close" onClick={onClose}>
              <X size={14} />
            </IconButton>
          </span>
        </div>
        <code className="mt-2 block break-all font-mono text-xs leading-relaxed text-[var(--text)]">
          {target.selector}
        </code>
        {detail?.canAct && (
          <div className="mt-3 flex flex-wrap gap-2">
            {status === 'active' && (
              <Button size="sm" onClick={() => setDialog('mark_fixed')}>
                Mark fixed
              </Button>
            )}
            {status === 'pending' && (
              <Button size="sm" variant="secondary" onClick={() => setDialog('cancel_verification')}>
                Cancel verification
              </Button>
            )}
            {status !== 'muted' && (
              <Button size="sm" variant="secondary" onClick={() => setDialog('mute')}>
                Mute…
              </Button>
            )}
            {status === 'muted' && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act('unmute')}>
                Unmute
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {phase === 'loading' && <p className="text-xs text-[var(--text-dim)]">Loading…</p>}
        {phase === 'missing' && (
          <p className="text-sm text-[var(--text-muted)]">
            This selector isn&apos;t available. It may belong to another team, or Xenon has no heals on record
            for it.
          </p>
        )}
        {phase === 'failed' && (
          <p className="text-sm text-[var(--text-muted)]">Couldn&apos;t load this selector. Try again in a moment.</p>
        )}
        {detail && detail.heals === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No heals in the last {days} days.</p>
        )}
        {detail && detail.heals > 0 && (
          <>
            <Section title="Suggested fix">
              {detail.suggestions.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Xenon found the element without a selector it can suggest.
                </p>
              ) : (
                <ul className="space-y-2">
                  {detail.suggestions.map((s, i) => (
                    <li
                      key={`${s.strategy ?? ''}\u0000${s.selector}`}
                      className={`rounded-md border p-2.5 ${
                        i === 0 ? 'border-[var(--color-success)]' : 'border-[var(--border)]'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                            <Chip>{strategyLabel(s.strategy)}</Chip>
                            <span>{shareText(s.share)}</span>
                            {s.methods.length > 0 && (
                              <span title={s.methods.map((m) => METHOD_EXPLANATIONS[m] ?? m).join('. ')}>
                                · {s.methods.join(', ')}
                              </span>
                            )}
                            {s.averageConfidence !== null && (
                              <span>· {Math.round(s.averageConfidence * 100)}% confidence</span>
                            )}
                          </div>
                          <code className="mt-1 block break-all font-mono text-[11px] text-[var(--text)]">
                            {s.selector}
                          </code>
                        </div>
                        <CopyButton
                          strategy={s.strategy ?? target.strategy}
                          value={s.selector}
                          onCopied={(lang) => toast(`Copied as ${lang}`, 'success')}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`In the last ${days} days`}>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: detail.heals === 1 ? 'heal' : 'heals', value: detail.heals.toLocaleString() },
                  { label: detail.sessions === 1 ? 'session' : 'sessions', value: detail.sessions.toLocaleString() },
                  { label: 'spent healing', value: formatDuration(detail.timeSpentMs) },
                ].map((s) => (
                  <div key={s.label} className="rounded-md bg-[rgb(var(--rgb-fg)/0.04)] px-2.5 py-2">
                    <div className="text-sm font-semibold tabular-nums text-[var(--text)]">{s.value}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">{s.label}</div>
                  </div>
                ))}
              </div>
              {chart.times.length > 1 && (
                <div className="mt-3">
                  <LineChart
                    times={chart.times}
                    series={[{ key: 'heals', label: 'Heals', color: 'var(--color-info)', values: chart.values }]}
                    formatValue={(v) => String(Math.round(v))}
                    formatTime={(t) => formatDay(chart.start + t)}
                    ariaLabel="Heals per day for this selector"
                    height={56}
                  />
                </div>
              )}
            </Section>

            <Section title="Where it happens">
              <Breakdown
                title="Platforms"
                rows={detail.platforms.map((p) => ({ key: p.name, label: platformLabel(p.name), count: p.count }))}
              />
              <Breakdown
                title="Builds"
                rows={detail.builds.map((b) => ({ key: b.id ?? '', label: b.name, count: b.count }))}
              />
              <Breakdown
                title="Devices"
                rows={detail.devices.map((d) => ({ key: d.udid, label: d.name, count: d.count }))}
              />
            </Section>

            <Section title="Recent heals">
              <ul className="divide-y divide-[var(--border)]">
                {detail.recent.map((r) => (
                  <li key={r.id} className="py-2 text-[11px]">
                    <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                      <span>{formatRelative(r.at)}</span>
                      {r.device && <span className="min-w-0 truncate">· {r.device}</span>}
                      {r.method && (
                        <span title={METHOD_EXPLANATIONS[r.method]}>
                          · {r.method}
                          {r.confidence !== null ? ` ${Math.round(r.confidence * 100)}%` : ''}
                        </span>
                      )}
                      <Link
                        className="ml-auto shrink-0 text-[var(--color-accent)] hover:underline"
                        to={`/builds/${encodeURIComponent(r.buildId ?? 'none')}/sessions/${encodeURIComponent(r.sessionId)}`}
                      >
                        Session
                      </Link>
                    </div>
                    {r.healedSelector && (
                      <code
                        className="mt-0.5 block truncate font-mono text-[var(--text)]"
                        title={r.healedSelector}
                      >
                        {r.healedSelector}
                      </code>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
        {detail && <ActivityList activity={detail.activity} />}
      </div>

      <MarkFixedDialog
        open={dialog === 'mark_fixed'}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('mark_fixed')}
      />
      <CancelVerificationDialog
        open={dialog === 'cancel_verification'}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void act('cancel_verification')}
      />
      <MuteDialog
        open={dialog === 'mute'}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => void act('mute', reason || undefined)}
      />
    </aside>
  );
};
```

- [ ] **Step 5: Run the tests**

Run: `cd web && npx vitest run src/components/selector-health`
Expected: PASS, all passing.

- [ ] **Step 6: Format, lint and commit**

Run: `cd .. && npx prettier --write web/src/components/selector-health/selector-dialogs.tsx web/src/components/selector-health/selector-dialogs.test.tsx web/src/components/selector-health/selector-panel.tsx web/src/components/selector-health/selector-panel.test.tsx && npx eslint web/src/components/selector-health/selector-dialogs.tsx web/src/components/selector-health/selector-panel.tsx web/src/components/selector-health/selector-dialogs.test.tsx web/src/components/selector-health/selector-panel.test.tsx`
Expected: no findings.

```bash
git add web/src/components/selector-health/selector-dialogs.tsx web/src/components/selector-health/selector-dialogs.test.tsx web/src/components/selector-health/selector-panel.tsx web/src/components/selector-health/selector-panel.test.tsx
git commit -m "feat(web): the Selector Health side panel: fixes to copy, numbers, where it heals, recent heals, activity, actions"
```

---

### Task 12: The page, the old link, and the old page gone

**Files:**
- Modify: `web/src/components/selector-health/selector-health-page.tsx` (rewrite)
- Create: `web/src/components/selector-health/selector-detail-redirect.tsx`
- Modify: `web/src/routes/index.tsx` (the detail route)
- Delete: `web/src/components/selector-health/selector-detail-page.tsx`, `pending-row.tsx`, `resolved-row.tsx`, `muted-list.tsx`, `tab-nav.tsx`, `selector-health.css`
- Modify: `web/src/design/color-literals.baseline.json` (remove the `selector-health.css` entry)
- Modify: `web/src/api-service/index.ts` and `web/src/interfaces/IHealingEvent.ts` (remove calls and types nothing uses any more)
- Test: `web/src/components/selector-health/selector-health-page.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 8–11; `useAuth` (`me.role`, `me.authDisabled`), `useSocket` (`on`), `useToast`, `PageHeader`, `SegmentedControl`.
- Produces: default export `SelectorHealthPage`; `SelectorDetailRedirect`; `LIVE_REFRESH_MS = 1000`.

- [ ] **Step 1: Write the failing test**

`web/src/components/selector-health/selector-health-page.test.tsx`:

```tsx
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import XenonApiService from '../../api-service';
import {
  IHealingSummaryResponse,
  ISelectorDetailResponse,
  ISelectorListItem,
  ISelectorListResponse,
} from '../../interfaces/IHealingEvent';

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  me: { role: 'MEMBER', userId: 'u-1' } as Record<string, unknown>,
}));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('../../hooks/useSocket', () => ({ useSocket: () => ({ on: () => () => undefined }) }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ me: h.me }) }));

import SelectorHealthPage from './selector-health-page';
import { SelectorDetailRedirect } from './selector-detail-redirect';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 8, 30);
const A = '//android.widget.Button[@text="Confirm"]';
const B = 'com.acme:id/cart_total';
const JARGON = /tuple|etalon|go-ios|\badb\b|estCost|Brittle|Avg conf|sessionMetrics|\$\d/i;

const SUMMARY: IHealingSummaryResponse = {
  windowDays: 30,
  current: { totalHeals: 265, distinctSelectors: 7, sessionsTouched: 61, byTier: {}, timeSpentMs: 840_000 },
  prior: { totalHeals: 190, distinctSelectors: 9, sessionsTouched: 50, byTier: {}, timeSpentMs: 660_000 },
  trend: [
    { t: t0, heals: 3, aiHeals: 1 },
    { t: t0 + DAY, heals: 5, aiHeals: 0 },
  ],
};

const item = (selector: string, heals: number): ISelectorListItem => ({
  strategy: 'xpath',
  selector,
  heals,
  sessions: 2,
  lastHealedAt: new Date().toISOString(),
  timeSpentMs: 9000,
  topMethod: 'Fuzzy XML',
  suggestion: { selector: `${selector}-fixed`, strategy: 'xpath', share: 0.5 },
  state: null,
});

const LIST: ISelectorListResponse = {
  tab: 'fix',
  days: 30,
  page: 1,
  pageSize: 50,
  total: 2,
  counts: { fix: 2, verifying: 0, fixed: 0, muted: 0 },
  canAct: true,
  items: [item(A, 4), item(B, 2)],
};

const detailFor = (selector: string): ISelectorDetailResponse => ({
  strategy: 'xpath',
  selector,
  days: 30,
  heals: 2,
  sessions: 1,
  timeSpentMs: 2000,
  firstHealedAt: null,
  lastHealedAt: null,
  daily: [],
  suggestions: [],
  platforms: [],
  builds: [],
  devices: [],
  recent: [],
  state: null,
  activity: [],
  canAct: true,
});

const Where = () => {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
};

function renderPage(path = '/selector-health') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/selector-health"
          element={
            <>
              <SelectorHealthPage />
              <Where />
            </>
          }
        />
        <Route path="/selector-health/detail" element={<SelectorDetailRedirect />} />
      </Routes>
    </MemoryRouter>,
  );
}

let listSpy: ReturnType<typeof vi.spyOn>;
let panelSpy: ReturnType<typeof vi.spyOn>;

describe('SelectorHealthPage', () => {
  beforeEach(() => {
    vi.spyOn(XenonApiService, 'getHealingSummary').mockResolvedValue(SUMMARY);
    listSpy = vi.spyOn(XenonApiService, 'getHealingSelectors').mockResolvedValue(LIST);
    panelSpy = vi
      .spyOn(XenonApiService, 'getSelectorPanel')
      .mockImplementation(async (_s: string, selector: string) => ({ status: 200, body: detailFor(selector) }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    h.me = { role: 'MEMBER', userId: 'u-1' };
  });

  it('shows the summary, the trend and what to fix', async () => {
    renderPage();
    expect(await screen.findByText(A)).toBeTruthy();
    expect(screen.getByText('Selectors that needed healing')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Heals per day' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send digest/ })).toBeNull();
  });

  it('offers the digest to admins', async () => {
    h.me = { role: 'ADMIN', userId: 'u-1' };
    renderPage();
    expect(await screen.findByRole('button', { name: /Send digest/ })).toBeTruthy();
  });

  it('opens a selector beside the list, narrowing it, and keeps it in the address', async () => {
    renderPage();
    fireEvent.click(await screen.findByText(A));
    expect(await screen.findByRole('complementary', { name: 'Selector details' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Suggested fix' })).toBeNull();
    expect(screen.getByTestId('where').textContent).toContain(`selector=${encodeURIComponent(A)}`);
  });

  it('moves to the next selector with the down arrow, and closes with Escape', async () => {
    renderPage(`/selector-health?strategy=xpath&selector=${encodeURIComponent(A)}`);
    await screen.findByRole('complementary', { name: 'Selector details' });
    await screen.findAllByText(A);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(panelSpy).toHaveBeenLastCalledWith('xpath', B, 30, expect.any(Number)));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  });

  it('refreshes the list after an action, and keeps the panel open on the new status', async () => {
    vi.spyOn(XenonApiService, 'postSelectorStateAction').mockResolvedValue({ state: null });
    renderPage(`/selector-health?strategy=xpath&selector=${encodeURIComponent(A)}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Mute…' }));
    listSpy.mockResolvedValue({ ...LIST, total: 1, items: [item(B, 2)], counts: { ...LIST.counts, fix: 1, muted: 1 } });
    panelSpy.mockResolvedValue({
      status: 200,
      body: {
        ...detailFor(A),
        state: {
          status: 'muted',
          cleanBuilds: 0,
          fixedAt: null,
          fixedBy: null,
          resolvedAt: null,
          mutedAt: new Date().toISOString(),
          mutedBy: { id: 'u-1', name: 'Priya' },
          muteReason: null,
          brokeAgain: 0,
        },
      },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mute' }));

    const panel = await screen.findByRole('complementary', { name: 'Selector details' });
    await waitFor(() => expect(within(panel).getByText('Muted')).toBeTruthy());
    await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(2));
    expect(within(screen.getAllByRole('row')[1]).queryByText(A)).toBeNull();
  });

  it('opens an old detail link in the panel', async () => {
    renderPage(`/selector-health/detail?value=${encodeURIComponent(A)}&strategy=xpath`);
    expect(await screen.findByRole('complementary', { name: 'Selector details' })).toBeTruthy();
  });

  it('uses no technical words, list and panel', async () => {
    renderPage(`/selector-health?strategy=xpath&selector=${encodeURIComponent(A)}`);
    await screen.findByRole('complementary', { name: 'Selector details' });
    await screen.findAllByText(A);
    expect(document.body.textContent ?? '').not.toMatch(JARGON);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd web && npx vitest run src/components/selector-health/selector-health-page.test.tsx`
Expected: FAIL: `selector-detail-redirect` doesn't exist; the old page has no panel.

- [ ] **Step 3: The redirect**

`web/src/components/selector-health/selector-detail-redirect.tsx`:

```tsx
import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { legacyDetailTarget } from './view-state';

/** The retired detail page's address, sent on to the side panel (or a search). */
export const SelectorDetailRedirect: React.FC = () => {
  const [params] = useSearchParams();
  return <Navigate to={legacyDetailTarget(params)} replace />;
};

export default SelectorDetailRedirect;
```

In `web/src/routes/index.tsx`, change the `SelectorDetailPage` lazy import to load `../components/selector-health/selector-detail-redirect` (keep the constant's name or rename it `SelectorDetailRedirect` in both places).

- [ ] **Step 4: The page**

Replace `web/src/components/selector-health/selector-health-page.tsx` with:

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HeartPulse, Send } from 'lucide-react';
import XenonApiService from '../../api-service';
import { PageHeader } from '../ui/page-header';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';
import { useSocket } from '../../hooks/useSocket';
import { useAuth } from '../../auth/auth-context';
import { IHealingSummaryResponse, ISelectorListResponse } from '../../interfaces/IHealingEvent';
import { RegressionBanner } from './regression-banner';
import { SummaryStrip } from './summary-strip';
import { TrendChart } from './trend-chart';
import { SelectorList } from './selector-list';
import { SelectorPanel } from './selector-panel';
import { OpenSelector, PERIODS, PeriodDays, SelectorHealthView, readView, selectorKey, writeView } from './view-state';

/** Live events arrive in bursts (one per heal): ask again at most once a second. */
export const LIVE_REFRESH_MS = 1000;

const LIVE_EVENTS = [
  'healing_event',
  'selector_fixed',
  'selector_resolved',
  'selector_regressed',
  'selector_cancelled',
  'selector_muted',
  'selector_unmuted',
  'selector_progress',
];

const isTyping = (el: Element | null): boolean =>
  !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || (el as HTMLElement).isContentEditable);

const SelectorHealthPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => readView(params), [params]);
  const tz = useMemo(() => -new Date().getTimezoneOffset(), []);
  const { on } = useSocket();
  const { toast } = useToast();
  const { me } = useAuth();
  const isAdmin = !!me && (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN' || !!me.authDisabled);

  const [summary, setSummary] = useState<IHealingSummaryResponse | null>(null);
  const [list, setList] = useState<ISelectorListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sending, setSending] = useState(false);

  const setView = useCallback(
    (patch: Partial<SelectorHealthView>, replace = false) =>
      setParams(writeView({ ...readView(params), ...patch }), { replace }),
    [params, setParams],
  );

  useEffect(() => {
    let alive = true;
    XenonApiService.getHealingSummary(view.days, tz)
      .then((s: IHealingSummaryResponse) => {
        if (alive) setSummary(s ?? null);
      })
      .catch(() => {
        if (alive) setSummary(null);
      });
    return () => {
      alive = false;
    };
  }, [view.days, tz, refreshKey]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    XenonApiService.getHealingSelectors({
      tab: view.tab,
      days: view.days,
      q: view.q,
      platform: view.platform,
      method: view.method,
      sort: view.sort,
      page: view.page,
    })
      .then((r: ISelectorListResponse) => {
        if (alive) setList(r ?? null);
      })
      .catch(() => {
        if (alive) setList(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [view.tab, view.days, view.q, view.platform, view.method, view.sort, view.page, refreshKey]);

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bump = () => {
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        setRefreshKey((k) => k + 1);
      }, LIVE_REFRESH_MS);
    };
    const unsubs = LIVE_EVENTS.map((e) => on(e, bump));
    return () => {
      unsubs.forEach((u) => u && u());
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [on]);

  const open = useCallback((s: OpenSelector) => setView({ open: s }), [setView]);

  const close = useCallback(() => {
    const key = view.open ? selectorKey(view.open) : null;
    setView({ open: null });
    // Back to the row the panel was opened from.
    setTimeout(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-selector-row]'));
      rows.find((r) => r.dataset.key === key)?.focus();
    }, 0);
  }, [view.open, setView]);

  const move = useCallback(
    (dir: 1 | -1) => {
      const items = list?.items ?? [];
      if (items.length === 0) return;
      const at = view.open ? items.findIndex((it) => selectorKey(it) === selectorKey(view.open as OpenSelector)) : -1;
      const next = items[at < 0 ? 0 : Math.min(items.length - 1, Math.max(0, at + dir))];
      setView({ open: { strategy: next.strategy, selector: next.selector } }, true);
    },
    [list, view.open, setView],
  );

  useEffect(() => {
    if (!view.open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(document.activeElement) || document.querySelector('[role="dialog"]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.open, close, move]);

  const sendDigest = async () => {
    setSending(true);
    try {
      const r = (await XenonApiService.sendHealingDigest({ windowDays: view.days, limit: 5, minHealCount: 2 })) as {
        sent?: number;
      };
      const sent = r?.sent ?? 0;
      if (sent === 0) toast('No webhook gets the digest yet. Add one in Notifications.', 'error');
      else toast(`Digest sent to ${sent} webhook${sent === 1 ? '' : 's'}.`, 'success');
    } catch {
      toast("Couldn't send the digest. Try again.", 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader
        icon={HeartPulse}
        eyebrow="Test quality"
        title="Selector health"
        subtitle="Selectors your tests could only find with self-healing. Fix the ones that heal most."
        action={
          <div className="flex items-center gap-2">
            <SegmentedControl<string>
              size="sm"
              label="Period"
              value={String(view.days)}
              onChange={(v) => setView({ days: Number(v) as PeriodDays, page: 1 })}
              segments={PERIODS.map((d) => ({ value: String(d), label: `${d} days` }))}
            />
            {isAdmin && (
              <Button variant="secondary" size="sm" onClick={() => void sendDigest()} disabled={sending}>
                <Send size={14} /> Send digest
              </Button>
            )}
          </div>
        }
      />
      <div className="space-y-4 px-6 pb-8 pt-4">
        <RegressionBanner />
        <SummaryStrip summary={summary} days={view.days} />
        <TrendChart trend={summary ? (summary.trend ?? []) : null} days={view.days} />
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <SelectorList
              view={view}
              data={list}
              loading={loading}
              compact={!!view.open}
              selectedKey={view.open ? selectorKey(view.open) : null}
              onView={setView}
              onOpen={open}
            />
          </div>
          {view.open && (
            <SelectorPanel
              target={view.open}
              days={view.days}
              tz={tz}
              refreshKey={refreshKey}
              onClose={close}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default SelectorHealthPage;
```

- [ ] **Step 5: Remove what nothing uses**

```bash
git rm web/src/components/selector-health/selector-detail-page.tsx web/src/components/selector-health/pending-row.tsx web/src/components/selector-health/resolved-row.tsx web/src/components/selector-health/muted-list.tsx web/src/components/selector-health/tab-nav.tsx web/src/components/selector-health/selector-health.css
grep -rn "selector-health.css\|sh-[a-z]" web/src --include=*.tsx --include=*.ts --include=*.css | grep -v "\.test\." | head
grep -rn "getHealingHotspots\|getMutedSelectors\|getSelectorState\b\|getHealingSelectorDetail\|IHealingHotspot\|IMutedSelector\|IHealingSelectorDetail\|IHealingSelectorAlternate\|IHealingSelectorTimelineEntry\|ISelectorState\b" web/src | grep -v "api-service/index.ts\|interfaces/IHealingEvent.ts"
```

Expected: the first grep prints nothing (no `sh-` classes left). For every name the second grep doesn't print, delete its method from `web/src/api-service/index.ts` or its interface from `web/src/interfaces/IHealingEvent.ts`.

Remove the line `"src/components/selector-health/selector-health.css": 5,` from `web/src/design/color-literals.baseline.json` (mind the comma of the line before if it is the last entry).

- [ ] **Step 6: Run the web suite and types**

Run: `cd web && npx tsc --noEmit -p . && npx vitest run`
Expected: no type errors; every test passes (the colour ratchet included).

- [ ] **Step 7: Format, lint and commit**

Run: `cd .. && npx prettier --write web/src/components/selector-health/selector-health-page.tsx web/src/components/selector-health/selector-health-page.test.tsx web/src/components/selector-health/selector-detail-redirect.tsx && npx eslint web/src/components/selector-health web/src/routes/index.tsx web/src/api-service/index.ts web/src/interfaces/IHealingEvent.ts`
Expected: no findings in the new files; `routes/index.tsx`, `api-service/index.ts` and `IHealingEvent.ts` no more than on main.

```bash
git add web/src/components/selector-health web/src/routes/index.tsx web/src/api-service/index.ts web/src/interfaces/IHealingEvent.ts web/src/design/color-literals.baseline.json
git commit -m "feat(web): Selector Health as a list with a side panel; the detail page becomes a link to the panel"
```

---

### Task 13: Layout checks, docs, and a live look

**Files:**
- Modify: `web/test/viewport/overflow.spec.ts` (Selector Health mocks, routes, content checks)
- Modify: `web/test/sweep/controls.spec.ts` (only if the sweep needs an entry)
- Modify: `CLAUDE.md` (a Selector Health section, Key Files rows, the viewport coverage text)

**Interfaces:**
- Consumes: the page and endpoints from Tasks 1–12.

- [ ] **Step 1: Point the viewport spec at the new page**

In `web/test/viewport/overflow.spec.ts`:
- Replace the route `` `/xenon/selector-health/detail?value=${SELECTOR_DETAIL_VALUE}` `` in the route list, its `ROUTE_DATA_MOCKS` entry and its `ROUTE_CONTENT_CHECKS` entry with the panel route `` `/xenon/selector-health?strategy=-android%20uiautomator&selector=${encodeURIComponent(SH_LONG_SELECTOR)}` ``, and drop `SELECTOR_DETAIL_VALUE` if nothing else uses it.
- Replace the `'/xenon/selector-health'` mock with one function, used by both routes:

```ts
const SH_LONG_SELECTOR =
  'new UiSelector().resourceId("com.acme.enterprise.superapp:id/onboarding_carousel_primary_cta_button_container").childSelector(new UiSelector().className("android.widget.TextView"))';
const SH_LONG_FIX =
  "//android.widget.Button[@content-desc='Get Started Now — Continue To Account Setup Wizard Step One']";
const SH_SUMMARY = {
  windowDays: 30,
  current: { totalHeals: 140, distinctSelectors: 57, sessionsTouched: 48, byTier: { 'Visual AI': 90, LLM: 20, OCR: 30 }, timeSpentMs: 14 * 60_000 },
  prior: { totalHeals: 100, distinctSelectors: 40, sessionsTouched: 30, byTier: { LLM: 10 }, timeSpentMs: 9 * 60_000 },
  resolvedCount: 4,
  pendingCount: 2,
  trend: Array.from({ length: 31 }, (_, i) => ({ t: Date.UTC(2026, 8, 1) + i * 86_400_000, heals: (i * 7) % 11, aiHeals: i % 3 })),
};
const SH_LIST = {
  tab: 'fix',
  days: 30,
  page: 1,
  pageSize: 50,
  total: 2,
  counts: { fix: 2, verifying: 2, fixed: 4, muted: 1 },
  canAct: true,
  items: [
    {
      strategy: '-android uiautomator',
      selector: SH_LONG_SELECTOR,
      heals: 137,
      sessions: 48,
      lastHealedAt: '2026-07-16T09:42:11.000Z',
      timeSpentMs: 360_000,
      topMethod: 'Visual AI',
      suggestion: { selector: SH_LONG_FIX, strategy: 'xpath', share: 0.82 },
      state: { status: 'active', cleanBuilds: 0, fixedAt: null, fixedBy: null, resolvedAt: null, mutedAt: null, mutedBy: null, muteReason: null, brokeAgain: 2 },
    },
    {
      strategy: 'accessibility id',
      selector: 'login_screen_username_text_field_with_an_extremely_long_accessibility_identifier_that_stresses_the_selector_column',
      heals: 3,
      sessions: 2,
      lastHealedAt: '2026-07-15T23:59:00.000Z',
      timeSpentMs: 4000,
      topMethod: 'LLM',
      suggestion: { selector: 'username', strategy: 'accessibility id', share: 0.5 },
      state: null,
    },
  ],
};
const SH_DETAIL = {
  strategy: '-android uiautomator',
  selector: SH_LONG_SELECTOR,
  days: 30,
  heals: 137,
  sessions: 48,
  timeSpentMs: 360_000,
  firstHealedAt: '2026-06-20T10:15:00.000Z',
  lastHealedAt: '2026-07-16T09:42:11.000Z',
  daily: Array.from({ length: 31 }, (_, i) => ({ t: Date.UTC(2026, 8, 1) + i * 86_400_000, heals: (i * 5) % 9 })),
  suggestions: [
    { selector: SH_LONG_FIX, strategy: 'xpath', count: 112, share: 0.82, methods: ['Visual AI', 'OCR'], averageConfidence: 0.91 },
    { selector: 'confirm_order', strategy: 'accessibility id', count: 25, share: 0.18, methods: ['LLM'], averageConfidence: 0.71 },
  ],
  platforms: [{ name: 'android', count: 137 }],
  builds: [{ id: 'ci-nightly-regression-suite-2026-07-16-build-8842', name: 'ci-nightly-regression-suite-2026-07-16-build-8842', count: 90 }, { id: null, name: 'No build', count: 47 }],
  devices: [{ udid: 'emulator-5554-pixel7pro-android14-arm64-node03', name: 'Pixel 7 Pro (Android 14) — CI Farm Node 03 Slot A', count: 137 }],
  recent: [
    {
      id: 'log_01HZY9X8Q7K3M2N4P5R6S7T8U9',
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      buildId: 'ci-nightly-regression-suite-2026-07-16-build-8842',
      at: '2026-07-16T09:42:11.000Z',
      device: 'Pixel 7 Pro (Android 14) — CI Farm Node 03 Slot A',
      platform: 'android',
      method: 'Visual AI',
      confidence: 0.9137,
      healedSelector: SH_LONG_FIX,
    },
  ],
  state: SH_LIST.items[0].state,
  activity: [{ action: 'muted', at: '2026-07-01T10:00:00.000Z', by: { id: 'u', name: 'A very long display name for someone in the QA guild' }, reason: 'Onboarding carousel is being rebuilt for the 2026 brand refresh and this selector will change' }],
  canAct: true,
};
async function mockSelectorHealth(page: Page) {
  await page.route('**/xenon/api/healing/summary*', (route) => route.fulfill({ json: SH_SUMMARY }));
  await page.route(/\/xenon\/api\/healing\/selectors\?/, (route) => route.fulfill({ json: SH_LIST }));
  await page.route(/\/xenon\/api\/healing\/selectors\/detail\?/, (route) => route.fulfill({ json: SH_DETAIL }));
}
```

  and set both `ROUTE_DATA_MOCKS` keys to `mockSelectorHealth` (import `Page` from `@playwright/test` if the file doesn't already).
- Content checks: for `'/xenon/selector-health'`: `await expect(page.locator('section[aria-label="Selectors"] tbody tr')).not.toHaveCount(0);` and `await expect(page.getByRole('img', { name: 'Heals per day' })).toBeVisible();`. For the panel route, the same rows check plus `await expect(page.locator('aside[aria-label="Selector details"]')).toBeVisible();` and `await expect(page.locator('aside[aria-label="Selector details"] section[aria-label="Suggested fix"] li')).toHaveCount(2);`.

- [ ] **Step 2: Build this branch and start the scratch server on :4726**

```bash
cd web && npm run build && cd .. && rm -rf src/public/* && cp -R web/build/. src/public/
source ~/.nvm/nvm.sh && nvm use 22.19.0 && npx tsc -b && npm run build:copy
```

Start the scratch server the same way as for the session-performance check (scratchpad scripts; auth disabled, dashboard on, its own database migrated with this branch's migrations). Wait until `lsof -tiTCP:4726 -sTCP:LISTEN` answers.

- [ ] **Step 3: Run the viewport spec against it**

Run: `cd web && XENON_BASE_URL=http://127.0.0.1:4726 npx playwright test test/viewport/overflow.spec.ts` (use the variable the spec's config reads; check `web/playwright*.config.*` first).
Expected: every test passes, the two Selector Health routes on both sides of every breakpoint included.

- [ ] **Step 4: Run the control sweep on Selector Health**

Run: `cd web && XENON_BASE_URL=http://127.0.0.1:4726 npx playwright test test/sweep/controls.spec.ts -g "selector-health"` (same base-URL rule).
Expected: pass. A control that legitimately does nothing on a mocked page gets an `EXPECTED_NO_EFFECT` entry with its reason; anything else is a bug to fix in the page.

- [ ] **Step 5: A live look on real data**

On the scratch server, produce heals with a real session on the S9+ (create a session from the browser pane, then `findElement` with a selector whose element moved). If that cannot produce a heal within ten minutes, seed heal rows into the scratch database in the fixture's shape, and say so in the PR. Then, in the browser pane at 1280 and 1440 px, dark and light:
- the summary, trend and list show the heals;
- open a selector: the panel, its suggested fix and Copy as; Mark fixed (dialog), Mute with a reason, Unmute;
- the Muted tab shows the reason and the name; the Activity lists each action with the name;
- Esc and the arrows work; an old `/selector-health/detail?value=…&strategy=…` link opens the panel.

Take screenshots of the list and of the panel open, in both themes.

- [ ] **Step 6: Docs**

In `CLAUDE.md`, after the "6-Tier Self-Healing" section, add:

```markdown
### Selector Health (`src/services/selector-health/`, `web/src/components/selector-health/`)

The page that lists the selectors tests could only find with healing. A
list with a side panel; the view (tab, period, search, filters, sort, page,
open selector) lives in the address.

- **List** (`GET /healing/selectors`, `selectorList.ts`). "To fix" groups
  the period's heal rows by (strategy, selector) in the database
  (`groupBy`), so no heal is left uncounted (the old hotspot scan stopped at
  5,000 rows), and leaves out selectors being verified, fixed or muted. The
  other tabs start from `SelectorState` rows of that status, so a fixed
  selector that stopped healing stays listed. Counts follow the period, not
  the search or filters. Search compares text in JavaScript: `%` and `_`
  are plain text. A page past the end answers the last page.
- **Panel** (`GET /healing/selectors/detail`, `selectorDetail.ts`), always by
  strategy and value. A heal recorded with no strategy is strategy `''`
  everywhere (`tupleWhere` matches null and `''`).
- **Who sees what.** A selector is visible to a caller who can see at least
  one session where it healed, at any time (`access.ts`, by
  `visibleSessionWhere`); an admin or auth-disabled caller sees all. Hidden
  answers `404 { error: 'not_found', message: 'Selector not found' }`, as an
  unknown one. Status and activity stay one lab-wide row per selector.
- **Actions** (`POST /healing/selector/state`): members and admins, with the
  `sessions` scope, on visible selectors. Each status change writes a
  `SelectorEvent` (who, what, optional mute reason) in the same transaction
  (`SelectorStateService`, `SelectorVerificationJob`). The person is
  `resolveActor(req).userId`: a dashboard user has no API key, so the old
  `*_by_api_key` columns were empty for every dashboard action.
- **Summary** adds `timeSpentMs` (the healed commands' recorded durations)
  and `trend` (heals and AI heals per day, in the browser's `tz`).
- **No cost.** The fixed per-heal prices (`TIER_COST_USD`) priced an LLM heal
  the same on a local model as on a paid one, and charged for local OCR.
  `estCostUsd` is gone from every answer and the digest.
- **Wording** is for testers: no internal terms on screen
  (`selector-health-page.test.tsx` checks).
```

In the Key Files table, add rows:

```markdown
| `src/services/selector-health/selectorList.ts` | The Selector Health list: "To fix" by `groupBy` over the period's heals, the other tabs from `SelectorState`, search, sort, paging and the four counts |
| `src/services/selector-health/access.ts` | Who may see a selector (a visible session healed it) and who may act (`sessions` scope); `SELECTOR_NOT_FOUND` |
| `web/src/components/selector-health/selector-panel.tsx` | The side panel: status and actions, suggested fixes with Copy as, numbers, where it heals, recent heals, activity |
```

In the "Coverage boundary" paragraph under Breakpoints, replace `selector-health/detail` with `selector-health with its panel open`.

- [ ] **Step 7: The whole suites**

Run: `source ~/.nvm/nvm.sh && nvm use 22.19.0 && ANDROID_HOME=$HOME/Library/Android/sdk npm run test:all`
Expected: all passing (about 3011 + the new specs), 1 pending.

Run: `cd web && npx vitest run`
Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add web/test/viewport/overflow.spec.ts CLAUDE.md
git commit -m "test(web): the viewport spec covers Selector Health with its panel; docs for the redesign"
```

(Add `web/test/sweep/controls.spec.ts` to the commit only if Step 4 changed it.)

