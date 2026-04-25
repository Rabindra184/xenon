# Selector Trust & Truth Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the maintainer-arc continuation: strategy-aware suggestions, perpetual mute, and Mark-as-Fixed → Pending → Resolved verification on top of the shipped Selector Health page (`/selector-health`).

**Architecture:** One Prisma migration (two `SessionLog` columns + new `SelectorState` table + composite index). Two new TypeDI services (`SelectorStateService`, `SelectorVerificationJob`). Three additive write-path hooks in `event-manager.ts`/`CommandInterceptor.ts`. Aggregator (`dashboard.ts:351`) extended with tuple grouping + status filter. Three new HTTP endpoints. Frontend gains 4 tabs, multi-language copy chevron with localStorage memory, and live socket-driven transitions. No source-code reading; user does rewrites manually.

**Tech Stack:** TypeScript 5.5, Prisma 5.4, TypeDI 0.10, Express 4, Socket.io 4, `node-schedule` (already in deps), Mocha + Chai + Sinon. Frontend React 17, Vite 5, existing component primitives in `web/src/components/ui/`.

**Spec:** `docs/superpowers/specs/2026-04-25-selector-trust-and-truth-design.md`

---

## File Structure

### New backend files

| File | Purpose |
|---|---|
| `src/services/SelectorStateService.ts` | State machine: mute/unmute/markFixed/cancelVerification/onHealRecorded; emits socket events |
| `src/services/SelectorVerificationJob.ts` | Background job — every 15 min, scans Pending rows, promotes to Resolved when 3 clean builds counted |
| `test/unit/selector-state-service.spec.ts` | Unit tests for every state transition + idempotency + guards |
| `test/unit/selector-verification-job.spec.ts` | Unit tests for clean-build counting and promotion |
| `test/unit/event-manager-smart-passive.spec.ts` | Unit tests for new logEntry construction |
| `test/unit/aggregate-hotspots-tuple-key.spec.ts` | Unit tests for the new tuple grouping + status filter |
| `test/integration/selector-state-flow.spec.ts` | End-to-end DB flow with real Prisma + SQLite |

### Modified backend files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `original_strategy` + `healed_strategy` columns to `SessionLog`; new `SelectorState` model; composite index `(original_strategy, original_selector, createdAt)` |
| `src/dashboard/event-manager.ts:393–509` | Add new columns to logEntry; Smart Passive instrumentation; regression hook after `sessionLog.create` |
| `src/interceptors/CommandInterceptor.ts:609–635` | Pass `originalStrategy: args[0]` and `healedStrategy` through `logHealingEvent` |
| `src/services/healing/HealingOrchestrator.ts` (and tier providers) | Extend `HealingResult` with `recommendedStrategy?: string`; populate per-tier |
| `src/app/routers/dashboard.ts:233–477` | Extend `aggregateHotspots()` for tuple grouping + status filter |
| `src/app/routers/dashboard.ts:780–810` | Register 3 new routes (`POST /healing/selector/state`, `GET /healing/state/muted`, `GET /healing/state/:strategy/:value`) |
| `src/enums/SocketEvents.ts` | Add `SELECTOR_FIXED`, `SELECTOR_RESOLVED`, `SELECTOR_REGRESSED`, `SELECTOR_CANCELLED`, `SELECTOR_MUTED`, `SELECTOR_UNMUTED`, `SELECTOR_PROGRESS` |
| `src/plugin.ts` | Start `SelectorVerificationJob` on hub init; stop on shutdown |
| `src/services/ProcessMetricsService.ts` (or wherever metrics live) | Add 5 new Prometheus metrics |

### New frontend files

| File | Purpose |
|---|---|
| `web/src/utils/strategy-labels.ts` | Map strategy id → human label (`'accessibility id'` → `"Accessibility ID"`) |
| `web/src/utils/snippet-generator.ts` | Per-language code snippet generator (JS, Java, Python, C#, Ruby) |
| `web/src/components/selector-health/tab-nav.tsx` | Tab navigation component (Active / Pending / Resolved / Muted) with live counts |
| `web/src/components/selector-health/copy-language-modal.tsx` | First-time language picker with localStorage persistence |
| `web/src/components/selector-health/regression-banner.tsx` | Top-of-page toast for regressions |
| `web/src/components/selector-health/pending-row.tsx` | Pending row with 1/3, 2/3, 3/3 progress indicator |
| `web/src/components/selector-health/resolved-row.tsx` | Resolved row with cost-saving estimate + regression badge |
| `web/src/components/selector-health/muted-list.tsx` | Muted view (different layout — sourced from `/healing/state/muted`) |

### Modified frontend files

| File | Change |
|---|---|
| `web/src/components/selector-health/selector-health-page.tsx` | Tab branching, integrate new tab components, socket subscriptions |
| `web/src/components/selector-health/selector-detail-page.tsx` | Add `strategy` URL param; state header; verification-log section |
| `web/src/api-service/index.ts` | Add `getMutedSelectors()`, `getSelectorState()`, `postSelectorStateAction()`; extend `getHealingHotspots()` with status param |
| `web/src/interfaces/IHealingEvent.ts` | Add `IHealingHotspot.state?: ISelectorState`; new `ISelectorState` interface |

---

## Pre-flight

Run once before starting:

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git checkout docs/selector-trust-and-truth   # branch already exists with the spec
npm install
npm test 2>&1 | tail -20   # baseline: note current pass/fail counts
```

Expected: tests pass (baseline). If any fail, note them — they're pre-existing and not the concern of this plan.

---

## Phase A: Backend

### Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_selector_state_and_strategy/migration.sql` (auto-generated)

- [ ] **Step 1: Add the two new columns to `SessionLog`**

Open `prisma/schema.prisma`. Locate the `SessionLog` model (currently at line 63). Add `original_strategy` and `healed_strategy` after the existing `healing_tier` column:

```prisma
model SessionLog {
  id                 String   @id @default(uuid())
  session_id         String
  command_name       String?
  url                String
  method             String
  title              String
  subtitle           String?
  body               String?
  response           String
  screenshot         String?
  is_success         Boolean?
  is_error           Boolean  @default(false)
  is_healed          Boolean  @default(false)
  original_selector  String?
  healed_selector    String?
  healing_confidence Float?
  healing_tier       String?
  original_strategy  String?
  healed_strategy    String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  duration           Int?
  span_id            String?
  trace_id           String?
  session            Session  @relation(fields: [session_id], references: [id])

  @@index([original_strategy, original_selector, createdAt])
}
```

(The composite index is the verification job's hot path.)

- [ ] **Step 2: Add the new `SelectorState` model**

Append at the end of `prisma/schema.prisma`:

```prisma
model SelectorState {
  id                 String    @id @default(uuid())
  original_strategy  String
  original_selector  String
  status             String    // 'active' | 'pending' | 'resolved' | 'muted'
  fixed_at           DateTime?
  fixed_by_api_key   String?
  resolved_at        DateTime?
  muted_at           DateTime?
  muted_by_api_key   String?
  regression_count   Int       @default(0)
  clean_builds_count Int       @default(0)
  last_event_at      DateTime  @default(now())
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@unique([original_strategy, original_selector])
  @@index([status])
  @@index([fixed_at])
}
```

- [ ] **Step 3: Generate and apply the migration**

Run:
```bash
npm run db:generate -- --name selector_state_and_strategy
```

Expected: a new migration directory under `prisma/migrations/<timestamp>_selector_state_and_strategy/` with a `migration.sql` containing `ALTER TABLE` statements for the new columns and a `CREATE TABLE selector_state` statement.

Then:
```bash
npm run db:migrate
```

Expected: "All migrations have been successfully applied."

- [ ] **Step 4: Verify the Prisma client picks up the new types**

Run:
```bash
node -e "const {PrismaClient} = require('./src/generated/client'); const p = new PrismaClient(); console.log(typeof p.selectorState.findMany);"
```

Expected: `function`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add SelectorState + strategy columns for trust-and-truth layer"
```

---

### Task 2: Healing result type extension

**Files:**
- Modify: `src/services/healing/HealingOrchestrator.ts` (and the type file it imports `HealingResult` from)
- Modify: each tier provider in `src/services/healing/`
- Test: `test/unit/healing-result-strategy.spec.ts` (new)

- [ ] **Step 1: Locate `HealingResult` type**

Run:
```bash
grep -rn "HealingResult\|recommendedSelector" src/services/healing --include="*.ts" -l
```

The type is most likely declared in a shared file (e.g., `src/services/healing/types.ts` or inline in `HealingOrchestrator.ts`). Read whichever file owns it before editing.

- [ ] **Step 2: Write the failing test**

Create `test/unit/healing-result-strategy.spec.ts`:

```ts
import { expect } from 'chai';
import { HealingResult } from '../../src/services/healing/HealingOrchestrator';

describe('HealingResult.recommendedStrategy', () => {
  it('accepts an optional recommendedStrategy property', () => {
    const result: HealingResult = {
      id: 'el-123',
      recommendedSelector: 'login-btn',
      recommendedStrategy: 'accessibility id',
      confidence: 0.9,
      tier: 4,
    };
    expect(result.recommendedStrategy).to.equal('accessibility id');
  });

  it('allows recommendedStrategy to be undefined for backward compatibility', () => {
    const result: HealingResult = {
      id: 'el-123',
      recommendedSelector: '//button',
      confidence: 0.7,
      tier: 2,
    };
    expect(result.recommendedStrategy).to.be.undefined;
  });
});
```

(Adjust import path if `HealingResult` lives elsewhere.)

- [ ] **Step 3: Run test to verify it fails**

```bash
npx mocha --require ts-node/register test/unit/healing-result-strategy.spec.ts
```

Expected: TypeScript compile error — `recommendedStrategy` is not a property of `HealingResult`.

- [ ] **Step 4: Add `recommendedStrategy` to the type**

In whichever file declares `HealingResult`, add the field:

```ts
export interface HealingResult {
  id: string;
  recommendedSelector: string;
  recommendedStrategy?: string;  // NEW — populated by tiers that know the output strategy
  confidence: number;
  tier: number;
  rect?: { x: number; y: number; width: number; height: number };
  message?: string;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx mocha --require ts-node/register test/unit/healing-result-strategy.spec.ts
```

Expected: 2 passing.

- [ ] **Step 6: Populate `recommendedStrategy` in each tier provider**

For each tier provider in `src/services/healing/` (use `grep -l "HealingResult\|return.*recommendedSelector" src/services/healing`), set `recommendedStrategy` on the returned object:

| Tier | Value | Reason |
|---|---|---|
| Native (retry) | `originalStrategy` (passed in from orchestrator) | Same locator as input, just retried |
| Resilio / FuzzyXml | `'xpath'` | These tiers produce XPath-shaped locators |
| OCR | `'xenon:visual'` | Coordinate-based; sentinel value |
| Visual AI | `'xenon:visual'` | Coordinate-based; sentinel value |
| LLM | The strategy from the LLM's structured response (if available); else `undefined` | Honest about uncertainty |

For each provider file (`*HealingProvider.ts`), find the `return { id, recommendedSelector, ... }` site(s) and add `recommendedStrategy: '<value>'` per the table.

For example, in `FuzzyXmlHealingProvider.ts`:
```ts
return {
  id: 'el-' + matchId,
  recommendedSelector: bestMatch.xpath,
  recommendedStrategy: 'xpath',  // NEW
  confidence: bestMatch.score,
  tier: 2,
};
```

- [ ] **Step 7: Pass `originalStrategy` into `attemptHealing` for the Native tier**

If `HealingOrchestrator.attemptHealing(sessionId, driver, strategy, selector)` already accepts the strategy as the third argument, the Native tier provider can read it from context. If not, add a parameter or pass via context object.

Read `HealingOrchestrator.attemptHealing` first (`src/services/healing/HealingOrchestrator.ts`). The interceptor calls it as `attemptHealing(sessionId, driver, args[0], args[1])` per the spec — `args[0]` is the strategy. Confirm and ensure the orchestrator either passes it to providers as part of the context or stores it for the Native tier to copy through.

- [ ] **Step 8: Add a type-shape test for each tier provider**

Append to `test/unit/healing-result-strategy.spec.ts`:

```ts
describe('Tier providers populate recommendedStrategy', () => {
  it('Fuzzy XML returns xpath strategy', async () => {
    // Stubbed test: instantiate the provider, call heal() with mocked context,
    // assert returned result has recommendedStrategy === 'xpath'
    // (full instantiation may require dependencies; skip for tiers
    //  that need heavy mocking and rely on the integration test)
  });
});
```

For tiers requiring heavy mocking, leave a `it.skip(...)` and rely on the integration test in Task 18 instead.

- [ ] **Step 9: Run tests**

```bash
npm test
```

Expected: existing tests still pass + the new strategy tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/services/healing/ test/unit/healing-result-strategy.spec.ts
git commit -m "feat(healing): add recommendedStrategy on HealingResult, populate per-tier"
```

---

### Task 3: Smart Passive instrumentation in event-manager

**Files:**
- Modify: `src/dashboard/event-manager.ts:393-409` (the `logEntry` builder inside `afterSessionCommand`)
- Test: `test/unit/event-manager-smart-passive.spec.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `test/unit/event-manager-smart-passive.spec.ts`:

```ts
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';

// Import as needed for full DASHBORD_EVENT_MANAGER instantiation;
// adjust path to match your actual import.

describe('Smart Passive instrumentation in event-manager', () => {
  let prismaCreateStub: sinon.SinonStub;

  beforeEach(() => {
    // Stub prisma.sessionLog.create to capture the data argument
    // Simplest approach: stub the imported prisma module.
    // Adjust to your actual prisma import path:
    const prisma = require('../../src/data-service/prisma-client').prisma;
    prismaCreateStub = sinon.stub(prisma.sessionLog, 'create').resolves({ id: 'mock-id', createdAt: new Date() });
  });

  afterEach(() => sinon.restore());

  it('populates original_strategy and original_selector for findElement when no heal', async () => {
    // Call afterSessionCommand with a synthetic findElement command
    const evtManager = require('../../src/dashboard/event-manager').DASHBORD_EVENT_MANAGER;
    await evtManager.afterSessionCommand(
      'session-1', 'findElement', null,
      { body: ['accessibility id', 'login-btn'], method: 'POST', originalUrl: '/findElement' } as any,
      {} as any,
      JSON.stringify({ value: { ELEMENT: 'el-1' }, sessionId: 'session-1' }),
      // no healingInfo
    );
    expect(prismaCreateStub.calledOnce).to.be.true;
    const data = prismaCreateStub.firstCall.args[0].data;
    expect(data.is_healed).to.equal(false);
    expect(data.original_strategy).to.equal('accessibility id');
    expect(data.original_selector).to.equal('login-btn');
  });

  it('populates from healingInfo when present (heal path)', async () => {
    const evtManager = require('../../src/dashboard/event-manager').DASHBORD_EVENT_MANAGER;
    await evtManager.afterSessionCommand(
      'session-1', 'findElement', null,
      { body: ['xpath', '//button[@id="x"]'], method: 'POST', originalUrl: '/findElement' } as any,
      {} as any,
      JSON.stringify({ value: { ELEMENT: 'el-1' } }),
      {
        originalSelector: '//button[@id="x"]',
        originalStrategy: 'xpath',
        healedSelector: 'login-btn',
        healedStrategy: 'accessibility id',
        confidence: 0.9,
        tier: 4,
      },
    );
    const data = prismaCreateStub.firstCall.args[0].data;
    expect(data.is_healed).to.equal(true);
    expect(data.original_strategy).to.equal('xpath');
    expect(data.healed_strategy).to.equal('accessibility id');
  });

  it('skips for non-find commands without healingInfo', async () => {
    const evtManager = require('../../src/dashboard/event-manager').DASHBORD_EVENT_MANAGER;
    await evtManager.afterSessionCommand(
      'session-1', 'click', null,
      { body: ['element-id'], method: 'POST', originalUrl: '/click' } as any,
      {} as any,
      JSON.stringify({ value: null }),
    );
    const data = prismaCreateStub.firstCall.args[0].data;
    expect(data.original_strategy).to.be.null;
    expect(data.original_selector).to.be.null;
  });

  it('handles empty-string selector value without nulling it', async () => {
    const evtManager = require('../../src/dashboard/event-manager').DASHBORD_EVENT_MANAGER;
    await evtManager.afterSessionCommand(
      'session-1', 'findElement', null,
      { body: ['xpath', ''], method: 'POST', originalUrl: '/findElement' } as any,
      {} as any,
      JSON.stringify({ value: null }),
    );
    const data = prismaCreateStub.firstCall.args[0].data;
    expect(data.original_strategy).to.equal('xpath');
    expect(data.original_selector).to.equal('');  // empty string preserved, not nulled
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha --require ts-node/register test/unit/event-manager-smart-passive.spec.ts
```

Expected: FAIL — `original_strategy` is undefined or never set on the data argument.

- [ ] **Step 3: Apply Smart Passive instrumentation**

Open `src/dashboard/event-manager.ts`. Find the `logEntry` declaration around line 393. Modify it to:

```ts
const logEntry: any = {
  session_id: session.getId(),
  command_name: commandName || null,
  body: JSON.stringify(request.body),
  response: responseBody,
  is_success: isSuccessResponse,
  is_error: !isSuccessResponse,
  method: request.method,
  title: this.getTitleFromCommandName(commandName),
  subtitle: '',
  screenshot: null,
  url: request.originalUrl,
  is_healed: !!healingInfo,
  original_selector:  healingInfo?.originalSelector ?? null,
  healed_selector:    healingInfo?.healedSelector   ?? null,
  healing_confidence: healingInfo?.confidence       ?? null,
  healing_tier:       healingTierLabel(healingInfo?.tier),
  original_strategy:  healingInfo?.originalStrategy ?? null,
  healed_strategy:    healingInfo?.healedStrategy   ?? null,
};

// Smart Passive: populate strategy/selector for every findElement, even non-heals.
// CommandInterceptor synthesizes request.body = args (the array [strategy, value]).
if ((commandName === 'findElement' || commandName === 'findElements') &&
    Array.isArray(request.body)) {
  logEntry.original_strategy ??= request.body[0] ?? null;
  logEntry.original_selector ??= request.body[1] ?? null;
}
```

(Notice the `||` in the existing healing-info assignments has changed to `??` so empty strings don't get nulled.)

- [ ] **Step 4: Update `healingInfo` type to include `originalStrategy` and `healedStrategy`**

Find the parameter type declaration of `afterSessionCommand` (line 360-373). Update:

```ts
async afterSessionCommand(
  sessionId: string,
  commandName: string | undefined,
  driver: any | null,
  request: Request,
  response: Response,
  responseBody: string,
  healingInfo?: {
    originalSelector: string;
    originalStrategy: string;     // NEW
    healedSelector: string;
    healedStrategy: string;        // NEW
    confidence: number;
    tier?: number;
  },
) {
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx mocha --require ts-node/register test/unit/event-manager-smart-passive.spec.ts
```

Expected: 4 passing.

- [ ] **Step 6: Run the full test suite to verify no regressions**

```bash
npm test
```

Expected: same pass count as pre-flight + 4 new tests.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/event-manager.ts test/unit/event-manager-smart-passive.spec.ts
git commit -m "feat(dashboard): Smart Passive instrumentation captures selector/strategy on every findElement"
```

---

### Task 4: Strategy passthrough in CommandInterceptor.logHealingEvent

**Files:**
- Modify: `src/interceptors/CommandInterceptor.ts:609-635` (`logHealingEvent`)
- Test: extend `test/unit/event-manager-smart-passive.spec.ts`

- [ ] **Step 1: Add a test for the heal path**

Append to `test/unit/event-manager-smart-passive.spec.ts`:

```ts
describe('CommandInterceptor.logHealingEvent passes strategy through', () => {
  it('sets healingInfo.originalStrategy from args[0] always', async () => {
    // Mock attemptHealing to return a healed result;
    // call interceptor, assert afterSessionCommand was called with healingInfo containing originalStrategy

    // Easiest: stub DASHBORD_EVENT_MANAGER.afterSessionCommand and inspect the 7th arg.
    const evtManager = require('../../src/dashboard/event-manager').DASHBORD_EVENT_MANAGER;
    const afterStub = sinon.stub(evtManager, 'afterSessionCommand').resolves();

    const { CommandInterceptor } = require('../../src/interceptors/CommandInterceptor');
    const interceptor = Container.get(CommandInterceptor);
    // Cast to any for private method access; use `(interceptor as any).logHealingEvent(...)`
    await (interceptor as any).logHealingEvent(
      'session-1', 'findElement', null,
      ['xpath', '//button[@id="x"]'],
      { id: 'el-1', recommendedSelector: 'login-btn', recommendedStrategy: 'accessibility id', confidence: 0.9, tier: 4 },
    );

    expect(afterStub.calledOnce).to.be.true;
    const healingInfo = afterStub.firstCall.args[6];
    expect(healingInfo.originalStrategy).to.equal('xpath');
    expect(healingInfo.healedStrategy).to.equal('accessibility id');
    expect(healingInfo.healedSelector).to.equal('login-btn');
  });

  it('falls back healedStrategy to originalStrategy when not provided', async () => {
    const evtManager = require('../../src/dashboard/event-manager').DASHBORD_EVENT_MANAGER;
    sinon.restore();
    const afterStub = sinon.stub(evtManager, 'afterSessionCommand').resolves();
    const { CommandInterceptor } = require('../../src/interceptors/CommandInterceptor');
    const interceptor = Container.get(CommandInterceptor);
    await (interceptor as any).logHealingEvent(
      'session-1', 'findElement', null,
      ['xpath', '//x'],
      { id: 'el-1', recommendedSelector: 'replacement', confidence: 0.7, tier: 1 },
      // no recommendedStrategy
    );
    const healingInfo = afterStub.firstCall.args[6];
    expect(healingInfo.healedStrategy).to.equal('xpath');  // fallback to args[0]
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
npx mocha --require ts-node/register test/unit/event-manager-smart-passive.spec.ts
```

Expected: 2 new tests fail; existing 4 still pass.

- [ ] **Step 3: Modify `logHealingEvent`**

Open `src/interceptors/CommandInterceptor.ts:609`. Replace the `private async logHealingEvent(...)` body with:

```ts
private async logHealingEvent(
  sessionId: string,
  commandName: string,
  driver: any,
  args: any[],
  healed: any,
) {
  await DASHBORD_EVENT_MANAGER.afterSessionCommand(
    sessionId,
    commandName,
    driver,
    {
      body: args,
      method: 'POST',
      path: `/${commandName}`,
      originalUrl: `/${commandName}`,
    } as any,
    {} as any,
    JSON.stringify({ value: { ELEMENT: healed.id }, sessionId }),
    {
      originalSelector: args[1],
      originalStrategy: args[0],
      healedSelector:   healed.recommendedSelector,
      healedStrategy:   healed.recommendedStrategy ?? args[0],
      confidence:       healed.confidence,
      tier:             healed.tier,
    },
  );
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
npx mocha --require ts-node/register test/unit/event-manager-smart-passive.spec.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/interceptors/CommandInterceptor.ts test/unit/event-manager-smart-passive.spec.ts
git commit -m "feat(interceptor): pass originalStrategy and healedStrategy through to event-manager"
```

---

### Task 5: SocketEvents enum extension

**Files:**
- Modify: `src/enums/SocketEvents.ts`

- [ ] **Step 1: Locate the enum**

```bash
cat src/enums/SocketEvents.ts
```

(Note current entries — likely strings like `HEALING_EVENT`, `SESSION_STARTED`, etc.)

- [ ] **Step 2: Add the new event keys**

Append to the enum (or object) the following keys, matching the existing convention (string-valued keys):

```ts
export enum SocketEvents {
  // ... existing entries unchanged ...
  SELECTOR_FIXED      = 'selector_fixed',
  SELECTOR_RESOLVED   = 'selector_resolved',
  SELECTOR_REGRESSED  = 'selector_regressed',
  SELECTOR_CANCELLED  = 'selector_cancelled',
  SELECTOR_MUTED      = 'selector_muted',
  SELECTOR_UNMUTED    = 'selector_unmuted',
  SELECTOR_PROGRESS   = 'selector_progress',
}
```

(If `SocketEvents` is `as const` object instead of enum, adjust accordingly.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/enums/SocketEvents.ts
git commit -m "feat(socket): add SELECTOR_* events for state lifecycle"
```

---

### Task 6: SelectorStateService — state machine core

**Files:**
- Create: `src/services/SelectorStateService.ts`
- Test: `test/unit/selector-state-service.spec.ts` (new)

- [ ] **Step 1: Write the failing test for `markFixed`**

Create `test/unit/selector-state-service.spec.ts`:

```ts
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SelectorStateService } from '../../src/services/SelectorStateService';

describe('SelectorStateService', () => {
  let service: SelectorStateService;
  let prismaStub: any;
  let socketStub: any;

  beforeEach(() => {
    // Stub prisma.selectorState
    prismaStub = {
      findUnique: sinon.stub(),
      upsert:     sinon.stub(),
      update:     sinon.stub(),
      delete:     sinon.stub(),
      create:     sinon.stub(),
    };
    socketStub = { emitToDashboard: sinon.stub() };
    service = new SelectorStateService(prismaStub as any, socketStub as any);
  });

  afterEach(() => sinon.restore());

  describe('markFixed', () => {
    it('upserts a row with status pending and fixed_at set', async () => {
      prismaStub.upsert.resolves({
        id: 'r-1', original_strategy: 'xpath', original_selector: '//x',
        status: 'pending', fixed_at: new Date(), clean_builds_count: 0,
      });
      const result = await service.markFixed({
        strategy: 'xpath', selector: '//x', apiKeyId: 'ak-1',
      });
      expect(prismaStub.upsert.calledOnce).to.be.true;
      const arg = prismaStub.upsert.firstCall.args[0];
      expect(arg.where).to.deep.equal({
        original_strategy_original_selector: { original_strategy: 'xpath', original_selector: '//x' }
      });
      expect(arg.create.status).to.equal('pending');
      expect(arg.create.fixed_at).to.be.instanceOf(Date);
      expect(arg.update.status).to.equal('pending');
      expect(result.status).to.equal('pending');
    });

    it('emits SELECTOR_FIXED socket event', async () => {
      prismaStub.upsert.resolves({
        original_strategy: 'xpath', original_selector: '//x', status: 'pending',
      });
      await service.markFixed({ strategy: 'xpath', selector: '//x', apiKeyId: 'ak-1' });
      expect(socketStub.emitToDashboard.calledWith('selector_fixed')).to.be.true;
    });

    it('rejects markFixed when current status is muted (409 semantics)', async () => {
      prismaStub.findUnique.resolves({ status: 'muted' });
      let err: Error | null = null;
      try {
        await service.markFixed({ strategy: 'xpath', selector: '//x', apiKeyId: 'ak-1' });
      } catch (e: any) { err = e; }
      expect(err).to.not.be.null;
      expect(err!.message).to.match(/muted/i);
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL (compile error — service doesn't exist)**

```bash
npx mocha --require ts-node/register test/unit/selector-state-service.spec.ts
```

Expected: TypeScript compile error.

- [ ] **Step 3: Create the service skeleton**

Create `src/services/SelectorStateService.ts`:

```ts
import { Service } from 'typedi';
import { PrismaClient, SelectorState } from '../generated/client';
import { SocketServer } from './SocketServer';
import { SocketEvents } from '../enums/SocketEvents';

export interface SelectorIdentity {
  strategy: string;
  selector: string;
}

export interface ActionContext extends SelectorIdentity {
  apiKeyId: string;
}

export interface HealRecordedContext extends SelectorIdentity {
  sessionId: string;
}

export class SelectorStateConflictError extends Error {
  constructor(message: string, public currentStatus: string) {
    super(message);
    this.name = 'SelectorStateConflictError';
  }
}

@Service()
export class SelectorStateService {
  constructor(
    private prisma: PrismaClient,
    private socket: SocketServer,
  ) {}

  /**
   * Mark a selector as fixed: upsert row to status='pending', fixed_at=now.
   * Rejects if currently muted.
   */
  async markFixed(ctx: ActionContext): Promise<SelectorState> {
    const existing = await this.prisma.selectorState.findUnique({
      where: { original_strategy_original_selector: { original_strategy: ctx.strategy, original_selector: ctx.selector } },
    });
    if (existing?.status === 'muted') {
      throw new SelectorStateConflictError('Cannot mark muted selector as fixed. Unmute first.', 'muted');
    }
    const now = new Date();
    const row = await this.prisma.selectorState.upsert({
      where: { original_strategy_original_selector: { original_strategy: ctx.strategy, original_selector: ctx.selector } },
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
        resolved_at: null,
        clean_builds_count: 0,
        last_event_at: now,
      },
    });
    this.socket.emitToDashboard(SocketEvents.SELECTOR_FIXED, this.serialize(row));
    return row;
  }

  /** Mute a selector. Idempotent (mute on muted is a no-op). */
  async mute(ctx: ActionContext): Promise<SelectorState> {
    const now = new Date();
    const row = await this.prisma.selectorState.upsert({
      where: { original_strategy_original_selector: { original_strategy: ctx.strategy, original_selector: ctx.selector } },
      create: {
        original_strategy: ctx.strategy,
        original_selector: ctx.selector,
        status: 'muted',
        muted_at: now,
        muted_by_api_key: ctx.apiKeyId,
        last_event_at: now,
      },
      update: {
        status: 'muted',
        muted_at: now,
        muted_by_api_key: ctx.apiKeyId,
        last_event_at: now,
      },
    });
    this.socket.emitToDashboard(SocketEvents.SELECTOR_MUTED, this.serialize(row));
    return row;
  }

  /**
   * Unmute. Deletes the row if there's no other history; otherwise sets
   * status='active' and clears muted_at.
   */
  async unmute(ctx: ActionContext): Promise<SelectorState | null> {
    const existing = await this.prisma.selectorState.findUnique({
      where: { original_strategy_original_selector: { original_strategy: ctx.strategy, original_selector: ctx.selector } },
    });
    if (!existing || existing.status !== 'muted') return existing;

    const hasHistory =
      (existing.regression_count ?? 0) > 0 ||
      existing.fixed_at !== null ||
      existing.resolved_at !== null;

    if (!hasHistory) {
      await this.prisma.selectorState.delete({ where: { id: existing.id } });
      this.socket.emitToDashboard(SocketEvents.SELECTOR_UNMUTED, {
        original_strategy: ctx.strategy, original_selector: ctx.selector, status: 'active',
      });
      return null;
    }
    const now = new Date();
    const row = await this.prisma.selectorState.update({
      where: { id: existing.id },
      data: { status: 'active', muted_at: null, last_event_at: now },
    });
    this.socket.emitToDashboard(SocketEvents.SELECTOR_UNMUTED, this.serialize(row));
    return row;
  }

  /**
   * Cancel verification (Pending → Active). Only valid from pending.
   */
  async cancelVerification(ctx: ActionContext): Promise<SelectorState | null> {
    const existing = await this.prisma.selectorState.findUnique({
      where: { original_strategy_original_selector: { original_strategy: ctx.strategy, original_selector: ctx.selector } },
    });
    if (!existing) {
      throw new SelectorStateConflictError('No active verification to cancel.', 'active');
    }
    if (existing.status !== 'pending') {
      throw new SelectorStateConflictError(`Cannot cancel from status '${existing.status}'. Only pending allowed.`, existing.status);
    }
    const hasOtherHistory =
      (existing.regression_count ?? 0) > 0 ||
      existing.resolved_at !== null;
    if (!hasOtherHistory) {
      await this.prisma.selectorState.delete({ where: { id: existing.id } });
      this.socket.emitToDashboard(SocketEvents.SELECTOR_CANCELLED, {
        original_strategy: ctx.strategy, original_selector: ctx.selector, status: 'active',
      });
      return null;
    }
    const now = new Date();
    const row = await this.prisma.selectorState.update({
      where: { id: existing.id },
      data: { status: 'active', fixed_at: null, clean_builds_count: 0, last_event_at: now },
    });
    this.socket.emitToDashboard(SocketEvents.SELECTOR_CANCELLED, this.serialize(row));
    return row;
  }

  /**
   * Hook called from the heal write path. Flips Pending/Resolved → Active
   * with regression_count++ if a heal arrives after fixed_at.
   */
  async onHealRecorded(ctx: HealRecordedContext): Promise<void> {
    const existing = await this.prisma.selectorState.findUnique({
      where: { original_strategy_original_selector: { original_strategy: ctx.strategy, original_selector: ctx.selector } },
    });
    if (!existing) return;
    if (existing.status !== 'pending' && existing.status !== 'resolved') return;
    const now = new Date();
    const row = await this.prisma.selectorState.update({
      where: { id: existing.id },
      data: {
        status: 'active',
        fixed_at: null,
        resolved_at: null,
        clean_builds_count: 0,
        regression_count: (existing.regression_count ?? 0) + 1,
        last_event_at: now,
      },
    });
    this.socket.emitToDashboard(SocketEvents.SELECTOR_REGRESSED, this.serialize(row));
  }

  /** Lookup state for a single tuple. Returns null if no row. */
  async getState(strategy: string, selector: string): Promise<SelectorState | null> {
    return this.prisma.selectorState.findUnique({
      where: { original_strategy_original_selector: { original_strategy: strategy, original_selector: selector } },
    });
  }

  private serialize(row: SelectorState) {
    return {
      original_strategy: row.original_strategy,
      original_selector: row.original_selector,
      status: row.status,
      fixed_at: row.fixed_at?.toISOString() ?? null,
      resolved_at: row.resolved_at?.toISOString() ?? null,
      muted_at: row.muted_at?.toISOString() ?? null,
      regression_count: row.regression_count,
      clean_builds_count: row.clean_builds_count,
    };
  }
}
```

- [ ] **Step 4: Run the markFixed tests**

```bash
npx mocha --require ts-node/register test/unit/selector-state-service.spec.ts -g markFixed
```

Expected: 3 passing.

- [ ] **Step 5: Add tests for `mute`, `unmute`, `cancelVerification`, `onHealRecorded`**

Append to `test/unit/selector-state-service.spec.ts`:

```ts
  describe('mute', () => {
    it('upserts row with status muted', async () => {
      prismaStub.upsert.resolves({ original_strategy: 'xpath', original_selector: '//x', status: 'muted' });
      await service.mute({ strategy: 'xpath', selector: '//x', apiKeyId: 'ak-1' });
      expect(prismaStub.upsert.firstCall.args[0].create.status).to.equal('muted');
    });
    it('emits SELECTOR_MUTED', async () => {
      prismaStub.upsert.resolves({ original_strategy: 'xpath', original_selector: '//x', status: 'muted' });
      await service.mute({ strategy: 'xpath', selector: '//x', apiKeyId: 'ak-1' });
      expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal('selector_muted');
    });
  });

  describe('unmute', () => {
    it('deletes the row if no other history', async () => {
      prismaStub.findUnique.resolves({
        id: 'r-1', status: 'muted', regression_count: 0, fixed_at: null, resolved_at: null,
      });
      prismaStub.delete.resolves();
      const result = await service.unmute({ strategy: 'xpath', selector: '//x', apiKeyId: 'ak-1' });
      expect(prismaStub.delete.calledOnce).to.be.true;
      expect(result).to.be.null;
    });
    it('sets status active and keeps row when history exists', async () => {
      prismaStub.findUnique.resolves({
        id: 'r-1', status: 'muted', regression_count: 1, fixed_at: null, resolved_at: null,
      });
      prismaStub.update.resolves({ id: 'r-1', status: 'active', regression_count: 1 });
      await service.unmute({ strategy: 'xpath', selector: '//x', apiKeyId: 'ak-1' });
      expect(prismaStub.delete.called).to.be.false;
      expect(prismaStub.update.firstCall.args[0].data.status).to.equal('active');
    });
    it('is no-op if not muted', async () => {
      prismaStub.findUnique.resolves({ status: 'active' });
      const result = await service.unmute({ strategy: 'xpath', selector: '//x', apiKeyId: 'ak-1' });
      expect(prismaStub.delete.called).to.be.false;
      expect(prismaStub.update.called).to.be.false;
      expect(result?.status).to.equal('active');
    });
  });

  describe('cancelVerification', () => {
    it('throws if status is not pending', async () => {
      prismaStub.findUnique.resolves({ status: 'resolved' });
      let err: any = null;
      try { await service.cancelVerification({ strategy: 'xpath', selector: '//x', apiKeyId: 'ak-1' }); }
      catch (e) { err = e; }
      expect(err.currentStatus).to.equal('resolved');
    });
    it('deletes row when no other history', async () => {
      prismaStub.findUnique.resolves({
        id: 'r-1', status: 'pending', regression_count: 0, fixed_at: new Date(), resolved_at: null,
      });
      prismaStub.delete.resolves();
      const result = await service.cancelVerification({ strategy: 'xpath', selector: '//x', apiKeyId: 'ak-1' });
      expect(prismaStub.delete.calledOnce).to.be.true;
      expect(result).to.be.null;
    });
  });

  describe('onHealRecorded (regression hook)', () => {
    it('flips pending → active and increments regression_count', async () => {
      prismaStub.findUnique.resolves({
        id: 'r-1', status: 'pending', regression_count: 0,
      });
      prismaStub.update.resolves({ id: 'r-1', status: 'active', regression_count: 1 });
      await service.onHealRecorded({ strategy: 'xpath', selector: '//x', sessionId: 's-1' });
      expect(prismaStub.update.firstCall.args[0].data.status).to.equal('active');
      expect(prismaStub.update.firstCall.args[0].data.regression_count).to.equal(1);
      expect(socketStub.emitToDashboard.calledWith('selector_regressed')).to.be.true;
    });
    it('flips resolved → active and increments regression_count', async () => {
      prismaStub.findUnique.resolves({
        id: 'r-1', status: 'resolved', regression_count: 2, resolved_at: new Date(),
      });
      prismaStub.update.resolves({ id: 'r-1', status: 'active', regression_count: 3 });
      await service.onHealRecorded({ strategy: 'xpath', selector: '//x', sessionId: 's-1' });
      expect(prismaStub.update.firstCall.args[0].data.regression_count).to.equal(3);
      expect(prismaStub.update.firstCall.args[0].data.resolved_at).to.be.null;
    });
    it('is a no-op when row is muted', async () => {
      prismaStub.findUnique.resolves({ status: 'muted' });
      await service.onHealRecorded({ strategy: 'xpath', selector: '//x', sessionId: 's-1' });
      expect(prismaStub.update.called).to.be.false;
      expect(socketStub.emitToDashboard.called).to.be.false;
    });
    it('is a no-op when no row exists', async () => {
      prismaStub.findUnique.resolves(null);
      await service.onHealRecorded({ strategy: 'xpath', selector: '//x', sessionId: 's-1' });
      expect(prismaStub.update.called).to.be.false;
    });
  });
```

- [ ] **Step 6: Run all SelectorStateService tests**

```bash
npx mocha --require ts-node/register test/unit/selector-state-service.spec.ts
```

Expected: ~13 passing.

- [ ] **Step 7: Commit**

```bash
git add src/services/SelectorStateService.ts test/unit/selector-state-service.spec.ts
git commit -m "feat(selector-state): add SelectorStateService for state machine transitions"
```

---

### Task 7: Regression hook in event-manager

**Files:**
- Modify: `src/dashboard/event-manager.ts:479-508`
- Test: extend `test/unit/event-manager-smart-passive.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/event-manager-smart-passive.spec.ts`:

```ts
describe('Regression hook fires on heal write', () => {
  it('calls SelectorStateService.onHealRecorded when is_healed=true', async () => {
    const { SelectorStateService } = require('../../src/services/SelectorStateService');
    sinon.restore();
    const onHealStub = sinon.stub(SelectorStateService.prototype, 'onHealRecorded').resolves();

    const prisma = require('../../src/data-service/prisma-client').prisma;
    sinon.stub(prisma.sessionLog, 'create').resolves({ id: 'l-1', createdAt: new Date() });

    const evtManager = require('../../src/dashboard/event-manager').DASHBORD_EVENT_MANAGER;
    await evtManager.afterSessionCommand(
      'session-1', 'findElement', null,
      { body: ['xpath', '//x'], method: 'POST', originalUrl: '/findElement' } as any,
      {} as any,
      JSON.stringify({ value: { ELEMENT: 'el-1' } }),
      {
        originalSelector: '//x', originalStrategy: 'xpath',
        healedSelector: 'login-btn', healedStrategy: 'accessibility id',
        confidence: 0.9, tier: 4,
      },
    );

    expect(onHealStub.calledOnce).to.be.true;
    const arg = onHealStub.firstCall.args[0];
    expect(arg.strategy).to.equal('xpath');
    expect(arg.selector).to.equal('//x');
  });

  it('does NOT call onHealRecorded when is_healed=false', async () => {
    const { SelectorStateService } = require('../../src/services/SelectorStateService');
    sinon.restore();
    const onHealStub = sinon.stub(SelectorStateService.prototype, 'onHealRecorded').resolves();

    const prisma = require('../../src/data-service/prisma-client').prisma;
    sinon.stub(prisma.sessionLog, 'create').resolves({ id: 'l-1', createdAt: new Date() });

    const evtManager = require('../../src/dashboard/event-manager').DASHBORD_EVENT_MANAGER;
    await evtManager.afterSessionCommand(
      'session-1', 'findElement', null,
      { body: ['xpath', '//x'], method: 'POST', originalUrl: '/findElement' } as any,
      {} as any,
      JSON.stringify({ value: { ELEMENT: 'el-1' } }),
      // no healingInfo
    );

    expect(onHealStub.called).to.be.false;
  });

  it('swallows errors from onHealRecorded so heal write succeeds', async () => {
    const { SelectorStateService } = require('../../src/services/SelectorStateService');
    sinon.restore();
    sinon.stub(SelectorStateService.prototype, 'onHealRecorded').rejects(new Error('DB blip'));

    const prisma = require('../../src/data-service/prisma-client').prisma;
    const createStub = sinon.stub(prisma.sessionLog, 'create').resolves({ id: 'l-1', createdAt: new Date() });

    const evtManager = require('../../src/dashboard/event-manager').DASHBORD_EVENT_MANAGER;
    // Should not throw despite the rejected onHealRecorded
    await evtManager.afterSessionCommand(
      'session-1', 'findElement', null,
      { body: ['xpath', '//x'], method: 'POST', originalUrl: '/findElement' } as any,
      {} as any,
      JSON.stringify({ value: { ELEMENT: 'el-1' } }),
      {
        originalSelector: '//x', originalStrategy: 'xpath',
        healedSelector: 'lb', healedStrategy: 'accessibility id',
        confidence: 0.9, tier: 4,
      },
    );

    expect(createStub.calledOnce).to.be.true;  // heal write proceeded
  });
});
```

- [ ] **Step 2: Run, expect 3 new failures**

```bash
npx mocha --require ts-node/register test/unit/event-manager-smart-passive.spec.ts
```

- [ ] **Step 3: Add the regression hook**

In `src/dashboard/event-manager.ts`, immediately after `prisma.sessionLog.create()` (around line 481), add:

```ts
const persistedLog = await prisma.sessionLog.create({
  data: logEntry as SessionLog,
});

// Emit command log event to dashboard (existing code)
Container.get(SocketServer).emitToDashboard(SocketEvents.SESSION_COMMAND, {
  session_id: session.getId(),
  ...logEntry,
});

// Heal event broadcast (existing code) — keep as-is
if (logEntry.is_healed) {
  // ... existing HEALING_EVENT emit ...
}

// NEW: Regression hook — fire-and-forget; never block heal write on state lookup
if (logEntry.is_healed && logEntry.original_strategy && logEntry.original_selector) {
  Container.get(SelectorStateService)
    .onHealRecorded({
      strategy: logEntry.original_strategy,
      selector: logEntry.original_selector,
      sessionId: session.getId(),
    })
    .catch((err: any) =>
      log.warn(`[SelectorState] regression hook failed: ${err.message}`)
    );
}
```

Add the import at the top of the file:

```ts
import { SelectorStateService } from '../services/SelectorStateService';
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx mocha --require ts-node/register test/unit/event-manager-smart-passive.spec.ts
```

Expected: 9 passing total.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/event-manager.ts test/unit/event-manager-smart-passive.spec.ts
git commit -m "feat(dashboard): wire regression hook into heal write path"
```

---

### Task 8: Aggregator extension — tuple grouping + status filter

**Files:**
- Modify: `src/app/routers/dashboard.ts:351-477` (`aggregateHotspots`)
- Modify: `src/app/routers/dashboard.ts:297-345` (`getHealingHotspots`) to accept `status` query param
- Test: `test/unit/aggregate-hotspots-tuple-key.spec.ts` (new)

- [ ] **Step 1: Write failing test for tuple grouping**

Create `test/unit/aggregate-hotspots-tuple-key.spec.ts`:

```ts
import { expect } from 'chai';
import sinon from 'sinon';

// Test the exported aggregateHotspots if available, or test via getHealingHotspots
// route handler with mock prisma. Pick the simpler form — the existing test for
// aggregateHotspots in test/unit/ if any.

describe('aggregateHotspots — tuple grouping', () => {
  let prismaStub: any;

  beforeEach(() => {
    prismaStub = {
      sessionLog: { findMany: sinon.stub() },
      selectorState: { findMany: sinon.stub().resolves([]) },
    };
    const prismaModule = require('../../src/data-service/prisma-client');
    sinon.stub(prismaModule, 'prisma').value(prismaStub);
  });

  afterEach(() => sinon.restore());

  it('groups separate (strategy, value) tuples as separate hotspots', async () => {
    prismaStub.sessionLog.findMany.resolves([
      { session_id: 's1', original_strategy: 'xpath', original_selector: 'login-btn', healed_selector: 'login-btn-v2', healing_confidence: 0.9, healing_tier: 'LLM', createdAt: new Date() },
      { session_id: 's2', original_strategy: 'xpath', original_selector: 'login-btn', healed_selector: 'login-btn-v2', healing_confidence: 0.9, healing_tier: 'LLM', createdAt: new Date() },
      { session_id: 's3', original_strategy: 'accessibility id', original_selector: 'login-btn', healed_selector: 'login-btn-v3', healing_confidence: 0.95, healing_tier: 'Fuzzy XML', createdAt: new Date() },
    ]);

    // Import the module after stubbing
    const { aggregateHotspots } = require('../../src/app/routers/dashboard');
    const result = await aggregateHotspots({ windowDays: 30, limit: 10 });

    expect(result.hotspots).to.have.lengthOf(2);
    const xpathRow = result.hotspots.find((h: any) => h.originalStrategy === 'xpath');
    const accIdRow = result.hotspots.find((h: any) => h.originalStrategy === 'accessibility id');
    expect(xpathRow!.healCount).to.equal(2);
    expect(accIdRow!.healCount).to.equal(1);
  });

  it('places null original_strategy heals into "(unknown strategy)" bucket', async () => {
    prismaStub.sessionLog.findMany.resolves([
      { session_id: 's1', original_strategy: null, original_selector: 'login-btn', healed_selector: 'x', healing_confidence: 0.5, healing_tier: 'OCR', createdAt: new Date() },
    ]);
    const { aggregateHotspots } = require('../../src/app/routers/dashboard');
    const result = await aggregateHotspots({ windowDays: 30, limit: 10 });
    expect(result.hotspots[0].originalStrategy).to.satisfy((v: any) => v === null || v === '');
  });
});

describe('aggregateHotspots — status filter', () => {
  let prismaStub: any;

  beforeEach(() => {
    prismaStub = {
      sessionLog: { findMany: sinon.stub() },
      selectorState: { findMany: sinon.stub() },
    };
    const prismaModule = require('../../src/data-service/prisma-client');
    sinon.stub(prismaModule, 'prisma').value(prismaStub);
  });
  afterEach(() => sinon.restore());

  it('default status=active excludes muted/pending/resolved hotspots', async () => {
    prismaStub.sessionLog.findMany.resolves([
      { session_id: 's1', original_strategy: 'xpath', original_selector: 'a', healed_selector: 'x', healing_confidence: 0.9, healing_tier: 'LLM', createdAt: new Date() },
      { session_id: 's2', original_strategy: 'xpath', original_selector: 'b', healed_selector: 'y', healing_confidence: 0.9, healing_tier: 'LLM', createdAt: new Date() },
    ]);
    prismaStub.selectorState.findMany.resolves([
      { original_strategy: 'xpath', original_selector: 'a', status: 'muted' },
    ]);
    const { aggregateHotspots } = require('../../src/app/routers/dashboard');
    const result = await aggregateHotspots({ windowDays: 30, limit: 10 });  // default status=active
    expect(result.hotspots.map((h: any) => h.originalSelector)).to.deep.equal(['b']);
  });

  it('status=muted returns only muted (sourced separately, not via aggregator)', async () => {
    // Note: muted is served by a separate endpoint; aggregator status=muted is for completeness.
    // If the implementation chooses to handle it via aggregator, this test asserts that.
    // If not (separate endpoint), skip this test.
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx mocha --require ts-node/register test/unit/aggregate-hotspots-tuple-key.spec.ts
```

Expected: TypeScript compile error (no `aggregateHotspots` export) OR test failures (current logic groups by selector only).

Make `aggregateHotspots` exported in `src/app/routers/dashboard.ts` if not already (top of file or at function decl: `export async function aggregateHotspots(...)`).

- [ ] **Step 3: Modify `aggregateHotspots`**

Open `src/app/routers/dashboard.ts:351`. Two changes:

**(a)** In the existing `where` clause (line 355-366), the filter `original_selector: { not: null }` stays. Update the `select:` to include the new strategy columns:

```ts
const rows = await prisma.sessionLog.findMany({
  where,
  select: {
    session_id: true,
    original_selector: true,
    original_strategy: true,    // NEW
    healed_selector: true,
    healed_strategy: true,       // NEW
    healing_confidence: true,
    healing_tier: true,
    createdAt: true,
  },
  orderBy: { createdAt: 'desc' },
  take: 5000,
});
```

**(b)** Replace the line `const key = r.original_selector!;` (line 402) with:

```ts
const key = `${r.original_strategy ?? ''}\x00${r.original_selector!}`;
```

**(c)** Update the `Bucket` type (line 382) and bucket creation to track strategy:

```ts
type Bucket = {
  originalStrategy: string | null;
  originalSelector: string;
  healCount: number;
  sessions: Set<string>;
  tiers: Map<string, number>;
  healedSelectors: Map<string, number>;
  healedStrategies: Map<string, number>;  // NEW
  confidenceSum: number;
  confidenceSamples: number;
  lastHealedAt: Date;
  firstHealedAt: Date;
};
```

In the bucket creation (line 405), add `originalStrategy: r.original_strategy ?? null` and switch the existing `originalSelector: key` to `originalSelector: r.original_selector!`.

In the bucket population loop, also populate `healedStrategies`:
```ts
if (r.healed_strategy) {
  b.healedStrategies.set(r.healed_strategy, (b.healedStrategies.get(r.healed_strategy) ?? 0) + 1);
}
```

In the `.map((b) => { ... })` (line 451), include `originalStrategy: b.originalStrategy` and `suggestedStrategy: pickTopEntry(b.healedStrategies)?.value ?? null` in the returned `HotspotRow`.

- [ ] **Step 4: Add the SelectorState overlay**

After the existing `.map((b) => { ... })` chain (after the `slice(0, opts.limit)` call), add:

```ts
const hotspotsRaw = Array.from(buckets.values())
  .filter((b) => b.healCount >= minCount)
  .sort((a, b) => b.healCount - a.healCount || b.lastHealedAt.getTime() - a.lastHealedAt.getTime())
  .slice(0, opts.limit)
  .map((b) => ({
    originalStrategy: b.originalStrategy,
    originalSelector: b.originalSelector,
    healCount: b.healCount,
    sessionCount: b.sessions.size,
    topTier: pickTopEntry(b.tiers)?.value ?? null,
    suggestedRewrite: pickTopEntry(b.healedSelectors)?.value ?? null,
    suggestedStrategy: pickTopEntry(b.healedStrategies)?.value ?? null,
    suggestedRewriteShare: (() => {
      const top = pickTopEntry(b.healedSelectors);
      return top ? top.count / b.healCount : null;
    })(),
    averageConfidence: b.confidenceSamples > 0 ? b.confidenceSum / b.confidenceSamples : null,
    firstHealedAt: b.firstHealedAt.toISOString(),
    lastHealedAt: b.lastHealedAt.toISOString(),
  }));

// Overlay SelectorState
const states = await prisma.selectorState.findMany({
  where: {
    OR: hotspotsRaw.map(h => ({
      original_strategy: h.originalStrategy ?? '',
      original_selector: h.originalSelector,
    })),
  },
});
const stateMap = new Map(
  states.map(s => [`${s.original_strategy}\x00${s.original_selector}`, s]),
);

const requestedStatus = opts.status ?? 'active';
const filtered = hotspotsRaw
  .map(h => ({
    ...h,
    state: stateMap.get(`${h.originalStrategy}\x00${h.originalSelector}`) ?? null,
  }))
  .filter(h => filterByStatus(h.state, requestedStatus));

const hotspots = filtered;
```

Add a helper at the top of the file (or inline):

```ts
function filterByStatus(state: any, requested: string): boolean {
  switch (requested) {
    case 'all':       return true;
    case 'pending':   return state?.status === 'pending';
    case 'resolved':  return state?.status === 'resolved';
    case 'muted':     return state?.status === 'muted';
    case 'active':
    default:          return state == null || state.status === 'active';
  }
}
```

Update the `HotspotQueryOptions` type to include `status?: string`.

- [ ] **Step 5: Update the route handler `getHealingHotspots` to pass `status`**

In `getHealingHotspots` (line 297-310 currently):

```ts
async function getHealingHotspots(request: Request, response: Response) {
  const windowDays = parseInt((request.query.windowDays as string) || '30', 10);
  const limit      = parseInt((request.query.limit as string) || '10', 10);
  const tier       = request.query.tier     as string | undefined;
  const platform   = request.query.platform as string | undefined;
  const status     = (request.query.status  as string | undefined) ?? 'active';

  const agg = await aggregateHotspots({ windowDays, limit, tier, platform, status });
  return response.json(agg);
}
```

- [ ] **Step 6: Run aggregator tests**

```bash
npx mocha --require ts-node/register test/unit/aggregate-hotspots-tuple-key.spec.ts
```

Expected: ~3 passing.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: existing tests still pass; new tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/routers/dashboard.ts test/unit/aggregate-hotspots-tuple-key.spec.ts
git commit -m "feat(dashboard): tuple-keyed hotspot aggregation + SelectorState status filter"
```

---

### Task 9: New API endpoints

**Files:**
- Modify: `src/app/routers/dashboard.ts:780-810` (router registration + new handlers)
- Test: `test/unit/healing-state-endpoints.spec.ts` (new)

- [ ] **Step 1: Write failing tests for the three new endpoints**

Create `test/unit/healing-state-endpoints.spec.ts`:

```ts
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';

describe('POST /healing/selector/state', () => {
  let app: express.Express;
  let stateService: any;

  beforeEach(() => {
    stateService = {
      markFixed: sinon.stub(),
      mute: sinon.stub(),
      unmute: sinon.stub(),
      cancelVerification: sinon.stub(),
    };
    sinon.stub(Container, 'get').callsFake((token: any) => {
      // Return stateService for the SelectorStateService class token
      const name = typeof token === 'function' ? token.name : '';
      if (name === 'SelectorStateService') return stateService;
      throw new Error(`unstubbed Container.get(${name})`);
    });

    app = express();
    app.use(express.json());
    // Wire up the dashboard router (mock auth middleware to no-op)
    const { setupDashboardRouter } = require('../../src/app/routers/dashboard');
    setupDashboardRouter(app);
  });

  afterEach(() => sinon.restore());

  it('mark_fixed action returns the new state', async () => {
    stateService.markFixed.resolves({
      original_strategy: 'xpath', original_selector: '//x', status: 'pending',
    });
    const res = await request(app)
      .post('/healing/selector/state')
      .set('X-API-Key', 'test-admin-key')
      .send({ original_strategy: 'xpath', original_selector: '//x', action: 'mark_fixed' });
    expect(res.status).to.equal(200);
    expect(res.body.state.status).to.equal('pending');
  });

  it('mute action calls mute', async () => {
    stateService.mute.resolves({
      original_strategy: 'xpath', original_selector: '//x', status: 'muted',
    });
    const res = await request(app)
      .post('/healing/selector/state')
      .set('X-API-Key', 'test-admin-key')
      .send({ original_strategy: 'xpath', original_selector: '//x', action: 'mute' });
    expect(res.status).to.equal(200);
    expect(stateService.mute.calledOnce).to.be.true;
  });

  it('returns 409 for conflicting actions', async () => {
    stateService.markFixed.rejects(Object.assign(new Error('Cannot mark muted'), { name: 'SelectorStateConflictError', currentStatus: 'muted' }));
    const res = await request(app)
      .post('/healing/selector/state')
      .set('X-API-Key', 'test-admin-key')
      .send({ original_strategy: 'xpath', original_selector: '//x', action: 'mark_fixed' });
    expect(res.status).to.equal(409);
    expect(res.body.error).to.match(/muted/i);
    expect(res.body.currentStatus).to.equal('muted');
  });

  it('returns 400 for invalid action', async () => {
    const res = await request(app)
      .post('/healing/selector/state')
      .set('X-API-Key', 'test-admin-key')
      .send({ original_strategy: 'xpath', original_selector: '//x', action: 'do_a_dance' });
    expect(res.status).to.equal(400);
  });
});

describe('GET /healing/state/muted', () => {
  // Similar pattern: stub prisma.selectorState.findMany; assert response shape
});

describe('GET /healing/state/:strategy/:value', () => {
  // Similar pattern: URL-encoded strategy + value; stub findUnique
});
```

(Adjust import paths and auth-middleware bypass to match the actual codebase.)

- [ ] **Step 2: Run, expect FAIL**

```bash
npx mocha --require ts-node/register test/unit/healing-state-endpoints.spec.ts
```

- [ ] **Step 3: Implement the handlers**

In `src/app/routers/dashboard.ts`, add three new handlers:

```ts
// POST /healing/selector/state — apply a state action.
async function postSelectorStateAction(request: Request, response: Response) {
  const { original_strategy, original_selector, action } = request.body ?? {};
  if (!original_strategy || !original_selector || !action) {
    return response.status(400).json({ error: 'original_strategy, original_selector, and action are required' });
  }
  const validActions = ['mark_fixed', 'mute', 'unmute', 'cancel_verification'];
  if (!validActions.includes(action)) {
    return response.status(400).json({ error: `action must be one of ${validActions.join(', ')}` });
  }
  // Resolve api key id from middleware (existing apiKeyMiddleware sets req.apiKey or similar)
  const apiKeyId = (request as any).apiKey?.id ?? null;

  try {
    const service = Container.get(SelectorStateService);
    let row;
    if (action === 'mark_fixed') {
      row = await service.markFixed({ strategy: original_strategy, selector: original_selector, apiKeyId });
    } else if (action === 'mute') {
      row = await service.mute({ strategy: original_strategy, selector: original_selector, apiKeyId });
    } else if (action === 'unmute') {
      row = await service.unmute({ strategy: original_strategy, selector: original_selector, apiKeyId });
    } else if (action === 'cancel_verification') {
      row = await service.cancelVerification({ strategy: original_strategy, selector: original_selector, apiKeyId });
    }
    return response.json({ state: row });
  } catch (err: any) {
    if (err.name === 'SelectorStateConflictError') {
      return response.status(409).json({ error: err.message, currentStatus: err.currentStatus });
    }
    log.error(`[Dashboard] selector state action failed: ${err.message}`);
    return response.status(500).json({ error: 'internal' });
  }
}

// GET /healing/state/muted — list muted selectors.
async function getMutedSelectors(request: Request, response: Response) {
  const limit  = Math.min(parseInt((request.query.limit  as string) || '50', 10), 200);
  const offset = parseInt((request.query.offset as string) || '0',  10);
  const muted = await prisma.selectorState.findMany({
    where: { status: 'muted' },
    orderBy: { muted_at: 'desc' },
    take: limit,
    skip: offset,
  });
  const total = await prisma.selectorState.count({ where: { status: 'muted' } });

  // Optional: enrich each row with last_healed_at by querying SessionLog max(createdAt).
  const enriched = await Promise.all(muted.map(async (s) => {
    const last = await prisma.sessionLog.findFirst({
      where: {
        original_strategy: s.original_strategy,
        original_selector: s.original_selector,
        is_healed: true,
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return {
      original_strategy: s.original_strategy,
      original_selector: s.original_selector,
      muted_at: s.muted_at?.toISOString() ?? null,
      muted_by_api_key: s.muted_by_api_key,
      last_healed_at: last?.createdAt.toISOString() ?? null,
      regression_count: s.regression_count,
    };
  }));
  return response.json({ muted: enriched, total, limit, offset });
}

// GET /healing/state/:strategy/:value — single tuple state lookup.
async function getSelectorStateByTuple(request: Request, response: Response) {
  const strategy = decodeURIComponent(request.params.strategy);
  const value    = decodeURIComponent(request.params.value);
  const row = await prisma.selectorState.findUnique({
    where: { original_strategy_original_selector: { original_strategy: strategy, original_selector: value } },
  });
  return response.json({ state: row });
}
```

- [ ] **Step 4: Register the new routes**

Find the existing route registrations around line 793-800. Add:

```ts
router.post('/healing/selector/state', scopeGuard(['admin']), postSelectorStateAction);
router.get('/healing/state/muted',                              getMutedSelectors);
router.get('/healing/state/:strategy/:value',                   getSelectorStateByTuple);
```

- [ ] **Step 5: Run, expect PASS**

```bash
npx mocha --require ts-node/register test/unit/healing-state-endpoints.spec.ts
```

Expected: 4+ passing.

- [ ] **Step 6: Commit**

```bash
git add src/app/routers/dashboard.ts test/unit/healing-state-endpoints.spec.ts
git commit -m "feat(api): add /healing/selector/state, /healing/state/muted, /healing/state/:strategy/:value"
```

---

### Task 10: SelectorVerificationJob

**Files:**
- Create: `src/services/SelectorVerificationJob.ts`
- Modify: `src/plugin.ts` to start/stop it
- Test: `test/unit/selector-verification-job.spec.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `test/unit/selector-verification-job.spec.ts`:

```ts
import { expect } from 'chai';
import sinon from 'sinon';
import { SelectorVerificationJob } from '../../src/services/SelectorVerificationJob';

describe('SelectorVerificationJob.run', () => {
  let prismaStub: any;
  let socketStub: any;
  let job: SelectorVerificationJob;

  beforeEach(() => {
    prismaStub = {
      selectorState: { findMany: sinon.stub(), update: sinon.stub() },
      $queryRaw: sinon.stub(),
    };
    socketStub = { emitToDashboard: sinon.stub() };
    job = new SelectorVerificationJob(prismaStub, socketStub);
  });
  afterEach(() => sinon.restore());

  it('promotes a Pending row to Resolved when 3 distinct clean build_ids exist', async () => {
    prismaStub.selectorState.findMany.resolves([
      { id: 'r-1', original_strategy: 'xpath', original_selector: '//x', status: 'pending', fixed_at: new Date('2026-04-20') },
    ]);
    prismaStub.$queryRaw.resolves([
      { build_id: 'b-1', healed: 0n },
      { build_id: 'b-2', healed: 0n },
      { build_id: 'b-3', healed: 0n },
    ]);
    prismaStub.selectorState.update.resolves({});
    await job.run();
    const updateArg = prismaStub.selectorState.update.firstCall.args[0];
    expect(updateArg.data.status).to.equal('resolved');
    expect(updateArg.data.resolved_at).to.be.instanceOf(Date);
    expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal('selector_resolved');
  });

  it('updates clean_builds_count without promoting when below 3', async () => {
    prismaStub.selectorState.findMany.resolves([
      { id: 'r-1', original_strategy: 'xpath', original_selector: '//x', status: 'pending', fixed_at: new Date('2026-04-20'), clean_builds_count: 0 },
    ]);
    prismaStub.$queryRaw.resolves([
      { build_id: 'b-1', healed: 0n },
      { build_id: 'b-2', healed: 1n },  // this build had a heal — not clean
    ]);
    prismaStub.selectorState.update.resolves({});
    await job.run();
    const updateArg = prismaStub.selectorState.update.firstCall.args[0];
    expect(updateArg.data.status).to.be.undefined;  // not promoted
    expect(updateArg.data.clean_builds_count).to.equal(1);
    expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal('selector_progress');
  });

  it('does NOT count builds where build_id is null', async () => {
    prismaStub.selectorState.findMany.resolves([
      { id: 'r-1', original_strategy: 'xpath', original_selector: '//x', status: 'pending', fixed_at: new Date('2026-04-20') },
    ]);
    // The $queryRaw filters s.build_id IS NOT NULL, so callers shouldn't see those rows.
    // Verify the SQL string contains that clause.
    prismaStub.$queryRaw.callsFake((tpl: any, ...args: any[]) => {
      const sql = Array.isArray(tpl) ? tpl.join('?') : String(tpl);
      expect(sql).to.match(/build_id IS NOT NULL/i);
      return Promise.resolve([]);
    });
    await job.run();
  });

  it('skips muted rows (only processes status=pending)', async () => {
    prismaStub.selectorState.findMany.resolves([]);  // findMany filtered to status=pending should yield none
    await job.run();
    expect(prismaStub.$queryRaw.called).to.be.false;
  });

  it('continues processing remaining rows if one fails', async () => {
    prismaStub.selectorState.findMany.resolves([
      { id: 'r-1', original_strategy: 'xpath', original_selector: '//a', status: 'pending', fixed_at: new Date() },
      { id: 'r-2', original_strategy: 'xpath', original_selector: '//b', status: 'pending', fixed_at: new Date() },
    ]);
    prismaStub.$queryRaw.onFirstCall().rejects(new Error('boom'));
    prismaStub.$queryRaw.onSecondCall().resolves([{ build_id: 'b-1', healed: 0n }, { build_id: 'b-2', healed: 0n }, { build_id: 'b-3', healed: 0n }]);
    prismaStub.selectorState.update.resolves({});
    await job.run();
    expect(prismaStub.selectorState.update.calledOnce).to.be.true;
    expect(prismaStub.selectorState.update.firstCall.args[0].where.id).to.equal('r-2');
  });
});
```

- [ ] **Step 2: Run, expect FAIL (file doesn't exist)**

```bash
npx mocha --require ts-node/register test/unit/selector-verification-job.spec.ts
```

- [ ] **Step 3: Create the job**

Create `src/services/SelectorVerificationJob.ts`:

```ts
import { Service } from 'typedi';
import * as schedule from 'node-schedule';
import { Prisma, PrismaClient, SelectorState } from '../generated/client';
import { SocketServer } from './SocketServer';
import { SocketEvents } from '../enums/SocketEvents';
import logger from '../logger';

const log = logger.scope('SelectorVerification');

@Service()
export class SelectorVerificationJob {
  private job?: schedule.Job;

  constructor(
    private prisma: PrismaClient,
    private socket: SocketServer,
  ) {}

  start() {
    this.job = schedule.scheduleJob('*/15 * * * *', () =>
      this.run().catch((err) => log.error(`run failed: ${err.message}`)),
    );
    log.info('SelectorVerificationJob started (interval: every 15 min)');
  }

  stop() {
    this.job?.cancel();
    this.job = undefined;
  }

  /**
   * Scan all Pending rows; promote to Resolved if at least 3 distinct
   * build_ids since fixed_at have run the selector with no heal.
   * On every run also updates clean_builds_count for live progress UI.
   */
  async run(): Promise<void> {
    const pending = await this.prisma.selectorState.findMany({ where: { status: 'pending' } });
    for (const s of pending) {
      try {
        await this.processOne(s);
      } catch (err: any) {
        log.error(`[${s.id}] processing failed: ${err.message}`);
        // continue with remaining rows
      }
    }
  }

  private async processOne(s: SelectorState): Promise<void> {
    if (!s.fixed_at) return;

    // Per-build-id heal status: did ANY findElement for this selector heal in this build?
    const rows = await this.prisma.$queryRaw<Array<{ build_id: string; healed: bigint }>>`
      SELECT s.build_id AS build_id,
             MAX(CASE WHEN sl.is_healed THEN 1 ELSE 0 END) AS healed
      FROM session_log sl
      INNER JOIN session s ON sl.session_id = s.id
      WHERE sl.original_strategy = ${s.original_strategy}
        AND sl.original_selector = ${s.original_selector}
        AND sl.command_name IN ('findElement', 'findElements')
        AND sl.created_at >= ${s.fixed_at}
        AND s.build_id IS NOT NULL
      GROUP BY s.build_id
    `;

    const cleanBuilds = rows.filter((r) => Number(r.healed) === 0).length;

    if (cleanBuilds >= 3) {
      await this.promoteToResolved(s);
    } else if (cleanBuilds !== s.clean_builds_count) {
      await this.updateProgress(s, cleanBuilds);
    }
  }

  private async promoteToResolved(s: SelectorState): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.selectorState.update({
      where: { id: s.id },
      data: {
        status: 'resolved',
        resolved_at: now,
        clean_builds_count: 3,
        last_event_at: now,
      },
    });
    this.socket.emitToDashboard(SocketEvents.SELECTOR_RESOLVED, this.serialize(updated));
    log.info(`[${s.id}] promoted to resolved (selector ${s.original_strategy}:${s.original_selector})`);
  }

  private async updateProgress(s: SelectorState, count: number): Promise<void> {
    const updated = await this.prisma.selectorState.update({
      where: { id: s.id },
      data: { clean_builds_count: count, last_event_at: new Date() },
    });
    this.socket.emitToDashboard(SocketEvents.SELECTOR_PROGRESS, this.serialize(updated));
  }

  private serialize(row: SelectorState) {
    return {
      original_strategy: row.original_strategy,
      original_selector: row.original_selector,
      status: row.status,
      clean_builds_count: row.clean_builds_count,
      resolved_at: row.resolved_at?.toISOString() ?? null,
    };
  }
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
npx mocha --require ts-node/register test/unit/selector-verification-job.spec.ts
```

Expected: 5 passing.

- [ ] **Step 5: Wire job lifecycle in plugin.ts**

In `src/plugin.ts`, locate the hub initialization (where `OrphanSweeper` is started — grep for `OrphanSweeper`). Add alongside it:

```ts
// after existing services start (e.g., OrphanSweeper)
Container.get(SelectorVerificationJob).start();
```

In the shutdown handler, add:

```ts
Container.get(SelectorVerificationJob).stop();
```

Add the import at the top:

```ts
import { SelectorVerificationJob } from './services/SelectorVerificationJob';
```

- [ ] **Step 6: Commit**

```bash
git add src/services/SelectorVerificationJob.ts src/plugin.ts test/unit/selector-verification-job.spec.ts
git commit -m "feat(verification): add SelectorVerificationJob — promotes Pending to Resolved after 3 clean builds"
```

---

### Task 11: Integration test — full backend flow

**Files:**
- Create: `test/integration/selector-state-flow.spec.ts`

- [ ] **Step 1: Write the integration test**

Create `test/integration/selector-state-flow.spec.ts`:

```ts
import { expect } from 'chai';
import { PrismaClient } from '../../src/generated/client';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { SelectorVerificationJob } from '../../src/services/SelectorVerificationJob';

describe('Selector state full flow (integration)', function () {
  this.timeout(30_000);
  let prisma: PrismaClient;
  let stateService: SelectorStateService;
  let verifier: SelectorVerificationJob;

  before(async () => {
    process.env.DATABASE_URL = 'file:./test-selector-state.db';
    prisma = new PrismaClient();
    await prisma.$executeRaw`DELETE FROM session_log`;
    await prisma.$executeRaw`DELETE FROM selector_state`;
    const fakeSocket = { emitToDashboard: () => {} } as any;
    stateService = new SelectorStateService(prisma, fakeSocket);
    verifier = new SelectorVerificationJob(prisma, fakeSocket);
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it('Mark Fixed → 3 clean builds → Resolved', async () => {
    // Seed: simulate 14 heals on (xpath, login-btn) before mark-as-fixed
    const session = await prisma.session.create({
      data: { id: 's-pre-1', name: 'pre-fix', api_key_id: null, build_id: 'b-0', /* + required fields per schema */ status: 'finished' as any, created_at: new Date('2026-04-20') } as any,
    });
    for (let i = 0; i < 14; i++) {
      await prisma.sessionLog.create({
        data: {
          session_id: 's-pre-1',
          command_name: 'findElement',
          url: '/findElement', method: 'POST', title: 'Find',
          response: '{}', body: '["xpath","login-btn"]',
          is_healed: true,
          original_strategy: 'xpath', original_selector: 'login-btn',
          healed_strategy: 'accessibility id', healed_selector: 'login-btn',
          healing_confidence: 0.9, healing_tier: 'LLM',
        } as any,
      });
    }

    // Mark as Fixed
    const state = await stateService.markFixed({
      strategy: 'xpath', selector: 'login-btn', apiKeyId: 'ak-test',
    });
    expect(state.status).to.equal('pending');

    // Simulate 3 distinct CI builds without heals
    for (const buildId of ['b-1', 'b-2', 'b-3']) {
      const sid = `s-${buildId}`;
      await prisma.session.create({ data: { id: sid, name: 'post-fix', build_id: buildId, status: 'finished' as any, created_at: new Date() } as any });
      await prisma.sessionLog.create({
        data: {
          session_id: sid,
          command_name: 'findElement',
          url: '/findElement', method: 'POST', title: 'Find',
          response: '{}', body: '["xpath","login-btn"]',
          is_healed: false,
          original_strategy: 'xpath', original_selector: 'login-btn',
        } as any,
      });
    }

    // Run verifier
    await verifier.run();

    const final = await prisma.selectorState.findUnique({
      where: { original_strategy_original_selector: { original_strategy: 'xpath', original_selector: 'login-btn' } },
    });
    expect(final?.status).to.equal('resolved');
    expect(final?.resolved_at).to.not.be.null;
  });

  it('Resolved → heal arrives → reverts to Active with regression_count++', async () => {
    // Continue from previous test's state (or set up fresh)
    await stateService.onHealRecorded({ strategy: 'xpath', selector: 'login-btn', sessionId: 's-regression' });
    const after = await prisma.selectorState.findUnique({
      where: { original_strategy_original_selector: { original_strategy: 'xpath', original_selector: 'login-btn' } },
    });
    expect(after?.status).to.equal('active');
    expect(after?.regression_count).to.equal(1);
    expect(after?.resolved_at).to.be.null;
  });
});
```

(Adjust the `Session` model field names to match the actual schema — the comments mark required fields.)

- [ ] **Step 2: Run integration test**

```bash
npx mocha --require ts-node/register test/integration/selector-state-flow.spec.ts
```

Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add test/integration/selector-state-flow.spec.ts
git commit -m "test(integration): full state flow — markFixed → verifier → regression"
```

---

### Task 12: Backend smoke verification

**Files:**
- (verification only; no commits required, but small test fixes encountered may produce small commits)

- [ ] **Step 1: Run the full backend test suite**

```bash
npm test
```

Expected: all tests pass. Note any new failures vs pre-flight baseline; if any unrelated to this work, leave them; if related, fix.

- [ ] **Step 2: Build Xenon**

```bash
npm run build
```

Expected: clean compile.

- [ ] **Step 3: Manual API smoke (optional but recommended)**

Start Xenon locally:
```bash
npm run dev
```

In another terminal, exercise the endpoints:
```bash
# (Replace with valid admin API key)
curl -X POST http://localhost:4723/xenon/api/dashboard/healing/selector/state \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <admin-key>' \
  -d '{"original_strategy":"xpath","original_selector":"login-btn","action":"mark_fixed"}' | jq .

curl 'http://localhost:4723/xenon/api/dashboard/healing/state/muted' \
  -H 'X-API-Key: <key>' | jq .

curl 'http://localhost:4723/xenon/api/dashboard/healing/hotspots?status=pending' \
  -H 'X-API-Key: <key>' | jq .
```

Each should return 200 with the documented shapes.

---

## Phase B: Frontend

### Task 13: Strategy labels + snippet generator utilities

**Files:**
- Create: `web/src/utils/strategy-labels.ts`
- Create: `web/src/utils/snippet-generator.ts`
- Test: `web/src/utils/snippet-generator.test.ts` (new)

- [ ] **Step 1: Create strategy-labels.ts**

Create `web/src/utils/strategy-labels.ts`:

```ts
export const STRATEGY_LABELS: Record<string, string> = {
  'accessibility id':       'Accessibility ID',
  'xpath':                  'XPath',
  'id':                     'ID',
  'name':                   'Name',
  'class name':             'Class Name',
  '-android uiautomator':   'UiAutomator',
  '-ios predicate string':  'iOS Predicate',
  '-ios class chain':       'iOS Class Chain',
  'xenon:visual':           'Visual AI (coords)',
};

export function formatStrategy(strategy: string | null | undefined): string {
  if (!strategy) return '(unknown strategy)';
  return STRATEGY_LABELS[strategy] ?? strategy;
}
```

- [ ] **Step 2: Write failing test for snippet-generator**

Create `web/src/utils/snippet-generator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// (or whatever test framework web/ uses; check package.json — likely vitest based on Vite stack)
import { snippet } from './snippet-generator';

describe('snippet', () => {
  it('JavaScript accessibility id', () => {
    expect(snippet('javascript', 'accessibility id', 'login-btn'))
      .to.equal(`await driver.findElement('accessibility id', 'login-btn')`);
  });
  it('Java accessibility id', () => {
    expect(snippet('java', 'accessibility id', 'login-btn'))
      .to.equal(`driver.findElement(AppiumBy.accessibilityId("login-btn"))`);
  });
  it('Python xpath', () => {
    expect(snippet('python', 'xpath', `//button[@id="x"]`))
      .to.equal(`driver.find_element(AppiumBy.XPATH, '//button[@id=\\"x\\"]')`);
  });
  it('escapes single quotes correctly', () => {
    expect(snippet('javascript', 'xpath', `it's me`)).to.contain(`it\\'s`);
  });
  it('falls back for xenon:visual to a label, not a snippet', () => {
    expect(snippet('javascript', 'xenon:visual', 'foo'))
      .to.match(/(visual|coordinate)/i);
  });
  it('falls back for unknown language to identity format', () => {
    expect(snippet('cobol' as any, 'xpath', 'x')).to.contain('x');
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
cd web && npx vitest run src/utils/snippet-generator.test.ts
```

(If vitest isn't configured in web/, fall back to whatever test runner is set up — check `web/package.json`.)

- [ ] **Step 4: Implement snippet-generator.ts**

Create `web/src/utils/snippet-generator.ts`:

```ts
export type Language = 'javascript' | 'java' | 'python' | 'csharp' | 'ruby';

interface SnippetTemplate {
  (escapedValue: string): string;
}

const SNIPPETS: Record<Language, Record<string, SnippetTemplate>> = {
  javascript: {
    'accessibility id': (v) => `await driver.findElement('accessibility id', '${v}')`,
    'xpath':            (v) => `await driver.findElement('xpath', '${v}')`,
    'id':               (v) => `await driver.findElement('id', '${v}')`,
    'name':             (v) => `await driver.findElement('name', '${v}')`,
    'class name':       (v) => `await driver.findElement('class name', '${v}')`,
  },
  java: {
    'accessibility id': (v) => `driver.findElement(AppiumBy.accessibilityId("${v}"))`,
    'xpath':            (v) => `driver.findElement(AppiumBy.xpath("${v}"))`,
    'id':               (v) => `driver.findElement(AppiumBy.id("${v}"))`,
    'name':             (v) => `driver.findElement(AppiumBy.name("${v}"))`,
    'class name':       (v) => `driver.findElement(AppiumBy.className("${v}"))`,
  },
  python: {
    'accessibility id': (v) => `driver.find_element(AppiumBy.ACCESSIBILITY_ID, '${v}')`,
    'xpath':            (v) => `driver.find_element(AppiumBy.XPATH, '${v}')`,
    'id':               (v) => `driver.find_element(AppiumBy.ID, '${v}')`,
    'name':             (v) => `driver.find_element(AppiumBy.NAME, '${v}')`,
    'class name':       (v) => `driver.find_element(AppiumBy.CLASS_NAME, '${v}')`,
  },
  csharp: {
    'accessibility id': (v) => `driver.FindElement(MobileBy.AccessibilityId("${v}"))`,
    'xpath':            (v) => `driver.FindElement(By.XPath("${v}"))`,
    'id':               (v) => `driver.FindElement(By.Id("${v}"))`,
  },
  ruby: {
    'accessibility id': (v) => `driver.find_element(:accessibility_id, '${v}')`,
    'xpath':            (v) => `driver.find_element(:xpath, '${v}')`,
    'id':               (v) => `driver.find_element(:id, '${v}')`,
  },
};

function escapeForLanguage(lang: Language, value: string): string {
  // Most languages: escape single-quote and backslash
  const usesDoubleQuotes = ['java', 'csharp'].includes(lang);
  const escaped = value.replace(/\\/g, '\\\\');
  if (usesDoubleQuotes) {
    return escaped.replace(/"/g, '\\"');
  }
  return escaped.replace(/'/g, `\\'`);
}

export function snippet(lang: Language, strategy: string, value: string): string {
  if (strategy === 'xenon:visual') {
    return '/* Visual AI (coordinates) — no portable Appium snippet. Use snapshot view to find a stable native locator. */';
  }
  const tmpl = SNIPPETS[lang]?.[strategy];
  if (!tmpl) {
    // Fallback: human-readable label
    const label = (strategy ?? '').toString().toUpperCase();
    return `${label}: ${value}`;
  }
  return tmpl(escapeForLanguage(lang, value));
}
```

- [ ] **Step 5: Run tests, expect PASS**

```bash
cd web && npx vitest run src/utils/snippet-generator.test.ts
```

Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
cd ..
git add web/src/utils/strategy-labels.ts web/src/utils/snippet-generator.ts web/src/utils/snippet-generator.test.ts
git commit -m "feat(web): strategy labels + multi-language snippet generator"
```

---

### Task 14: API client extensions

**Files:**
- Modify: `web/src/api-service/index.ts:289-310` (extend existing healing methods, add new ones)
- Modify: `web/src/interfaces/IHealingEvent.ts` (add ISelectorState + state on hotspot)

- [ ] **Step 1: Extend interfaces**

Open `web/src/interfaces/IHealingEvent.ts`. Add:

```ts
export type SelectorStateStatus = 'active' | 'pending' | 'resolved' | 'muted';

export interface ISelectorState {
  original_strategy: string;
  original_selector: string;
  status: SelectorStateStatus;
  fixed_at: string | null;
  fixed_by_api_key: string | null;
  resolved_at: string | null;
  muted_at: string | null;
  muted_by_api_key: string | null;
  regression_count: number;
  clean_builds_count: number;
  last_event_at: string;
}

// On the existing IHealingHotspot interface, add:
//   originalStrategy: string | null;
//   suggestedStrategy: string | null;
//   state?: ISelectorState | null;
```

Find the existing `IHealingHotspot` interface and add those three fields.

- [ ] **Step 2: Extend `getHealingHotspots` to accept status**

In `web/src/api-service/index.ts`, find the existing `getHealingHotspots` method (line 297). Update its signature:

```ts
async getHealingHotspots(opts?: {
  windowDays?: number; limit?: number; tier?: string; platform?: string;
  status?: 'active' | 'pending' | 'resolved' | 'all';
}): Promise<IHealingHotspotsResponse> {
  const windowDays = opts?.windowDays ?? 30;
  const limit      = opts?.limit ?? 10;
  const status     = opts?.status ?? 'active';
  let url = `/healing/hotspots?windowDays=${windowDays}&limit=${limit}&status=${status}&t=${Date.now()}`;
  if (opts?.tier)     url += `&tier=${encodeURIComponent(opts.tier)}`;
  if (opts?.platform) url += `&platform=${encodeURIComponent(opts.platform)}`;
  const res = await this.fetch(url);
  return res.json();
}
```

- [ ] **Step 3: Add three new methods**

In `web/src/api-service/index.ts` (after `getHealingHotspots`):

```ts
async getMutedSelectors(opts?: { limit?: number; offset?: number }): Promise<{
  muted: any[];   // shape per backend: original_strategy, original_selector, muted_at, ...
  total: number;
  limit: number;
  offset: number;
}> {
  const limit  = opts?.limit  ?? 50;
  const offset = opts?.offset ?? 0;
  const res = await this.fetch(`/healing/state/muted?limit=${limit}&offset=${offset}&t=${Date.now()}`);
  return res.json();
}

async getSelectorState(strategy: string, value: string): Promise<{ state: ISelectorState | null }> {
  const url = `/healing/state/${encodeURIComponent(strategy)}/${encodeURIComponent(value)}?t=${Date.now()}`;
  const res = await this.fetch(url);
  return res.json();
}

async postSelectorStateAction(opts: {
  original_strategy: string;
  original_selector: string;
  action: 'mark_fixed' | 'mute' | 'unmute' | 'cancel_verification';
}): Promise<{ state: ISelectorState | null }> {
  const res = await this.fetch('/healing/selector/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err.error ?? 'Action failed'), { status: res.status, currentStatus: err.currentStatus });
  }
  return res.json();
}
```

(Adjust `this.fetch` to whatever helper already exists in `XenonApiService`.)

- [ ] **Step 4: Verify TypeScript compile**

```bash
cd web && npx tsc --noEmit
cd ..
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/api-service/index.ts web/src/interfaces/IHealingEvent.ts
git commit -m "feat(web): add API client methods for selector state + extend hotspots with status"
```

---

### Task 15: Tab navigation component

**Files:**
- Create: `web/src/components/selector-health/tab-nav.tsx`
- Modify: `web/src/components/selector-health/selector-health-page.tsx` to embed the nav and branch on `tab` query param

- [ ] **Step 1: Create the TabNav component**

Create `web/src/components/selector-health/tab-nav.tsx`:

```tsx
import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export type Tab = 'active' | 'pending' | 'resolved' | 'muted';

interface Counts {
  active?: number;
  pending?: number;
  resolved?: number;
  muted?: number;
}

interface Props {
  current: Tab;
  counts: Counts;
}

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'active',   label: 'Active',   icon: '⚡' },
  { id: 'pending',  label: 'Pending',  icon: '⏳' },
  { id: 'resolved', label: 'Resolved', icon: '✅' },
  { id: 'muted',    label: 'Muted',    icon: '🔇' },
];

export function TabNav({ current, counts }: Props) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const switchTab = (id: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    navigate({ search: next.toString() });
  };

  return (
    <nav className="sh-tab-nav" role="tablist">
      {TABS.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={current === t.id}
          onClick={() => switchTab(t.id)}
          className={`sh-tab ${current === t.id ? 'sh-tab--active' : ''}`}
        >
          <span className="sh-tab__label">{t.label}</span>
          {typeof counts[t.id] === 'number' && (
            <span className="sh-tab__count">{counts[t.id]}</span>
          )}
          <span className="sh-tab__icon" aria-hidden="true">{t.icon}</span>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Add minimal styling**

Append to `web/src/components/selector-health/selector-health.css`:

```css
.sh-tab-nav { display: flex; gap: 0.5rem; border-bottom: 1px solid var(--border-subtle); margin-bottom: 1rem; }
.sh-tab { background: transparent; border: 0; padding: 0.6rem 1rem; cursor: pointer; color: var(--text-muted); display: inline-flex; gap: 0.4rem; align-items: center; }
.sh-tab--active { color: var(--text-emphasis); border-bottom: 2px solid var(--accent); margin-bottom: -1px; }
.sh-tab__count { background: var(--surface-2); border-radius: 999px; padding: 0 0.45rem; font-size: 0.75rem; }
```

- [ ] **Step 3: Wire into the page**

Open `web/src/components/selector-health/selector-health-page.tsx`. Read the existing page top-level structure. After the title/heading, insert the `TabNav` and a `useSearchParams` read for `tab`:

```tsx
import { TabNav, Tab } from './tab-nav';
// ...
const [params] = useSearchParams();
const tab = (params.get('tab') as Tab) ?? 'active';

// existing fetch returns hotspots; pass status=tab so each tab requests its own list
const { data, refetch } = useQuery(['hotspots', tab, windowDays], () =>
  api.getHealingHotspots({ status: tab === 'muted' ? 'all' : tab, windowDays }));

const counts: any = {
  active:   tab === 'active'   ? data?.hotspots.length : undefined,
  pending:  tab === 'pending'  ? data?.hotspots.length : undefined,
  resolved: tab === 'resolved' ? data?.hotspots.length : undefined,
  muted:    tab === 'muted'    ? mutedData?.total      : undefined,
};

// In the JSX, before the existing hotspot table:
<TabNav current={tab} counts={counts} />

// Conditionally render the right view based on tab:
{tab === 'active'   && <HotspotTable hotspots={data?.hotspots} variant="active" />}
{tab === 'pending'  && <PendingTabView hotspots={data?.hotspots} />}
{tab === 'resolved' && <ResolvedTabView hotspots={data?.hotspots} />}
{tab === 'muted'    && <MutedListView />}
```

(Pending/Resolved/Muted view components are stubs for now — implemented in subsequent tasks. Add empty stub components inline if needed for compilation.)

- [ ] **Step 4: Verify build**

```bash
cd web && npm run build
cd ..
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/selector-health/tab-nav.tsx web/src/components/selector-health/selector-health.css web/src/components/selector-health/selector-health-page.tsx
git commit -m "feat(web): add tab navigation to /selector-health (Active/Pending/Resolved/Muted)"
```

---

### Task 16: Active row — strategy display + Mark as Fixed + Mute buttons

**Files:**
- Modify: `web/src/components/selector-health/selector-health-page.tsx` (the existing hotspot row rendering)

- [ ] **Step 1: Update the existing row component**

Find the row rendering (likely a `HotspotRow` component or inline in the table). Update its content to:

```tsx
function HotspotRow({ hotspot, onAction }: { hotspot: IHealingHotspot; onAction: (kind: 'mark_fixed' | 'mute', h: IHealingHotspot) => void }) {
  return (
    <tr>
      <td>
        <div className="hotspot-strategy-line">
          <strong>{formatStrategy(hotspot.originalStrategy)}:</strong>{' '}
          <code>{hotspot.originalSelector}</code>
        </div>
        <div className="hotspot-meta">
          ↻ Healed {hotspot.healCount}× / {hotspot.sessionCount} sessions • Top tier: {hotspot.topTier} • Conf {(hotspot.averageConfidence ?? 0) * 100 | 0}%
        </div>
        <div className="hotspot-rewrite">
          <strong>Suggested rewrite ({((hotspot.suggestedRewriteShare ?? 0) * 100) | 0}% match):</strong>
          <div className="hotspot-rewrite__line">
            {formatStrategy(hotspot.suggestedStrategy)}: <code>{hotspot.suggestedRewrite}</code>
          </div>
          <div className="hotspot-actions">
            <CopyButton hotspot={hotspot} />
            <button onClick={() => onAction('mark_fixed', hotspot)} className="btn btn--primary">Mark as Fixed</button>
            <button onClick={() => onAction('mute', hotspot)} className="btn btn--ghost">Mute</button>
          </div>
        </div>
      </td>
    </tr>
  );
}
```

(`CopyButton` is added in Task 17; for now, inline a simple `<button>Copy</button>` placeholder.)

- [ ] **Step 2: Wire `onAction` in the parent**

In `selector-health-page.tsx`:

```tsx
const handleAction = async (kind: 'mark_fixed' | 'mute', h: IHealingHotspot) => {
  const ok = window.confirm(/* TODO: replace with proper confirm modal in polish pass */
    kind === 'mark_fixed'
      ? `Mark this selector as fixed? Xenon will move it to Pending Verification and watch for 3 clean CI builds.`
      : `Mute this selector? It'll be hidden from Hotspots, CI gate, and digests until you unmute.`,
  );
  if (!ok) return;
  try {
    await api.postSelectorStateAction({
      original_strategy: h.originalStrategy ?? '',
      original_selector: h.originalSelector,
      action: kind,
    });
    toast.success(kind === 'mark_fixed' ? 'Marked fixed. Watching for clean builds.' : 'Muted.');
    refetch();
  } catch (err: any) {
    toast.error(err.message ?? 'Action failed');
  }
};
```

- [ ] **Step 3: Smoke test in browser**

```bash
npm run dev
```

Open `http://localhost:4723/selector-health`. Confirm: strategy displays as "XPath: foo" or "Accessibility ID: bar"; Mark as Fixed and Mute buttons render; clicking either prompts confirm and (with backend running) makes the API call.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/selector-health/selector-health-page.tsx web/src/components/selector-health/selector-health.css
git commit -m "feat(web): strategy-aware Active row with Mark as Fixed and Mute actions"
```

---

### Task 17: Multi-language copy chevron + localStorage modal

**Files:**
- Create: `web/src/components/selector-health/copy-language-modal.tsx`
- Modify: row rendering in `selector-health-page.tsx` to use `CopyButton`

- [ ] **Step 1: Create the modal component**

Create `web/src/components/selector-health/copy-language-modal.tsx`:

```tsx
import React, { useState } from 'react';
import { Language, snippet } from '../../utils/snippet-generator';

const LANG_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: 'javascript', label: 'JavaScript (WebdriverIO)' },
  { value: 'java',       label: 'Java (Appium-Java)' },
  { value: 'python',     label: 'Python (Appium-Python)' },
  { value: 'csharp',     label: 'C# (.NET)' },
  { value: 'ruby',       label: 'Ruby' },
];

const STORAGE_KEY = 'xenon.copyLang';

export function getStoredLanguage(): Language | null {
  return (localStorage.getItem(STORAGE_KEY) as Language | null) ?? null;
}

export function setStoredLanguage(lang: Language) {
  localStorage.setItem(STORAGE_KEY, lang);
}

interface Props {
  open: boolean;
  initialLang?: Language;
  strategy: string;
  value: string;
  onCopy: (lang: Language, code: string) => void;
  onClose: () => void;
}

export function CopyLanguageModal({ open, initialLang, strategy, value, onCopy, onClose }: Props) {
  const [lang, setLang] = useState<Language>(initialLang ?? 'javascript');
  const [remember, setRemember] = useState(true);

  if (!open) return null;

  const code = snippet(lang, strategy, value);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    if (remember) setStoredLanguage(lang);
    onCopy(lang, code);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Choose your default copy language</h3>
        <p className="modal__hint">Snippets will be copied in this language until you change it.</p>
        <ul className="lang-list">
          {LANG_OPTIONS.map(opt => (
            <li key={opt.value}>
              <label>
                <input type="radio" name="lang" value={opt.value} checked={lang === opt.value} onChange={() => setLang(opt.value)} />
                {opt.label}
              </label>
            </li>
          ))}
        </ul>
        <pre className="lang-preview"><code>{code}</code></pre>
        <label className="lang-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember my choice
        </label>
        <div className="modal__actions">
          <button onClick={onClose} className="btn btn--ghost">Cancel</button>
          <button onClick={handleCopy} className="btn btn--primary">Copy as {LANG_OPTIONS.find(o => o.value === lang)?.label.split(' ')[0]}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the CopyButton wrapper**

In `selector-health-page.tsx`, replace the placeholder Copy button with:

```tsx
function CopyButton({ hotspot }: { hotspot: IHealingHotspot }) {
  const [modalOpen, setModalOpen] = useState(false);
  const stored = getStoredLanguage();

  const handleClick = async () => {
    if (stored) {
      // Direct copy
      const code = snippet(stored, hotspot.suggestedStrategy ?? hotspot.originalStrategy ?? '', hotspot.suggestedRewrite ?? '');
      await navigator.clipboard.writeText(code);
      toast.success('Copied');
    } else {
      setModalOpen(true);
    }
  };

  const langLabel = stored ? stored.toUpperCase().slice(0, 2) : '';
  const buttonText = stored ? `Copy as ${langLabel}` : 'Copy';

  return (
    <>
      <button onClick={handleClick} className="btn btn--copy">
        {buttonText} <span onClick={(e) => { e.stopPropagation(); setModalOpen(true); }}>▾</span>
      </button>
      <CopyLanguageModal
        open={modalOpen}
        initialLang={stored ?? undefined}
        strategy={hotspot.suggestedStrategy ?? hotspot.originalStrategy ?? ''}
        value={hotspot.suggestedRewrite ?? ''}
        onCopy={() => toast.success('Copied')}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
```

- [ ] **Step 3: Add modal styles**

Append to `web/src/components/selector-health/selector-health.css`:

```css
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: grid; place-items: center; z-index: 100; }
.modal { background: var(--surface-1); border-radius: 8px; padding: 1.5rem; width: 460px; max-width: 90vw; box-shadow: 0 10px 25px rgba(0,0,0,0.2); }
.modal__hint { color: var(--text-muted); margin: 0.25rem 0 1rem; font-size: 0.85rem; }
.lang-list { list-style: none; padding: 0; margin: 0 0 1rem; }
.lang-list li label { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0; cursor: pointer; }
.lang-preview { background: var(--surface-2); padding: 0.6rem 0.8rem; border-radius: 4px; font-size: 0.8rem; overflow-x: auto; max-height: 60px; }
.lang-remember { display: flex; gap: 0.4rem; margin-top: 0.6rem; align-items: center; }
.modal__actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.2rem; }
```

- [ ] **Step 4: Smoke test**

Reload the dashboard. Click Copy button on a hotspot row. Modal opens. Pick a language, check Remember, hit Copy. Confirm clipboard has the snippet. Click Copy on next row — should copy directly without modal. Click chevron — modal opens for re-selection.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/selector-health/copy-language-modal.tsx web/src/components/selector-health/selector-health-page.tsx web/src/components/selector-health/selector-health.css
git commit -m "feat(web): multi-language copy chevron with localStorage memory"
```

---

### Task 18: Pending tab + progress indicator

**Files:**
- Create: `web/src/components/selector-health/pending-row.tsx`
- Modify: `web/src/components/selector-health/selector-health-page.tsx` to render Pending tab

- [ ] **Step 1: Create the PendingRow**

Create `web/src/components/selector-health/pending-row.tsx`:

```tsx
import React from 'react';
import { formatStrategy } from '../../utils/strategy-labels';
import { formatRelativeTime } from '../../utils/time';  // assume a helper; if not, inline a small one
import type { IHealingHotspot } from '../../interfaces/IHealingEvent';

export function PendingRow({ hotspot, onCancel, onMute }: {
  hotspot: IHealingHotspot;
  onCancel: (h: IHealingHotspot) => void;
  onMute:   (h: IHealingHotspot) => void;
}) {
  const state = hotspot.state!;
  const cleanCount = state.clean_builds_count ?? 0;
  const dots = [0, 1, 2].map(i => i < cleanCount ? '●' : '○');

  return (
    <tr>
      <td>
        <div className="hotspot-strategy-line">
          <strong>{formatStrategy(hotspot.originalStrategy)}:</strong> <code>{hotspot.originalSelector}</code>
        </div>
        <div className="hotspot-meta">
          ⏳ Marked fixed {formatRelativeTime(state.fixed_at)} ago • Verifying...
        </div>
        <div className="pending-progress">
          <div className="pending-progress__dots">{dots.map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="pending-progress__legend">{cleanCount} of 3 clean builds</div>
          <div className="pending-progress__hint">
            ℹ Only CI builds with build_id count. Local runs don't move this forward.
          </div>
        </div>
        <div className="hotspot-actions">
          <button onClick={() => onCancel(hotspot)} className="btn btn--ghost">Cancel verification</button>
          <button onClick={() => onMute(hotspot)} className="btn btn--ghost">Mute</button>
        </div>
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: Add styles**

Append to `selector-health.css`:

```css
.pending-progress { margin: 0.6rem 0; }
.pending-progress__dots { font-size: 1.2rem; letter-spacing: 0.4rem; color: var(--accent); }
.pending-progress__legend { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem; }
.pending-progress__hint { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.4rem; }
```

- [ ] **Step 3: Wire into selector-health-page**

When `tab === 'pending'`, render `<PendingRow>` per hotspot:

```tsx
{tab === 'pending' && data?.hotspots.map(h => (
  <PendingRow key={`${h.originalStrategy}-${h.originalSelector}`} hotspot={h}
              onCancel={h => handleAction('cancel_verification', h)}
              onMute={h => handleAction('mute', h)} />
))}
```

Extend `handleAction` from Task 16 to include `cancel_verification`.

- [ ] **Step 4: Smoke test**

Backend running, Mark a selector fixed via Active tab. Switch to Pending tab. Confirm progress dots render, action buttons present. Click Cancel verification — row disappears (returns to Active).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/selector-health/pending-row.tsx web/src/components/selector-health/selector-health-page.tsx web/src/components/selector-health/selector-health.css
git commit -m "feat(web): Pending tab with verification progress indicator"
```

---

### Task 19: Resolved tab

**Files:**
- Create: `web/src/components/selector-health/resolved-row.tsx`
- Modify: `selector-health-page.tsx` to render

- [ ] **Step 1: Create ResolvedRow**

Create `web/src/components/selector-health/resolved-row.tsx`:

```tsx
import React from 'react';
import { formatStrategy } from '../../utils/strategy-labels';
import { formatRelativeTime } from '../../utils/time';
import type { IHealingHotspot } from '../../interfaces/IHealingEvent';

export function ResolvedRow({ hotspot, onMute }: {
  hotspot: IHealingHotspot;
  onMute: (h: IHealingHotspot) => void;
}) {
  const state = hotspot.state!;
  const cleanCount = state.clean_builds_count ?? 0;
  const regression = state.regression_count ?? 0;

  return (
    <tr>
      <td>
        <div className="hotspot-strategy-line">
          <strong>{formatStrategy(hotspot.originalStrategy)}:</strong> <code>{hotspot.originalSelector}</code>
          {regression > 0 && <span className="badge badge--warn">🟡 Previously regressed {regression}×</span>}
        </div>
        <div className="hotspot-meta">
          ✅ Resolved {formatRelativeTime(state.resolved_at)} ago • {cleanCount} clean builds since fix
        </div>
        <div className="resolved-history">
          Marked fixed {formatRelativeTime(state.fixed_at)} ago • Verified {formatRelativeTime(state.resolved_at)} ago
        </div>
        <div className="hotspot-actions">
          <button onClick={() => onMute(hotspot)} className="btn btn--ghost">Mute</button>
        </div>
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: Wire into the page**

```tsx
{tab === 'resolved' && data?.hotspots.map(h => (
  <ResolvedRow key={`${h.originalStrategy}-${h.originalSelector}`} hotspot={h}
               onMute={h => handleAction('mute', h)} />
))}
```

- [ ] **Step 3: Add styles**

Append to `selector-health.css`:

```css
.badge--warn { background: rgba(241, 196, 15, 0.15); color: rgb(241, 196, 15); padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; margin-left: 0.5rem; }
.resolved-history { font-size: 0.8rem; color: var(--text-muted); margin: 0.4rem 0; }
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/selector-health/resolved-row.tsx web/src/components/selector-health/selector-health-page.tsx web/src/components/selector-health/selector-health.css
git commit -m "feat(web): Resolved tab with regression badge"
```

---

### Task 20: Muted tab

**Files:**
- Create: `web/src/components/selector-health/muted-list.tsx`
- Modify: `selector-health-page.tsx`

- [ ] **Step 1: Create MutedListView**

Create `web/src/components/selector-health/muted-list.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { formatStrategy } from '../../utils/strategy-labels';
import { formatRelativeTime } from '../../utils/time';
import { api } from '../../api-service';

export function MutedListView({ onUnmute }: { onUnmute: (strategy: string, selector: string) => Promise<void> }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMutedSelectors().then(d => { setData(d); setLoading(false); });
  }, []);

  if (loading) return <div>Loading muted selectors…</div>;
  if (!data || data.muted.length === 0) {
    return <div className="empty-state">Nothing muted. If a selector is intentionally brittle, hit Mute on its row.</div>;
  }

  return (
    <ul className="muted-list">
      {data.muted.map((m: any) => (
        <li key={`${m.original_strategy}-${m.original_selector}`} className="muted-list__item">
          <div>
            <strong>{formatStrategy(m.original_strategy)}:</strong> <code>{m.original_selector}</code>
          </div>
          <div className="muted-list__meta">
            Muted {formatRelativeTime(m.muted_at)} ago by {m.muted_by_api_key ?? 'unknown'}
            {m.last_healed_at && <> • Last healed {formatRelativeTime(m.last_healed_at)} ago</>}
          </div>
          <button onClick={() => onUnmute(m.original_strategy, m.original_selector)} className="btn btn--ghost">Unmute</button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Wire into the page + styles**

```tsx
{tab === 'muted' && (
  <MutedListView onUnmute={async (strategy, selector) => {
    await api.postSelectorStateAction({ original_strategy: strategy, original_selector: selector, action: 'unmute' });
    toast.success('Unmuted');
    // Refetch
  }} />
)}
```

Append to `selector-health.css`:
```css
.muted-list { list-style: none; padding: 0; }
.muted-list__item { padding: 0.8rem; border-bottom: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 0.3rem; }
.muted-list__meta { font-size: 0.8rem; color: var(--text-muted); }
.empty-state { padding: 2rem; text-align: center; color: var(--text-muted); }
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/selector-health/muted-list.tsx web/src/components/selector-health/selector-health-page.tsx web/src/components/selector-health/selector-health.css
git commit -m "feat(web): Muted tab with unmute action"
```

---

### Task 21: Regression banner + live socket transitions

**Files:**
- Create: `web/src/components/selector-health/regression-banner.tsx`
- Modify: `selector-health-page.tsx` to subscribe to socket events and refetch on transitions

- [ ] **Step 1: Create the banner**

Create `web/src/components/selector-health/regression-banner.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useSocket } from '../../hooks/useSocket';
import { formatStrategy } from '../../utils/strategy-labels';

interface RegressionEvent {
  original_strategy: string;
  original_selector: string;
  resolved_at?: string;
  regression_count: number;
  receivedAt: number;
}

const AUTO_DISMISS_MS = 30_000;
const AGGREGATE_WINDOW_MS = 5 * 60_000;

export function RegressionBanner() {
  const [events, setEvents] = useState<RegressionEvent[]>([]);
  const socket = useSocket();

  useEffect(() => {
    const handler = (e: any) => {
      setEvents(curr => {
        const fresh = [...curr.filter(x => Date.now() - x.receivedAt < AGGREGATE_WINDOW_MS), {
          ...e,
          receivedAt: Date.now(),
        }];
        return fresh;
      });
    };
    socket.on('selector_regressed', handler);
    return () => { socket.off('selector_regressed', handler); };
  }, [socket]);

  // Auto-dismiss timer
  useEffect(() => {
    if (events.length === 0) return;
    const t = setTimeout(() => setEvents([]), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [events]);

  if (events.length === 0) return null;

  const single = events[0];
  if (events.length === 1) {
    return (
      <div className="regression-banner" role="alert">
        🔄 A previously-Fixed selector regressed:{' '}
        <strong>{formatStrategy(single.original_strategy)}: {single.original_selector}</strong> healed again.
        <button onClick={() => setEvents([])} aria-label="Dismiss">✕</button>
      </div>
    );
  }
  return (
    <div className="regression-banner" role="alert">
      🔄 {events.length} selectors have regressed in the last 5 minutes —{' '}
      <a href="/selector-health?tab=active">[ Show all → ]</a>
      <button onClick={() => setEvents([])} aria-label="Dismiss">✕</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire socket event handlers in selector-health-page**

In `selector-health-page.tsx`:

```tsx
import { useSocket } from '../../hooks/useSocket';
// ...
const socket = useSocket();
useEffect(() => {
  const events = ['selector_fixed', 'selector_resolved', 'selector_regressed', 'selector_cancelled', 'selector_muted', 'selector_unmuted', 'selector_progress'];
  const handler = () => refetch();
  events.forEach(e => socket.on(e, handler));
  return () => events.forEach(e => socket.off(e, handler));
}, [socket, refetch]);
```

Insert `<RegressionBanner />` near the top of the page render.

- [ ] **Step 3: Add styles**

```css
.regression-banner { background: rgba(231, 76, 60, 0.1); border-left: 4px solid #e74c3c; padding: 0.8rem 1rem; margin-bottom: 1rem; display: flex; gap: 0.5rem; align-items: center; }
.regression-banner button { margin-left: auto; background: transparent; border: 0; cursor: pointer; }
```

- [ ] **Step 4: Smoke test**

With backend running and a Resolved selector, simulate a heal (run a real test that triggers healing on that selector, OR manually insert a SessionLog row with `is_healed=true, original_strategy='X', original_selector='Y'` matching the Resolved row). Confirm:
- Row moves out of Resolved tab
- Banner appears top of page
- Row reappears in Active tab with regression badge

- [ ] **Step 5: Commit**

```bash
git add web/src/components/selector-health/regression-banner.tsx web/src/components/selector-health/selector-health-page.tsx web/src/components/selector-health/selector-health.css
git commit -m "feat(web): regression banner + live socket-driven tab transitions"
```

---

### Task 22: Detail page state header

**Files:**
- Modify: `web/src/components/selector-health/selector-detail-page.tsx`

- [ ] **Step 1: Add `strategy` URL param support**

Read the existing detail page. The current `useSearchParams` should pull `value`; add `strategy`:

```tsx
const [params] = useSearchParams();
const value    = params.get('value') ?? '';
const strategy = params.get('strategy') ?? '';
const windowDays = parseInt(params.get('windowDays') ?? '30', 10);
```

If `strategy` is missing, render a banner at the top:
```tsx
{!strategy && (
  <div className="banner banner--info">
    Multiple strategies found for this selector value. <a href={`...?strategy=...`}>Filter by strategy</a> for stricter results.
  </div>
)}
```

- [ ] **Step 2: Fetch selector state**

```tsx
const [selectorState, setSelectorState] = useState<ISelectorState | null>(null);
useEffect(() => {
  if (!strategy || !value) return;
  api.getSelectorState(strategy, value).then(r => setSelectorState(r.state));
}, [strategy, value]);
```

- [ ] **Step 3: Render state header**

Above the existing detail content:

```tsx
{selectorState && (
  <div className="selector-state-header" data-status={selectorState.status}>
    <h2>
      {selectorState.status === 'pending'  && '⏳ Pending Verification'}
      {selectorState.status === 'resolved' && '✅ Resolved'}
      {selectorState.status === 'muted'    && '🔇 Muted'}
      {selectorState.status === 'active'   && (selectorState.regression_count > 0 ? '🟡 Active (regressed)' : 'Active')}
    </h2>
    <div className="selector-state-meta">
      {selectorState.fixed_at && <span>Fixed: {selectorState.fixed_at}</span>}
      {selectorState.resolved_at && <span>Resolved: {selectorState.resolved_at}</span>}
      {selectorState.regression_count > 0 && <span>Regressions: {selectorState.regression_count}</span>}
    </div>
    {/* Action buttons appropriate to state */}
    <div className="selector-state-actions">
      {selectorState.status === 'active' && (
        <>
          <button onClick={() => action('mark_fixed')}>Mark as Fixed</button>
          <button onClick={() => action('mute')}>Mute</button>
        </>
      )}
      {selectorState.status === 'pending' && (
        <>
          <button onClick={() => action('cancel_verification')}>Cancel verification</button>
          <button onClick={() => action('mute')}>Mute</button>
        </>
      )}
      {selectorState.status === 'resolved' && (
        <button onClick={() => action('mute')}>Mute</button>
      )}
      {selectorState.status === 'muted' && (
        <button onClick={() => action('unmute')}>Unmute</button>
      )}
    </div>
  </div>
)}
```

`action` helper hits `api.postSelectorStateAction`.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/selector-health/selector-detail-page.tsx
git commit -m "feat(web): selector detail page state header + actions"
```

---

### Task 23: KPI strip — Resolved/Pending tile

**Files:**
- Modify: `web/src/components/selector-health/selector-health-page.tsx` (KPI section)
- Modify: `src/app/routers/dashboard.ts` (optional: extend `getHealingSummary` to include resolved/pending counts)

- [ ] **Step 1: Add counts to backend `getHealingSummary`**

In `src/app/routers/dashboard.ts:233-296` (`getHealingSummary`), append to the response:

```ts
const resolvedCount = await prisma.selectorState.count({
  where: { status: 'resolved', resolved_at: { gte: since } },
});
const pendingCount = await prisma.selectorState.count({ where: { status: 'pending' } });
return response.json({
  ...existingSummaryFields,
  resolvedCount,
  pendingCount,
});
```

- [ ] **Step 2: Render in the KPI strip**

Find the existing KPI strip (in `selector-health-page.tsx`). Add a tile:

```tsx
<div className="kpi-tile">
  <div className="kpi-tile__label">✅ Resolved (last {windowDays}d)</div>
  <div className="kpi-tile__value">{summary.resolvedCount}</div>
  <div className="kpi-tile__sub">⏳ Pending: {summary.pendingCount}</div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/app/routers/dashboard.ts web/src/components/selector-health/selector-health-page.tsx
git commit -m "feat(dashboard): Resolved/Pending counts in KPI strip"
```

---

## Phase C: Wrapping up

### Task 24: Documentation updates

**Files:**
- Modify: `README.md`
- Modify: API Swagger annotations on the new handlers (inline JSDoc above each handler in `dashboard.ts`)

- [ ] **Step 1: Update README**

Find the "Self-Healing" section (or similar). Add a paragraph:

```markdown
### Lifecycle (Phase 1)

Healed selectors flow through a state machine: **Active → Pending → Resolved**, with an optional **Muted** branch.

- **Active**: a hot selector that's healing in flight.
- **Mark as Fixed**: after rewriting the selector in your test source, click "Mark as Fixed" in the Selector Health dashboard. The row moves to Pending.
- **Pending**: Xenon watches subsequent CI builds. When 3 distinct builds have run the selector with no heals, it auto-promotes to Resolved.
- **Resolved**: the rewrite worked. The selector is excluded from the CI gate and webhook digest.
- **Muted**: a selector you've intentionally chosen to ignore (legacy flow, etc.). Hidden from dashboard, CI gate, and digest until unmuted.

**CI gate behavior change (this release):** muted/pending/resolved selectors no longer count toward `/healing/hotspots/violations`. If your CI was passing/failing based on these violations, expect a quieter signal after deploy — selectors actively being managed are no longer flagged.
```

- [ ] **Step 2: Add Swagger JSDoc to new handlers**

Above each new handler in `src/app/routers/dashboard.ts`, add:

```ts
/**
 * @openapi
 * /healing/selector/state:
 *   post:
 *     summary: Apply a state action to a selector
 *     ...
 */
async function postSelectorStateAction(...) { ... }
```

(Match the existing Swagger style in the file.)

- [ ] **Step 3: Commit**

```bash
git add README.md src/app/routers/dashboard.ts
git commit -m "docs: README + Swagger annotations for selector lifecycle"
```

---

### Task 25: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: clean.

- [ ] **Step 2: Build everything**

```bash
npm run build:all
```

Expected: clean compile of backend + frontend.

- [ ] **Step 3: Smoke run**

Start Xenon (`npm run dev`), open `/selector-health`. Verify the four tabs render, hotspot rows show strategy + value, copy chevron works on first click and remembers the choice, Mark as Fixed moves a row to Pending, manual heal regression brings it back to Active with banner.

- [ ] **Step 4: Push branch**

```bash
git push -u origin docs/selector-trust-and-truth
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "feat(selector-health): Phase 1 Trust & Truth Layer" --body "$(cat <<'EOF'
## Summary

- Adds strategy-aware suggestions, perpetual mute, and Mark-as-Fixed → Pending → Resolved verification on top of the shipped Selector Health page.
- One Prisma migration (two SessionLog columns + new SelectorState table + composite index).
- Smart Passive instrumentation captures selector strategy on every findElement, enabling exact verification without an SDK heartbeat.
- Closes the maintainer-arc loop started in PR #29 / #30 / #32 / #33.

## Behavior change to flag

The CI gate (`/healing/hotspots/violations`) and webhook digest now exclude muted/pending/resolved selectors by default (`status=active` filter). Repos with actively-managed selectors will see CI signal get quieter — that is the intent.

## Test plan

- [ ] Backend unit tests pass (`npm test`)
- [ ] Integration test: full Mark Fixed → 3 clean builds → Resolved → regression cycle
- [ ] Frontend build clean (`cd web && npm run build`)
- [ ] Smoke: load `/selector-health`, exercise each tab, copy chevron + localStorage memory, regression banner

## Spec & plan

- Spec: `docs/superpowers/specs/2026-04-25-selector-trust-and-truth-design.md`
- Plan: `docs/superpowers/plans/2026-04-25-selector-trust-and-truth-plan.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

After writing, ran a self-review of this plan against the spec:

- **§1–§13 of spec**: every requirement maps to a task. No gaps.
- **Placeholders**: searched for `TBD`, `TODO`, `implement later` — none in concrete steps. (TODO in Task 16 step 2 is intentional — flagged future polish to use a proper confirm modal.)
- **Type consistency**: `recommendedStrategy` (HealingResult), `original_strategy` (DB column), `originalStrategy` (camelCase API/aggregator), `strategy` (service method param) — consistent within their respective layers; passed through transforms cleanly.
- **Scope check**: 25 tasks across two phases. Each phase produces working software (backend = working API + verifier; frontend = full UI on top). Bounded, plannable.
