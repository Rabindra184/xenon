# Selector Health — "Trust & Truth" Layer (Phase 1)

| | |
|---|---|
| **Status** | Draft, awaiting review |
| **Date** | 2026-04-25 |
| **Author** | Rabindra Biswal |
| **Builds on** | PR #29 (positional XPath), #30 (live "Test This Locator"), #32 (top-level Selector Health page), #33 (CI gate + webhook digest) |
| **Persona** | Test maintainer SDET — manages an existing Appium suite of dozens to thousands of selectors |

---

## 1. Context

Xenon's recent maintainer-arc shipped four PRs that turned the 5-tier healing pipeline's runtime data into a top-level dashboard (`/selector-health`), a CI gate (`GET /healing/hotspots/violations`), and an outbound webhook digest (`POST /healing/digest/send`). The data pipeline is mature: every heal is one row in `SessionLog` with `original_selector`, `healed_selector`, `healing_tier`, `healing_confidence`; the read side aggregates via `aggregateHotspots()` (`src/app/routers/dashboard.ts:351`) into per-selector hotspots with `suggestedRewrite` (mode of the healed selector) and `suggestedRewriteShare` (concentration of that mode).

What's missing is the **manual workflow's trust loop**:

1. **Strategy mismatch.** A heal converges on `accessibility id "login-btn"` but the test author's source uses `findElement('xpath', '//button[@id="login-btn"]')`. The dashboard shows the rewrite as the bare string `login-btn`. Copy-pasting it without a strategy swap produces a broken selector. Strategy is captured nowhere in the schema.
2. **Dashboard noise after fix.** Once an SDET rewrites a selector in source, the hotspot row stays in the dashboard until the heal events age out of `windowDays`. The page becomes noisy with already-fixed selectors. Worse, the CI gate keeps flagging selectors the team has already remediated.
3. **No way to silence intentional brittleness.** Some selectors heal often by design (legacy flows the team has explicitly chosen not to fix). Today they crowd the Hotspot list and pollute CI gate signals.

This design adds three capabilities — strategy-aware suggestions, perpetual mute, and Mark-as-Fixed → Pending → Resolved verification — that share **one schema migration** and **one new entity**. Xenon never reads or writes the test source code; the user does the rewrite manually, and the dashboard tracks the lifecycle.

### Why now

- The maintainer arc has the user's attention; this is the natural finish before either "auto-PR to source" (Phase 3) or pivot to authoring/debugging.
- The data needed already exists — strategy is one untouched field on every heal call (`args[0]` in `CommandInterceptor.handle`); we just don't persist it.
- The CI gate is live: cleaning up its signal (so it stops red-flagging fixed/muted/in-progress selectors) is high-leverage with no integration changes at the consumer.

### Non-goals (explicitly deferred to later phases)

- **Auto-PR healed selectors to the test repo source code** — the user has chosen the manual workflow; Xenon never touches source files in this phase.
- **IDE plugin (VS Code / IntelliJ)** — Healenium's pattern; possibly a complementary surface in a later phase.
- **Source-location resolution** (grep / AST / file:line lookup) — depends on test repo connection, which the user explicitly opted out of.
- **Team-scoped state** (per-team mute, per-team fix tracking) — single-tenant for now; schema is shaped so a `team_id` column can be added later without migration of existing data.
- **Time-bounded mutes** ("mute for 30 days").
- **Mute reasons** ("legacy / intentional / other") — adds friction; deferred.
- **Email/Slack notifications** on Resolved or Regressed events — live socket banner only in Phase 1.
- **"Linked siblings" view** for the same selector value across different strategies — Q4's Option C, future.

---

## 2. Goals

A successful Phase 1 ships these capabilities:

1. **Strategy-aware suggestions.** Hotspot rows display strategy + value (`Accessibility ID: login-btn`), and the copy button emits a code-ready snippet in the user's chosen client language (`driver.findElement(AppiumBy.accessibilityId("login-btn"))` for Java, `await driver.findElement('accessibility id', 'login-btn')` for JS, etc.).
2. **Perpetual mute.** A user with admin scope can mute any selector. Muted selectors disappear from the Hotspot list, the CI gate, and the webhook digest. They surface only in a separate Muted tab where they can be unmuted at any time.
3. **Mark as Fixed → Pending → Resolved verification.** A user clicks "Mark as Fixed" after rewriting a selector in their source. The row moves to a Pending Verification tab. A background job watches subsequent CI builds; if 3 distinct `build_id`s have run the selector with `is_healed = false` and zero heals on it, the row auto-promotes to Resolved. If a heal arrives during Pending or after Resolved, the row reverts to Active with a "regression" badge and a live banner.

These are the user's explicit Phase 1 picks (G1, G2, plus the Mute toggle they added):

> **Phase 1: The "Trust & Truth" Layer.**
> Strategy-aware suggestion, Ignore/Mute toggle, Manual "Fixed" State with auto-verification.

---

## 3. Architecture overview

The design layers a **state model** on top of the existing heal data. Three guiding principles:

1. **Additive on the write path.** New columns are nullable; new tables are independent. Existing aggregator queries work unchanged. Heal write performance must not regress.
2. **State exists only when acted upon.** A `SelectorState` row is created lazily — only when a user mutes or marks-as-fixed a selector. No backfill, no shadow rows for every selector ever heard of.
3. **Smart Passive over Active heartbeat.** Verification reuses the existing per-command `SessionLog` write rather than introducing a new client-side SDK or protocol.

### High-level data flow

```
Test client                          Xenon plugin
    │                                     │
    │  findElement(strategy, value) ──────▶  CommandInterceptor.handle
    │                                     │   ├─ Smart Passive: capture strategy + value on logEntry
    │                                     │   ├─ on success: SessionLog row { is_healed: false, ... }
    │                                     │   └─ on failure → HealingOrchestrator
    │                                     │       └─ heal succeeds → SessionLog row { is_healed: true,
    │                                     │           original_strategy, original_selector,
    │                                     │           healed_strategy, healed_selector, ... }
    │                                     │           └─ Regression hook: check SelectorState;
    │                                     │              flip pending/resolved → active if found
    │                                     │
    │                                     ▼
    │                                  SelectorState (lifecycle table)
    │                                     ▲
    │                                     │ write
    │                                     │
Dashboard frontend                        │
    │                                     │
    │  POST /healing/selector/state ──────┤  mute / unmute / mark_fixed actions
    │  GET  /healing/hotspots             │  status filter applied
    │  GET  /healing/state/muted          │
    │                                     │
    │       ◀───── socket events ─────────┤  SELECTOR_FIXED / RESOLVED / CANCELLED /
    │                                     │  REGRESSED / MUTED / UNMUTED / PROGRESS
    │                                     │
    │                                     │
                                          ▲
                                          │  promote pending → resolved
                                          │
                                       SelectorVerificationJob
                                       (every 15 min via node-schedule)
```

### What's added (4 things)

| Thing | Where | Purpose |
|---|---|---|
| Two columns on `SessionLog` | `prisma/schema.prisma` | Capture strategy on every `findElement`/`findElements` and on every heal |
| New `SelectorState` table | `prisma/schema.prisma` | One row per (strategy, value) tuple that's been muted or marked-fixed |
| `SelectorStateService` | `src/services/SelectorStateService.ts` (new) | Encapsulates state transitions and emits socket events |
| `SelectorVerificationJob` | `src/services/SelectorVerificationJob.ts` (new) | Periodic background promoter from Pending → Resolved |

### What's modified (5 things)

| Modified | File:line | Change |
|---|---|---|
| Heal-event log entry | `src/dashboard/event-manager.ts:393` | Add `original_strategy`, `healed_strategy`; populate selector/strategy on every findElement (Smart Passive) |
| Heal info passthrough | `src/interceptors/CommandInterceptor.ts:609` | Pass `originalStrategy: args[0]` and `healedStrategy` to event manager |
| `HealingResult` shape | `src/services/healing/...` | Add optional `recommendedStrategy?: string` for tier providers to populate |
| Hotspot aggregator | `src/app/routers/dashboard.ts:351` | Group by `(strategy, value)` tuple; left-join `SelectorState`; filter by `status` query param |
| `/healing/hotspots/violations` and `/healing/digest` | (callers of aggregator) | Inherit muted/pending/resolved exclusion automatically — **CI gate behavior change**, see Rollout |

### What's added in API

Three new endpoints, one extension:

- `GET /healing/hotspots?status=active|pending|resolved` — extension of existing endpoint
- `POST /healing/selector/state` — new; mute / unmute / mark_fixed actions
- `GET /healing/state/muted` — new; list muted selectors with metadata
- `GET /healing/state/:strategy/:value` — new; fetch state for a single tuple

### What's added in frontend

Tab navigation on `/selector-health` (Active / Pending / Resolved / Muted), strategy-aware row rendering, multi-language copy chevron with localStorage memory, Pending progress indicator, regression banner, live tab transitions via socket events.

---

## 4. Schema changes

### 4.1 SessionLog: two new nullable columns

`prisma/schema.prisma:63` (`SessionLog` model):

```prisma
model SessionLog {
  // ... existing fields ...
  is_healed          Boolean  @default(false)
  original_selector  String?
  healed_selector    String?
  healing_confidence Float?
  healing_tier       String?
  // NEW columns:
  original_strategy  String?  // 'xpath' | 'accessibility id' | 'id' | etc.
  healed_strategy    String?  // strategy of the healed locator (mirrors healed_selector)
  // ... existing fields ...
}
```

Both nullable. Historical rows keep `null` for these columns; the aggregator handles `null` as a sentinel "(unknown strategy)" bucket. They naturally age out of any dashboard `windowDays` query.

### 4.2 New composite index on SessionLog

The verification job's hot query filters by `(original_strategy, original_selector)` plus a `createdAt` range. Add:

```prisma
@@index([original_strategy, original_selector, createdAt])
```

This is the index of record for verification; without it, the query becomes a table scan as `SessionLog` grows. Add in the same migration as the column additions.

### 4.3 New SelectorState entity

```prisma
model SelectorState {
  id                 String   @id @default(uuid())
  original_strategy  String
  original_selector  String
  status             String   // 'active' | 'pending' | 'resolved' | 'muted'
  fixed_at           DateTime?
  fixed_by_api_key   String?  // audit trail (FK to ApiKey.id; not enforced)
  resolved_at        DateTime?
  muted_at           DateTime?
  muted_by_api_key   String?
  regression_count   Int      @default(0)
  clean_builds_count Int      @default(0)  // updated by verifier; Phase 1 progress UI source
  last_event_at      DateTime @default(now())
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([original_strategy, original_selector])
  @@index([status])
  @@index([fixed_at])
}
```

**Design notes:**

- **`@@unique([original_strategy, original_selector])`** enforces the (Strategy, Value) tuple identity — the design's load-bearing decision (see §5). Two rows for the same selector value with different strategies are *separate* states.
- **`status = 'active'`** is allowed even though the default-active state is "no row." Once a row exists (e.g., regression after Resolved), it persists with `status = 'active'` so we can keep `regression_count` history. The aggregator filter treats "no row" and "row with status=active" identically.
- **`clean_builds_count`** is the verifier's working state, surfaced to the UI as "1/3" or "2/3" progress. Updated on every verifier run; reset to 0 on regression and on every `Mark as Fixed`.
- **No `team_id`** for Phase 1; can be added later by allowing `null` for legacy rows and bringing the unique constraint to `(team_id, strategy, selector)`.

### 4.4 Migration

```bash
npm run db:generate   # creates the migration
npm run db:migrate    # applies it
```

The migration is purely additive: two nullable columns on an existing table, one new table, one new index. No backfill required.

---

## 5. State machine

### 5.1 The four states

| State | Storage | Meaning | UI placement | CI gate / digest |
|---|---|---|---|---|
| **Active** | No row, OR row with `status = 'active'` | Heals coming in; default | Hotspot table (default tab) | Counts toward violations / digest |
| **Pending** | Row with `status = 'pending'`, `fixed_at != null` | User claims fix; awaiting 3 clean CI builds | "Pending Verification" tab | Excluded |
| **Resolved** | Row with `status = 'resolved'`, `resolved_at != null` | 3 clean builds confirmed | "Resolved" tab | Excluded |
| **Muted** | Row with `status = 'muted'`, `muted_at != null` | User silenced this | "Muted" view | Excluded |

### 5.2 Transitions

```
                                 [Mark as Fixed]
                  ┌──── Active ─────────────────────► Pending
                  │      │ ▲                              │
   [Unmute]       │      │ │ [heal arrives —              │ [verifier:
   (delete row    │ [Mute]│ │  regression_count++]        │  3 clean
    if no history)│      │ │                              │  build_ids]
                  │      ▼ │                              ▼
                Muted ◄───┴──────[heal arrives]──────  Resolved
                   ▲                                       │
                   │  [Mute]                               │
                   └───────────────────────────────────────┘
```

| From | Trigger | To | Side effects |
|---|---|---|---|
| Active (no row) | UI: Mark as Fixed | Pending | upsert; `fixed_at = now`, `fixed_by_api_key` set, `clean_builds_count = 0` |
| Active (row exists) | UI: Mark as Fixed | Pending | update; `fixed_at = now`, clear `resolved_at`, `clean_builds_count = 0` |
| Active | UI: Mute | Muted | upsert; `muted_at = now`, `muted_by_api_key` set |
| Pending | Background verifier sees 3 clean builds | Resolved | `resolved_at = now`; emit `SELECTOR_RESOLVED` |
| Pending | UI: Cancel verification | Active | clear `fixed_at`, `clean_builds_count = 0`; if no other history → delete row; emit `SELECTOR_CANCELLED` |
| Pending | Heal write hook | Active | `regression_count++`, clear `fixed_at`, `clean_builds_count = 0`; emit `SELECTOR_REGRESSED` |
| Resolved | Heal write hook | Active | same as above; also clear `resolved_at` |
| Resolved | UI: Mute | Muted | preserve `resolved_at` for history; set `muted_at = now` |
| Pending | UI: Mute | Muted | preserve `fixed_at`; set `muted_at = now` |
| Muted | UI: Unmute | Active | if no other history (regression_count=0, fixed_at=null, resolved_at=null) → delete row; else clear `muted_at`, set `status = 'active'` |
| Muted | Heal arrives | (no state change) | `SessionLog` row written normally; aggregator filter excludes from default response |

### 5.3 Verification logic (Pending → Resolved)

The verifier runs every 15 minutes via `node-schedule`. For each row with `status = 'pending'`:

```sql
-- Per-build heal status: did ANY findElement for this selector heal in this build?
SELECT s.build_id, MAX(CASE WHEN sl.is_healed THEN 1 ELSE 0 END) AS healed_in_build
FROM session_log sl
JOIN session s ON sl.session_id = s.id
WHERE sl.original_strategy = $1
  AND sl.original_selector = $2
  AND sl.command_name IN ('findElement', 'findElements')
  AND sl.createdAt >= $fixed_at
  AND s.build_id IS NOT NULL
GROUP BY s.build_id
```

Implemented via `prisma.$queryRaw` for memory efficiency — returns one row per `build_id` rather than one row per heal.

Count rows where `healed_in_build = 0`. If `>= 3`, promote to Resolved. Update `clean_builds_count` on the row regardless of threshold (so the UI can show "1/3", "2/3" progress).

**Two important behaviors of this query:**

1. Sessions without `build_id` (manual / ad-hoc local runs) are excluded. Verification depends on CI confidence, not casual local runs. Surfaced in UI as a tooltip.
2. The query uses `original_strategy + original_selector` together. The strategy-aware separation from §4 is preserved end-to-end.

### 5.4 Regression hook (Pending/Resolved → Active)

After every successful `prisma.sessionLog.create()` with `is_healed = true` (in `event-manager.ts` immediately after line 481), call:

```ts
if (logEntry.is_healed && logEntry.original_strategy && logEntry.original_selector) {
  Container.get(SelectorStateService).onHealRecorded({
    strategy: logEntry.original_strategy,
    selector: logEntry.original_selector,
  }).catch(err => log.warn(`[SelectorState] regression hook failed: ${err.message}`));
}
```

`SelectorStateService.onHealRecorded()`:
1. Look up `SelectorState` by `(strategy, selector)`. If not found → no-op.
2. If `status` is `pending` or `resolved`:
   - Set `status = 'active'`, clear `fixed_at` and `resolved_at`, increment `regression_count`, reset `clean_builds_count = 0`.
   - Emit `SELECTOR_REGRESSED` socket event with the new state.
3. If `status` is `muted` or `active` → no-op.

Fire-and-forget: a failure in the state lookup must never break the heal write.

### 5.5 Edge cases

| Case | Behavior |
|---|---|
| User clicks Mark as Fixed twice in a row | Idempotent: second click resets `fixed_at = now`, `clean_builds_count = 0`. Verification window restarts. |
| User clicks Mark as Fixed on a Muted selector | UI greys out the button; tooltip says "Unmute first." API rejects with 409 if attempted directly. |
| Verifier promotes to Resolved while user is mid-Mute | Last-write-wins via DB updatedAt; mute overrides. Acceptable for Phase 1 (no optimistic locking). |
| Selector heals only as `findElements` (plural), never `findElement` | Both command names are tracked together in the verifier query — verification works the same. |
| Selector ages out of `windowDays` window after `fixed_at` | `SelectorState` persists forever (the `windowDays` filter is read-side only on the aggregator). Verification continues to find evidence on the new `original_*` columns regardless of age. |
| Heal happens but `original_strategy` is null (legacy log row, unlikely going forward) | Regression hook skips (guarded by the `&& logEntry.original_strategy && logEntry.original_selector` check). |
| Multiple regressions in flight (heal during verifier run) | Idempotent: verifier reads pending → query → update. If a regression happened in between, the verifier's update is harmless since the row's status is already `active`; alternatively, scope the update to `WHERE status = 'pending'`. Phase 1 trusts last-write-wins. |

---

## 6. Read / write paths — concrete changes

### 6.1 Smart Passive instrumentation

**Location**: `src/dashboard/event-manager.ts` — modify the `logEntry` construction around line 393 and the heal-info passthrough.

**Diff sketch**:

```ts
const logEntry: any = {
  // ... existing fields unchanged ...
  is_healed:          !!healingInfo,
  original_selector:  healingInfo?.originalSelector ?? null,  // changed: || → ??
  healed_selector:    healingInfo?.healedSelector   ?? null,
  healing_confidence: healingInfo?.confidence       ?? null,
  healing_tier:       healingTierLabel(healingInfo?.tier),

  // NEW columns from healing path:
  original_strategy:  healingInfo?.originalStrategy ?? null,
  healed_strategy:    healingInfo?.healedStrategy   ?? null,
};

// NEW — Smart Passive: populate strategy/selector for every findElement, even non-heals.
// CommandInterceptor synthesizes request.body = args (the array [strategy, value]).
if ((commandName === 'findElement' || commandName === 'findElements') &&
    Array.isArray(request.body)) {
  logEntry.original_strategy ??= request.body[0] ?? null;
  logEntry.original_selector ??= request.body[1] ?? null;
}
```

**Why `??=` not `||=`**: empty strings are valid (rare) selector values; `||` would silently null them. `??=` only fills in actual `null`/`undefined`.

**Cost on the write path**: two extra string columns per `findElement` row. Typical selector length 20–80 chars; row width grows by ~0.05–0.16 KB per findElement. For a ~200-command session this is ~10–32 KB of DB volume — negligible.

### 6.2 Strategy passthrough on the heal path

**Location**: `src/interceptors/CommandInterceptor.ts:609` (`logHealingEvent`).

**Diff sketch**:

```ts
private async logHealingEvent(
  sessionId: string, commandName: string, driver: any, args: any[], healed: any,
) {
  await DASHBORD_EVENT_MANAGER.afterSessionCommand(
    sessionId, commandName, driver,
    { body: args, method: 'POST', path: `/${commandName}`, originalUrl: `/${commandName}` } as any,
    {} as any,
    JSON.stringify({ value: { ELEMENT: healed.id }, sessionId }),
    {
      originalSelector: args[1],
      originalStrategy: args[0],                       // NEW (always known from caller)
      healedSelector:   healed.recommendedSelector,
      healedStrategy:   healed.recommendedStrategy ?? args[0],  // NEW; same-strategy fallback
      confidence:       healed.confidence,
      tier:             healed.tier,
    },
  );
}
```

**`HealingResult` extension**: add `recommendedStrategy?: string` to the type; each tier provider populates it where known:

| Tier | `recommendedStrategy` value |
|---|---|
| Native (retry) | same as input strategy |
| Resilio / Fuzzy XML | `'xpath'` (these tiers produce XPath-shaped locators) |
| OCR | `'xenon:visual'` (sentinel; coordinate-based) |
| Visual AI | `'xenon:visual'` |
| LLM | the strategy from the LLM's structured response (typically `'accessibility id'`, `'xpath'`, or `'id'`) |
| Unknown / older provider | `undefined` → falls back to `args[0]` in passthrough |

### 6.3 Regression hook

**Location**: `src/dashboard/event-manager.ts` — immediately after `prisma.sessionLog.create()` succeeds at line 481.

```ts
const persistedLog = await prisma.sessionLog.create({ data: logEntry as SessionLog });

// ... existing socket emit for HEALING_EVENT ...

if (logEntry.is_healed && logEntry.original_strategy && logEntry.original_selector) {
  // Fire-and-forget; never block heal write on state lookup
  Container.get(SelectorStateService).onHealRecorded({
    strategy:  logEntry.original_strategy,
    selector:  logEntry.original_selector,
    sessionId: session.getId(),
  }).catch(err => log.warn(`[SelectorState] regression hook failed: ${err.message}`));
}
```

`SelectorStateService` is a new TypeDI `@Service()` class with method:

```ts
async onHealRecorded(opts: { strategy: string; selector: string; sessionId: string }): Promise<void>
```

See §10 for the full service shape.

### 6.4 Aggregator extension

**Location**: `src/app/routers/dashboard.ts:351` — `aggregateHotspots()`.

**Two changes**:

1. **Group key becomes the tuple**. Replace line 402's `const key = r.original_selector!` with a null-delimited composite:

   ```ts
   const key = `${r.original_strategy ?? ''}\x00${r.original_selector!}`;
   ```

   Each `HotspotRow` carries both `originalStrategy` and `originalSelector` in its output.

2. **Overlay `SelectorState`** after the existing in-memory aggregation, then filter by `status`:

   ```ts
   // After the existing scan + bucket + sort + slice produces `topHotspots`:
   const states = await prisma.selectorState.findMany({
     where: {
       OR: topHotspots.map(h => ({
         original_strategy: h.originalStrategy,
         original_selector: h.originalSelector,
       })),
     },
   });
   const stateMap = new Map(
     states.map(s => [`${s.original_strategy}\x00${s.original_selector}`, s]),
   );

   const filtered = topHotspots
     .map(h => ({
       ...h,
       state: stateMap.get(`${h.originalStrategy}\x00${h.originalSelector}`) ?? null,
     }))
     .filter(h => filterByStatus(h.state, opts.status ?? 'active'));
   ```

   `filterByStatus(state, requested)`:
   - `'active'` (default): keep if `state == null` OR `state.status === 'active'`
   - `'pending'`: keep if `state?.status === 'pending'`
   - `'resolved'`: keep if `state?.status === 'resolved'`
   - `'all'`: keep everything (used only by detail page lookups)

The webhook digest endpoint (`POST /healing/digest/send`) and CI gate (`/healing/hotspots/violations`) both call `aggregateHotspots()` without an explicit `status` filter. The default `status = 'active'` means **muted/pending/resolved selectors automatically disappear from CI gate violations and digest content** — see Rollout for behavior change call-out.

### 6.5 New API endpoints

**`POST /healing/selector/state`** — apply a state action.

```
Request body:
{
  "original_strategy": "accessibility id",
  "original_selector": "login-btn",
  "action": "mark_fixed" | "mute" | "unmute" | "cancel_verification"
}

Response 200:
{
  "state": {
    "original_strategy": "accessibility id",
    "original_selector": "login-btn",
    "status": "pending",
    "fixed_at": "2026-04-25T14:30:00Z",
    "fixed_by_api_key": "ak_abc123",
    "resolved_at": null,
    "muted_at": null,
    "regression_count": 0,
    "clean_builds_count": 0,
    "updatedAt": "2026-04-25T14:30:00Z"
  }
}

Response 409: action conflicts with current state (e.g., mark_fixed on muted selector)
{
  "error": "Cannot mark muted selector as fixed. Unmute first.",
  "currentStatus": "muted"
}
```

Auth: `scopeGuard(['admin'])`. Idempotent (calling `mute` on already-muted is a 200 no-op).

Side effects: emits the appropriate socket event (`SELECTOR_FIXED`, `SELECTOR_MUTED`, `SELECTOR_UNMUTED`, or `SELECTOR_CANCELLED`). `cancel_verification` is only valid from `pending` state; returns 409 from any other state.

**`GET /healing/state/muted?limit=&offset=`** — list muted selectors.

```
Response 200:
{
  "muted": [
    {
      "original_strategy": "xpath",
      "original_selector": "//button[contains(@text, 'OK')]",
      "muted_at": "2026-04-11T10:00:00Z",
      "muted_by_api_key": "ak_alice",
      "last_healed_at": "2026-04-07T09:42:00Z",
      "heal_count_before_mute": 7,
      "regression_count": 0
    }
  ],
  "total": 12,
  "limit": 50,
  "offset": 0
}
```

Auth: existing dashboard read scope. Sourced from `SelectorState` directly (not the aggregator), with a small join to the most recent matching `SessionLog` row for `last_healed_at`.

**`GET /healing/state/:strategy/:value`** — single-tuple state lookup. URL-encode strategy and value. Used by the detail page to render the state header. Auth: existing dashboard read scope.

**`GET /healing/hotspots?status=active|pending|resolved`** — extension of existing endpoint. Already documented above; backward-compatible (default `active` matches existing behavior).

---

## 7. Frontend & UX

All changes live in `web/src/components/selector-health/` and `web/src/api-service/index.ts`.

### 7.1 Tab navigation

Above the existing hotspot table on `/selector-health`:

```
[ Active 12 ⚡ ]  [ Pending 3 ⏳ ]  [ Resolved 47 ✅ ]  [ Muted 2 🔇 ]
```

- Counts update in real time from socket events.
- URL persists tab via `?tab=pending`. Default = Active.
- Same `SelectorHealthPage` component renders all four with branching on the `tab` param. No new top-level page.
- Active is the only tab with the existing KPI strip + filters; other tabs hide irrelevant filters and show their own subtitle copy.

### 7.2 Active row (extended)

```
#1  XPath: //button[@id="login-btn"]                              [⋯]
    ↻ Healed 14× / 8 sessions • Top tier: LLM • Conf 87%
    Last healed 2h ago • $0.56 LLM cost

    ┌─ Suggested rewrite (85% match) ─────────────────────────────┐
    │ Accessibility ID: login-btn                                  │
    │                                                              │
    │ [ Copy as JS ▾ ]   [ Mark as Fixed ]   [ Mute ]              │
    └──────────────────────────────────────────────────────────────┘
```

**Strategy formatter** — small client-side constant:

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
// Fallback: show strategy verbatim if unmapped.
```

Rows where `original_strategy` is `null` (legacy heals before Smart Passive) display "(unknown strategy)" in muted text.

### 7.3 Multi-language copy chevron + localStorage

**First-time experience** — first chevron click opens:

```
┌─ Choose your default copy language ────────────────────────────┐
│ Snippets will be copied in this language until you change it.  │
│                                                                │
│   ◉ JavaScript (WebdriverIO)   ← preselected default          │
│   ◯ Java (Appium-Java)                                         │
│   ◯ Python (Appium-Python)                                     │
│   ◯ C# (.NET)                                                  │
│   ◯ Ruby                                                       │
│                                                                │
│   ☑ Remember my choice                                          │
│                                                                │
│           [ Cancel ]   [ Copy as JavaScript ]                  │
└────────────────────────────────────────────────────────────────┘
```

On confirm: clipboard receives the snippet, `localStorage.xenon.copyLang = 'javascript'` is set. Button label across the page becomes `[ Copy as JS ▾ ]` and a direct click copies in the chosen language. Chevron still opens the modal anytime to switch.

If "Remember my choice" is unchecked, behaves like a one-shot (ask again next time).

**Snippet generator** — pure client-side string interpolation in `web/src/utils/snippet-generator.ts`:

```ts
type Language = 'javascript' | 'java' | 'python' | 'csharp' | 'ruby';

const SNIPPETS: Record<Language, Record<string, (v: string) => string>> = {
  javascript: {
    'accessibility id': (v) => `await driver.findElement('accessibility id', '${v}')`,
    'xpath':            (v) => `await driver.findElement('xpath', '${v}')`,
    'id':               (v) => `await driver.findElement('id', '${v}')`,
    // ... and remaining strategies
  },
  java: {
    'accessibility id': (v) => `driver.findElement(AppiumBy.accessibilityId("${v}"))`,
    'xpath':            (v) => `driver.findElement(AppiumBy.xpath("${v}"))`,
    // ...
  },
  python: {
    'accessibility id': (v) => `driver.find_element(AppiumBy.ACCESSIBILITY_ID, '${v}')`,
    'xpath':            (v) => `driver.find_element(AppiumBy.XPATH, '${v}')`,
    // ...
  },
  // csharp, ruby
};

export function snippet(lang: Language, strategy: string, value: string): string {
  const tmpl = SNIPPETS[lang]?.[strategy];
  if (!tmpl) return `${strategy}: ${value}`;  // fallback for xenon:visual etc.
  return tmpl(escapeForLanguage(lang, value));
}
```

`escapeForLanguage` handles single/double quotes, backslashes, newlines per language conventions.

**Special case — `xenon:visual` strategy**: no portable Appium snippet exists. Copy button greys out with tooltip:
> *Visual AI heals are coordinate-based — no standard locator exists. Use the snapshot in detail view to find a stable native locator.*

### 7.4 Pending row + Progress Indicator

```
#1  Accessibility ID: login-btn                                    [⋯]
    ⏳ Marked fixed 5h ago by alice@team • Verifying...

    ┌─ Verification Progress ─────────────────────────────────────┐
    │  ●━━━━━●━━━━━○                                               │
    │  1     2     3   clean builds                                │
    │  ✅ #4521 (3h ago)   ✅ #4528 (1h ago)   ⏳ awaiting next    │
    │                                                              │
    │  ℹ Only CI builds with build_id count. Local runs don't     │
    │    move this forward.                                        │
    └──────────────────────────────────────────────────────────────┘

    [ Cancel verification ]   [ View detail ]
```

Progress data:
- `clean_builds_count` from `SelectorState`, served by `GET /healing/hotspots?status=pending`
- Recent clean `build_id`s (top 3) joined from a small lookup
- Live updates via new socket event `SELECTOR_PROGRESS` emitted by the verifier on every increment

`[ Cancel verification ]`: confirm prompt → `POST /healing/selector/state { action: 'cancel_verification' }` (reverts to Active: deletes the row if no other history; otherwise sets `status = 'active'`, clears `fixed_at` and `clean_builds_count`).

### 7.5 Resolved row

```
#1  Accessibility ID: login-btn                                    [⋯]
    ✅ Resolved 3 days ago • 5 clean builds since fix
    Was healing 14× / 8 sessions before fix • Saved $0.56 / mo (est)

    Marked fixed 5d ago by alice@team • Verified 3d ago
    Regression count: 0

    [ Mute ]   [ View detail ]
```

Cost saving estimate = (previous heal rate × tier cost) projected over time-since-resolved. Reuses existing cost-engine data.

If `regression_count > 0`, badge `🟡 Previously regressed N×` near title. Subtle but persistent — institutional memory.

### 7.6 Muted view

Different layout — sourced from `GET /healing/state/muted` (not the aggregator):

```
🔇 Muted Selectors                                  [ Sort: muted ▾ ]

XPath: //button[contains(@text, 'OK')]
   Muted 2w ago by alice@team
   Last healed 18d ago • 7 heals total before mute
   [ Unmute ]

Accessibility ID: legacy-deprecated-btn
   Muted 3d ago by you
   Never healed (pre-emptively muted)
   [ Unmute ]
```

No suggested-rewrite UI on muted rows — the user has decided to ignore them. Don't tempt them.

### 7.7 Regression Banner

Three surfaces, in order of prominence:

**1. Top-of-page toast banner** (driven by `SELECTOR_REGRESSED` socket event):

```
┌────────────────────────────────────────────────────────────────┐
│ 🔄 A previously-Fixed selector regressed                       │
│    Accessibility ID: login-btn — was Resolved 3d ago,          │
│    healed 1× just now.   [ Show in Active → ]   [ Dismiss ✕ ]  │
└────────────────────────────────────────────────────────────────┘
```

Auto-fades after 30s if undismissed. Multiple regressions in a 5-minute window aggregate to:
> "3 selectors have regressed in the last 5 minutes — [ Show all → ]"

**2. Inline row treatment** in Active for 24 hours after regression event:

```
#1  🔄 Accessibility ID: login-btn                                [⋯]
    Regression — was Resolved 3d ago • Now healing again
    ↻ Healed 1× just now • Top tier: LLM

    Did the rewrite get reverted, or did the app change again?

    [ Copy as JS ▾ ]   [ Mark as Fixed again ]   [ Mute ]
```

The 🔄 icon stays for 24h; the `regression_count` badge persists forever.

**3. Detail page**: state-history timeline shows fixed_at, build clean events, resolved_at, regressions interleaved chronologically.

### 7.8 Live tab transitions

| Event | Animation | Toast |
|---|---|---|
| `SELECTOR_FIXED` | Row slides up out of Active, into top of Pending | "Marked fixed. Watching for clean builds." |
| `SELECTOR_RESOLVED` | Row slides up out of Pending, into Resolved | "✅ {label} resolved — 3 clean builds confirmed." |
| `SELECTOR_REGRESSED` | Row slides out of Pending/Resolved, into Active with 🔄 styling | (banner; see §7.7) |
| `SELECTOR_CANCELLED` | Row slides out of Pending into Active | "Verification cancelled." |
| `SELECTOR_MUTED` | Row slides out of current tab into Muted | "Muted {label}." |
| `SELECTOR_UNMUTED` | Row slides out of Muted into Active | "Unmuted." |
| `SELECTOR_PROGRESS` | Pending dot fills (1/3 → 2/3 → 3/3) | (none) |

If user is on Pending when a row resolves, row briefly highlights green before transitioning to a "moved to Resolved" stub link, then disappears after 5s. Avoids the "where did it go?" moment.

### 7.9 KPI strip addition

One new tile on the existing KPI strip:

```
✅ Resolved (last 30d):  N selectors    │   ⏳ Pending:  M
```

Sourced from `count(SelectorState where status='resolved' and resolved_at >= since)`. No new aggregator work.

### 7.10 Detail page changes

URL gains `strategy` param: `/selector-health/detail?strategy=accessibility%20id&value=login-btn&windowDays=30`.

Backward compat: if `strategy` missing, server falls back to "show all strategies for this value" with a banner offering filter links. No broken bookmarks.

Detail page additions:
- **State header** at top: large badge (Active / Pending / Resolved / Muted) + action button row
- **Verification log** below the existing heal timeline: state transition events (fixed_at, build clean events, resolved_at, regressions) interleaved chronologically
- **Regression count + last regression date** in the metadata strip if `regression_count > 0`

### 7.11 Empty states

| Tab | Copy |
|---|---|
| No Active | "🎉 No hot selectors. Your suite is healthy." |
| No Pending | "Nothing pending. When you fix a selector in source and click Mark as Fixed, it'll show here while we watch for 3 clean builds." |
| No Resolved | "No selectors resolved yet. Fix a hot one and Xenon will track its verification here." |
| No Muted | "Nothing muted. If a selector is intentionally brittle, hit Mute on its row to keep the Hotspot list signal-rich." |

### 7.12 Auth surface in UI

Mark as Fixed / Mute / Unmute / Cancel buttons require `admin` scope. For non-admin users, buttons render disabled with tooltip:
> *Requires admin scope. Ask your team admin or update your API key.*

Read-only viewers can still see all data.

---

## 8. Error handling

Fail soft, never block the heal write path:

| Failure | Recovery | Surface |
|---|---|---|
| Smart Passive can't parse `request.body` (not array, missing args) | Skip — leave columns null. Heal write proceeds. | Warn log `[SmartPassive] could not extract selector for ${commandName}`; counter `xenon_smart_passive_skip_total` |
| Regression hook crashes (e.g., DB blip) | `.catch()` swallows; heal write committed; state stays stale until next event | Warn log; never bubbles |
| Verifier job iteration fails on one selector | Skip that selector, continue with rest. Next 15-min run retries. | Error log per skip; alert if 3 consecutive runs fail entirely |
| Verifier query times out | 30s timeout wrapper; partial results discarded for that run | Error log + counter `xenon_verifier_timeout_total` |
| `POST /healing/selector/state` race (two clicks) | DB unique constraint on `(strategy, value)`; idempotent action handles duplicates | 200 returned; UI sees current state |
| Socket emit fails (no clients connected) | Existing `SocketServer.emitToDashboard` swallows | None — by design |
| Frontend optimistic UI fails (API errors) | Roll back local state change; show error toast with API message | Toast: "Couldn't mark as fixed — try again" |
| Frontend socket disconnects during long session | Existing reconnect logic in `useSocket`; on reconnect, refetch current tab's data fresh | Brief loading indicator |

**Heal-write invariant**: nothing the new code does can fail in a way that breaks heal logging. Every new hook is wrapped, every new query is in a separate transaction, every socket emit is best-effort.

---

## 9. Testing strategy

### 9.1 Unit tests (`test/unit/`)

| File | Coverage |
|---|---|
| `selector-state-service.spec.ts` | Every state transition (Active→Pending, Pending→Resolved, Pending→Active regression, Resolved→Active regression, Mute on each, Unmute, deletion when no history); idempotency; transition guards (Mark-as-Fixed on Muted should reject); race condition simulation |
| `selector-verification-job.spec.ts` | Clean-build counting with 0/1/2/3 clean builds; mixed builds with heals interleaved; builds with no `build_id` (excluded); `fixed_at` boundary correctness; `clean_builds_count` increment on every run |
| `aggregate-hotspots-tuple-key.spec.ts` | (Strategy, Value) tuple grouping; null strategy "(unknown)" bucket; status filter logic across all four states; mute exclusion in default response |
| `event-manager-smart-passive.spec.ts` | New `logEntry` construction across `findElement`, `findElements`, non-find commands, missing args, malformed body, heal path with `originalStrategy` set, fallback to args |
| `regression-hook.spec.ts` | Heal during pending → state flips to active, regression_count increments, socket emit fires; heal during muted → no state change; heal with null strategy → skip |

### 9.2 Integration tests (`test/integration/`)

- Real Prisma + SQLite: heal flow end-to-end with all new columns populated; state transitions persist across restarts
- Verifier job kicks → Pending row promotes to Resolved after 3 simulated CI builds inserted with proper `build_id`s
- New API endpoints: `POST /healing/selector/state` with each action (mark_fixed, mute, unmute); `GET /healing/state/muted`; `GET /healing/state/:strategy/:value`
- Aggregator returns correct results when SelectorState rows exist for a subset of hotspots

### 9.3 E2E tests (`test/e2e/`)

- **Full happy path**: heal → see in Active → click Mark as Fixed (mocked admin API key) → row moves to Pending → simulate 3 sessions in 3 distinct build_ids without heals → trigger verifier manually → row moves to Resolved
- **Regression scenario**: from Resolved, simulate a heal → row reappears in Active with `regression_count = 1`; banner socket event observed

### 9.4 Frontend tests (`web/src/`)

- One snapshot test per tab state on `selector-health-page.tsx`
- One unit test for snippet generator (each language × each strategy combination)
- One test for localStorage round-trip on copy language (set, persist, read back)
- One test for the regression banner debouncing logic (multiple events within 5 min → aggregated)

### 9.5 Migration test

- Run Prisma migration on a copy of a populated dev DB; verify no data loss; new columns null on existing rows
- Run `aggregateHotspots` against pre-migration data; verify "(unknown strategy)" bucket appears for legacy heals

---

## 10. Rollout

### 10.1 Sequence (single PR, but staged commits for clean review)

**Backend PR**:

1. **Commit 1**: Schema + migration only (additive — safe to merge in isolation; no behavior change).
2. **Commit 2**: Write-path changes — Smart Passive instrumentation, healing strategy passthrough, regression hook, `SelectorStateService`.
3. **Commit 3**: Aggregator extension + new endpoints (`POST /healing/selector/state`, `GET /healing/state/muted`, `GET /healing/state/:strategy/:value`, `?status=` query param on hotspots).
4. **Commit 4**: `SelectorVerificationJob` + new socket events.

**Frontend PR** (depends on backend deployed):

1. **Commit 1**: Tab nav + state-aware row rendering on Active tab.
2. **Commit 2**: Pending / Resolved / Muted tabs, including progress indicator.
3. **Commit 3**: Multi-language copy chevron + localStorage memory.
4. **Commit 4**: Regression banner + live tab transitions on socket events.

### 10.2 Smoke verification post-deploy

- Run any healing test on a real device; confirm `original_strategy` and `original_selector` populate on every `findElement` row, healed and not
- Click Mark as Fixed on a real hotspot; confirm row moves to Pending; confirm `SelectorState` row created with correct `fixed_at`
- Trigger 3 clean sessions in distinct build_ids; manually run `SelectorVerificationJob.run()`; confirm row promotes to Resolved; confirm `SELECTOR_RESOLVED` socket event observed
- Trigger a heal after Resolved; confirm row reverts to Active with `regression_count = 1`; confirm regression banner appears in dashboard

### 10.3 Backwards compatibility

| Caller | Effect |
|---|---|
| Existing `/healing/hotspots` consumers (frontend, custom scripts) | Default `status=active` filter — same behavior as today; muted/pending/resolved selectors disappear from response (the *desired* signal-cleaning effect) |
| **CI gate (`/healing/hotspots/violations`)** | **Same default filter — muted/pending/resolved selectors no longer count as violations.** *This is the headline behavior change.* Repos with actively-managed selectors will see CI pass/fail outcomes change after deploy. **Must be flagged in release notes.** |
| Webhook digest (`/healing/digest/send`) | Same default filter — digest content gets cleaner without code change |
| Existing `/healing/selector?value=X` detail page links | Continue to work; show all-strategies fallback view with banner offering filter links |

**No feature flag.** Changes are additive on the data model; the only behavior change at user-facing endpoints is the muted/pending/resolved default filtering, which is the *intent* of this work. A flag would just delay value with no risk reduction.

### 10.4 Monitoring (Prometheus metrics — extends `ProcessMetricsService`)

| Metric | Type | Labels | Purpose |
|---|---|---|---|
| `xenon_selector_state_total` | gauge | `status` (active/pending/resolved/muted) | Sampled every 60s; trend dashboard |
| `xenon_verifier_runs_total` | counter | `outcome` (success/partial_failure/timeout) | Verifier health |
| `xenon_verifier_promotion_total` | counter | — | Pending → Resolved increments |
| `xenon_regression_total` | counter | — | Pending/Resolved → Active increments |
| `xenon_smart_passive_skip_total` | counter | `command_name` | Smart Passive parse failures (debugging) |

These tie into the existing observability stack with no new infrastructure.

### 10.5 Documentation updates

- API docs: Swagger JSDoc on the three new handlers in `src/app/routers/dashboard.ts`
- README: one-paragraph addition to the "Self-Healing" section explaining the lifecycle and the CI gate behavior change
- Release notes call out the CI gate filtering change explicitly

---

## 11. Out of scope (Phase 2+)

Explicit list of things deliberately NOT in this design:

- **Auto-PR healed selectors to test repo source** — Phase 3+; requires repo connection, codemod per framework, GitHub App auth
- **IDE plugin (VS Code / IntelliJ)** — possibly Phase 2 as a complementary surface; Healenium-style PSI piggyback
- **Source-location resolution** (grep / AST / file:line) — depends on test repo connection, opted out for Phase 1
- **Team-scoped state** (per-team mute, per-team fix tracking) — schema is shaped for easy migration to multi-tenant later
- **Time-bounded mutes** ("mute for 30 days, then resurface") — Phase 2
- **Mute reasons** ("legacy / intentional / other") — adds friction, deferred
- **Email/Slack notifications** on Resolved or Regressed events — socket banner only in Phase 1; webhook subscribers are an obvious extension
- **"Linked siblings" view** for the same selector value across different strategies — Q4's Option C
- **"Unfix" / cancel-verification** with side-effects beyond simple revert — single Cancel button for now
- **Soft-undo** of Mark as Fixed via undo toast — not in Phase 1; user can re-trigger via row action

---

## 12. Open questions

None blocking. Two minor decisions deferred to implementation:

1. **Default copy language**: this design preselects WebdriverIO/JavaScript as the modal default. If the team's actual user base skews more Java (common in enterprise SDET), flip the default constant in `web/src/utils/snippet-generator.ts`.
2. **Verification job interval**: 15 minutes is a reasonable default. If users report Resolved promotions feeling slow on fast-moving CI pipelines, drop to 5 minutes (no migration needed).

---

## 13. Decisions log (from brainstorming)

This design embodies six explicit decisions made during brainstorming:

| Q | Decision | Rationale |
|---|---|---|
| Q1 | Suggestion-only on the dashboard (not auto-PR) | User's chosen scope; defers source-code automation to Phase 3+ |
| Q2 (revised) | Manual workflow — Xenon does not read test source | User explicitly opted out of repo connection / grep / file:line lookup |
| Q4 | (Strategy, Value) tuple identity | Avoids "Phantom Heals" where one strategy is fixed but the row stays alive; granular mute and verification |
| Q5 | Smart Passive (Option 4) — populate strategy/selector on every findElement | Exact verification signal without an SDK heartbeat; ~4 lines of write-path change |
| Q6 | Multi-language copy chevron + localStorage memory | Sweet spot between power-user speed and global compatibility; mixed teams supported |
| Q7 | Global perpetual mute (no time bound, no reason) | Phase 1 keeps mute friction-free; "if user says shut up, shut up" |
