# Performance figures for a node's phones: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a hub's session page shows CPU and memory, live, for sessions on a
node's phones, as it does for its own.

**Architecture:** a node samples its own phones with the existing sampler,
holds the figures in memory (`NodeMetricsStore`) and serves them at
`GET /xenon/api/node/sessions/:id/metrics?after=`. The hub's
`SessionMetricsService` runs a `NodeMetricsCollector`, a `MetricsSampler`
that asks the node every 10 s through the session's `RemoteSession`, in place
of a phone sampler. The service's existing buffer, writes and
`recordingState` carry the figures into the hub's `SessionMetric` table.

**Tech stack:** TypeScript 5.5, Express, TypeDI, Prisma (SQLite), Mocha,
Chai, Sinon, supertest.

**Spec:** `docs/superpowers/specs/2026-10-03-node-session-metrics-design.md`

## Global constraints

- Node 22.19 for every command (`source ~/.nvm/nvm.sh && nvm use 22.19.0`).
- Test first: write the test, watch it fail for the stated reason, then the
  code.
- Mocha hooks only inside a `describe`. Import `reflect-metadata` in every
  spec. A spec that touches the database uses `useScratchDatabase()`.
- Run one database spec with
  `npx mocha --require test/setup/scratch-default-database.js <file>`.
- The whole suite: `ANDROID_HOME=$HOME/Library/Android/sdk npm run test:all`.
- Never `eslint --fix`. Prettier only on files this branch creates. ESLint
  counts per changed file must not rise against main.
- Stage explicit paths only; never `temp-appium/*.json` or `.playwright-mcp/`.
- No UI text changes: the Performance panel's wording already covers
  "isn't recorded".
- Wire format: samples travel in `MetricSample` shape (`at`, `deviceCpuPct`,
  `deviceMemMb`, `deviceMemTotalMb`, `appCpuPct`, `appMemMb`, `appId`).
- Timings: the node keeps the newest 900 samples per session
  (`MAX_BUFFERED_SAMPLES`), and an ended session for 10 minutes
  (`KEEP_AFTER_END_MS`). The hub asks every 10 s (`COLLECT_INTERVAL_MS`) with
  a 5 s timeout, and asks a node without the route again after 10 minutes
  (`NODE_METRICS_RECHECK_MS`).

## Review Focus

1. **A slow node answer.** A 5 s answer must never overlap the next ask, or
   samples arrive twice. Task 4 tests it.
2. **A DELETE while the node is unreachable.** The final ask must time out
   and the delete must finish. Task 4 tests that `stop()` resolves on
   `unavailable`.
3. **A hub restart before any sample was stored.** `after` is null, so the
   hub asks for everything the node holds. Task 6 tests it.
4. **A node with `sessionMetrics: false`.** It must answer `off`, never hold
   samples, and the hub must stop asking. Task 3 tests it.
5. **A bad `?after=`.** Text or a negative must read as "none", never a
   crash or `NaN` filtering everything out. Task 2 tests it.

---

### Task 1: The node's in-memory store

**Files:**
- Create: `src/services/metrics/nodeMetrics.ts`
- Create: `src/services/metrics/NodeMetricsStore.ts`
- Test: `test/unit/node-metrics-store.spec.ts`

**Interfaces:**
- Produces:
  - `type NodeMetricsState = 'sampling' | 'stopped' | 'ended' | 'off'`
  - `interface NodeMetricsAnswer { platform: string; state: NodeMetricsState; samples: MetricSample[] }`
  - `NODE_METRICS_ROUTE = '/node/sessions/:sessionId/metrics'`
  - `NODE_METRICS_HEADER = 'x-xenon-node-metrics'`
  - `KEEP_AFTER_END_MS = 600_000`
  - `class NodeMetricsStore` (TypeDI `@Service()`) with `now: () => number`,
    `begin(sessionId, platform)`, `add(sessionId, sample)`,
    `gaveUp(sessionId)`, `end(sessionId)` and
    `read(sessionId, after: number | null): NodeMetricsAnswer`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/node-metrics-store.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import { NodeMetricsStore } from '../../src/services/metrics/NodeMetricsStore';
import { KEEP_AFTER_END_MS } from '../../src/services/metrics/nodeMetrics';
import { MAX_BUFFERED_SAMPLES, MetricSample } from '../../src/services/metrics/types';

const sample = (at: number): MetricSample => ({
  at,
  deviceCpuPct: 10,
  deviceMemMb: 100,
  deviceMemTotalMb: 4000,
  appCpuPct: null,
  appMemMb: null,
  appId: null,
});

describe('NodeMetricsStore: a node holds its figures for the hub', () => {
  let now: number;
  let store: NodeMetricsStore;

  beforeEach(() => {
    now = 1_000_000;
    store = new NodeMetricsStore();
    store.now = () => now;
  });

  it('answers every sample without `after`, and only newer ones with it', () => {
    store.begin('s1', 'Android');
    [1, 2, 3].forEach((t) => store.add('s1', sample(t)));

    expect(store.read('s1', null)).to.deep.equal({
      platform: 'android',
      state: 'sampling',
      samples: [sample(1), sample(2), sample(3)],
    });
    expect(store.read('s1', 2).samples.map((s) => s.at)).to.deep.equal([3]);
  });

  it('drops what the hub has collected', () => {
    store.begin('s1', 'android');
    [1, 2, 3].forEach((t) => store.add('s1', sample(t)));
    store.read('s1', 2);
    expect(store.read('s1', null).samples.map((s) => s.at)).to.deep.equal([3]);
  });

  it('keeps the newest 900 samples', () => {
    store.begin('s1', 'android');
    for (let t = 1; t <= MAX_BUFFERED_SAMPLES + 5; t++) store.add('s1', sample(t));
    const ats = store.read('s1', null).samples.map((s) => s.at);
    expect(ats).to.have.length(MAX_BUFFERED_SAMPLES);
    expect(ats[0]).to.equal(6);
  });

  it('says a sampler that gave up stopped, and an ended session ended', () => {
    store.begin('s1', 'android');
    store.gaveUp('s1');
    expect(store.read('s1', null).state).to.equal('stopped');
    store.end('s1');
    expect(store.read('s1', null).state).to.equal('ended');
  });

  it('keeps an ended session 10 minutes for the last collection, then forgets it', () => {
    store.begin('s1', 'android');
    store.add('s1', sample(1));
    store.end('s1');
    now += KEEP_AFTER_END_MS - 1;
    expect(store.read('s1', null).samples).to.have.length(1);
    now += 1;
    expect(store.read('s1', null)).to.deep.equal({ platform: '', state: 'off', samples: [] });
  });

  it('says off for a session it has nothing for', () => {
    expect(store.read('nope', null)).to.deep.equal({ platform: '', state: 'off', samples: [] });
    store.add('nope', sample(1));
    expect(store.read('nope', null).samples).to.deep.equal([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx mocha test/unit/node-metrics-store.spec.ts`
Expected: FAIL, `Cannot find module '../../src/services/metrics/NodeMetricsStore'`.

- [ ] **Step 3: Write `nodeMetrics.ts` and the store**

```ts
// src/services/metrics/nodeMetrics.ts
import type { MetricSample } from './types';

/**
 * A session's figures as a node holds them for its hub: it samples the
 * session (`sampling`), its sampler gave up (`stopped`), the session ended
 * here (`ended`), or the node has nothing for it (`off`).
 */
export type NodeMetricsState = 'sampling' | 'stopped' | 'ended' | 'off';

export interface NodeMetricsAnswer {
  platform: string;
  state: NodeMetricsState;
  samples: MetricSample[];
}

/** Where a node serves a session's figures, under `/xenon/api`. */
export const NODE_METRICS_ROUTE = '/node/sessions/:sessionId/metrics';
/** On every answer of that route, so a hub can tell a node that has it. */
export const NODE_METRICS_HEADER = 'x-xenon-node-metrics';
/** How long a node keeps an ended session's figures for its hub's last collection. */
export const KEEP_AFTER_END_MS = 10 * 60_000;
```

```ts
// src/services/metrics/NodeMetricsStore.ts
import { Service } from 'typedi';
import { KEEP_AFTER_END_MS, NodeMetricsAnswer, NodeMetricsState } from './nodeMetrics';
import { MAX_BUFFERED_SAMPLES, MetricSample } from './types';

interface Entry {
  platform: string;
  state: Exclude<NodeMetricsState, 'off'>;
  samples: MetricSample[];
  endedAt: number | null;
}

/**
 * On a node: each sampled session's CPU and memory, held in memory until the
 * hub collects them. A node has no Session row for a session its hub created,
 * so it can't write them to SessionMetric. The newest MAX_BUFFERED_SAMPLES per
 * session; what the hub has collected is dropped; an ended session is kept
 * KEEP_AFTER_END_MS, then forgotten, whether or not a hub asked.
 */
@Service()
export class NodeMetricsStore {
  now: () => number = () => Date.now();
  private readonly entries = new Map<string, Entry>();

  begin(sessionId: string, platform: string): void {
    this.prune();
    this.entries.set(sessionId, {
      platform: platform.toLowerCase(),
      state: 'sampling',
      samples: [],
      endedAt: null,
    });
  }

  add(sessionId: string, sample: MetricSample): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.samples.push(sample);
    const over = entry.samples.length - MAX_BUFFERED_SAMPLES;
    if (over > 0) entry.samples.splice(0, over);
  }

  gaveUp(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry && entry.state === 'sampling') entry.state = 'stopped';
  }

  end(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.state = 'ended';
    entry.endedAt = this.now();
  }

  /** The samples newer than `after` (all, without it). Those at or before it the hub has, so they go. */
  read(sessionId: string, after: number | null): NodeMetricsAnswer {
    this.prune();
    const entry = this.entries.get(sessionId);
    if (!entry) return { platform: '', state: 'off', samples: [] };
    if (after !== null) entry.samples = entry.samples.filter((s) => s.at > after);
    return { platform: entry.platform, state: entry.state, samples: entry.samples.slice() };
  }

  private prune(): void {
    const cutoff = this.now() - KEEP_AFTER_END_MS;
    for (const [id, entry] of this.entries) {
      if (entry.endedAt !== null && entry.endedAt <= cutoff) this.entries.delete(id);
    }
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx mocha test/unit/node-metrics-store.spec.ts`
Expected: PASS, 6 passing.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/services/metrics/nodeMetrics.ts src/services/metrics/NodeMetricsStore.ts test/unit/node-metrics-store.spec.ts
git add src/services/metrics/nodeMetrics.ts src/services/metrics/NodeMetricsStore.ts test/unit/node-metrics-store.spec.ts
git commit -m "feat(metrics): a node holds each session's figures in memory for its hub"
```

---

### Task 2: The node's route

**Files:**
- Modify: `src/gateway/nodeSessionStatus.ts` (extract the token check into `answerForHub`)
- Create: `src/gateway/nodeSessionMetrics.ts`
- Modify: `src/app/index.ts:236` (mount it beside `registerNodeSessionStatus`)
- Test: `test/unit/node-session-metrics-route.spec.ts`
- Regression: `test/unit/hub-remote-session-heartbeat.spec.ts`

**Interfaces:**
- Consumes: `NODE_METRICS_ROUTE`, `NODE_METRICS_HEADER`,
  `NodeMetricsAnswer` and `NodeMetricsStore` from Task 1.
- Produces:
  - `answerForHub(deps, req, res, sessionId, what, answer)` exported from
    `nodeSessionStatus.ts`;
  - `parseAfter(raw: unknown): number | null`;
  - `nodeSessionMetricsHandler(deps: NodeSessionMetricsDeps)`;
  - `registerNodeSessionMetrics(router, pluginArgs)`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/node-session-metrics-route.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import {
  nodeSessionMetricsHandler,
  parseAfter,
  registerNodeSessionMetrics,
} from '../../src/gateway/nodeSessionMetrics';
import { NODE_METRICS_HEADER, NodeMetricsAnswer } from '../../src/services/metrics/nodeMetrics';
import { HUB_TOKEN_HEADER } from '../../src/gateway/hubSessionToken';
import {
  COMMAND_AUTH_UNAVAILABLE_BODY,
  UNKNOWN_SESSION_BODY,
} from '../../src/middleware/commandAuth';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const ANSWER: NodeMetricsAnswer = { platform: 'android', state: 'sampling', samples: [] };

describe("a node's session metrics route", () => {
  let verify: sinon.SinonStub;
  let read: sinon.SinonStub;
  let enforced: boolean;

  const app = () => {
    const a = express();
    a.get(
      '/xenon/api/node/sessions/:sessionId/metrics',
      nodeSessionMetricsHandler({
        hubTokens: { verify },
        enforced: () => enforced,
        read,
        logger: quiet,
      }),
    );
    return a;
  };
  const get = (q = '') => request(app()).get(`/xenon/api/node/sessions/s1/metrics${q}`);

  beforeEach(() => {
    verify = sinon.stub();
    read = sinon.stub().returns(ANSWER);
    enforced = false;
  });
  afterEach(() => sinon.restore());

  it('answers the figures, with no credential when per-command auth is off', async () => {
    const res = await get('?after=1500');
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ value: ANSWER });
    expect(res.headers[NODE_METRICS_HEADER]).to.equal('1');
    expect(read.calledOnceWithExactly('s1', 1500)).to.equal(true);
  });

  it("with per-command auth on, answers only the hub's token for that session", async () => {
    enforced = true;
    verify.withArgs('good', 's1').resolves(true);
    verify.withArgs('other', 's1').resolves(false);

    const missing = await get();
    const wrong = await get().set(HUB_TOKEN_HEADER, 'other');
    const right = await get().set(HUB_TOKEN_HEADER, 'good');

    expect([missing.status, missing.body]).to.deep.equal([404, UNKNOWN_SESSION_BODY]);
    expect([wrong.status, wrong.body]).to.deep.equal([404, UNKNOWN_SESSION_BODY]);
    expect(right.status).to.equal(200);
    expect(read.calledOnce).to.equal(true);
    for (const r of [missing, wrong, right]) expect(r.headers[NODE_METRICS_HEADER]).to.equal('1');
  });

  it("answers 503 when it can't check the hub's token", async () => {
    enforced = true;
    verify.rejects(new Error('JWKS unreachable'));
    const res = await get().set(HUB_TOKEN_HEADER, 'good');
    expect([res.status, res.body]).to.deep.equal([503, COMMAND_AUTH_UNAVAILABLE_BODY]);
    expect(read.called).to.equal(false);
  });

  it('reads anything but a time as no `after`', () => {
    expect(parseAfter('1500')).to.equal(1500);
    expect(parseAfter('1500.5')).to.equal(1500.5);
    for (const bad of [undefined, '', 'abc', '-5', '1e3', ['1']]) {
      expect(parseAfter(bad), String(bad)).to.equal(null);
    }
  });

  it('exists only on a node', async () => {
    const mount = (hub?: string) => {
      const a = express();
      const r = express.Router();
      registerNodeSessionMetrics(r, { ...DefaultPluginArgs, hub } as any);
      a.use('/xenon/api', r);
      return a;
    };
    const onHub = await request(mount()).get('/xenon/api/node/sessions/s1/metrics');
    const onNode = await request(mount('http://127.0.0.1:1')).get(
      '/xenon/api/node/sessions/s1/metrics',
    );
    expect(onHub.status).to.equal(404);
    expect(onHub.headers[NODE_METRICS_HEADER]).to.equal(undefined);
    expect(onNode.headers[NODE_METRICS_HEADER]).to.equal('1');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx mocha test/unit/node-session-metrics-route.spec.ts`
Expected: FAIL, `Cannot find module '../../src/gateway/nodeSessionMetrics'`.

- [ ] **Step 3: Extract the token check from the status route**

In `src/gateway/nodeSessionStatus.ts`, add the `Request`/`Response` types to
the express import and replace the body of `nodeSessionStatusHandler` so both
routes share one check:

```ts
import type { Request, RequestHandler, Response, Router } from 'express';
```

```ts
/** What a node needs to answer its hub about a session. */
export interface HubAnswerDeps {
  hubTokens: HubTokenCheck;
  enforced: () => boolean;
  logger: GatewayLogger;
}

/**
 * Runs `answer` when the caller may know this session's state on the node:
 * always with per-command auth off, else only with the hub's session token
 * for it. Otherwise the unknown-session answer, or 503 when the token can't
 * be checked. `what` names the route in the log.
 */
export function answerForHub(
  deps: HubAnswerDeps,
  req: Request,
  res: Response,
  sessionId: string,
  what: string,
  answer: () => void,
): void {
  if (!deps.enforced()) return answer();

  const presented = req.headers[HUB_TOKEN_HEADER];
  const token = typeof presented === 'string' ? presented : undefined;
  if (token === undefined) {
    res.status(UNKNOWN_SESSION_STATUS).json(UNKNOWN_SESSION_BODY);
    return;
  }
  deps.hubTokens
    .verify(token, sessionId)
    .then((valid) => {
      if (valid) return answer();
      deps.logger.warn(`${what} for ${sessionId} refused: the hub token is not valid for it`);
      res.status(UNKNOWN_SESSION_STATUS).json(UNKNOWN_SESSION_BODY);
    })
    .catch((error) => {
      deps.logger.error(
        `${what} for ${sessionId} unavailable: hub token check failed: ${summarize(error)}`,
      );
      if (!res.headersSent) {
        res.status(COMMAND_AUTH_UNAVAILABLE_STATUS).json(COMMAND_AUTH_UNAVAILABLE_BODY);
      }
    });
}

export function nodeSessionStatusHandler(deps: NodeSessionStatusDeps): RequestHandler {
  return (req, res) => {
    res.setHeader(NODE_SESSION_STATUS_HEADER, '1');
    const sessionId = String(req.params?.sessionId ?? '');
    answerForHub(deps, req, res, sessionId, 'Session status', () =>
      res.status(200).json({ value: { sessionId, exists: deps.hasSession(sessionId) } }),
    );
  };
}
```

Make `NodeSessionStatusDeps` extend `HubAnswerDeps` and keep only
`hasSession` in it.

- [ ] **Step 4: Write the metrics route**

```ts
// src/gateway/nodeSessionMetrics.ts
import type { RequestHandler, Router } from 'express';
import { Container } from 'typedi';
import log from '../logger';
import { config } from '../config';
import type { IPluginArgs } from '../interfaces/IPluginArgs';
import { commandAuthEnabled } from '../middleware/commandAuth';
import {
  NODE_METRICS_HEADER,
  NODE_METRICS_ROUTE,
  NodeMetricsAnswer,
} from '../services/metrics/nodeMetrics';
import { NodeMetricsStore } from '../services/metrics/NodeMetricsStore';
import { HubSessionTokenVerifier } from './hubSessionToken';
import { HubAnswerDeps, answerForHub } from './nodeSessionStatus';

/**
 * A session's CPU and memory, asked by the hub of the node that runs it
 * (NodeMetricsCollector). The node samples its own phones and holds the
 * figures in memory (NodeMetricsStore), since it has no Session row for a
 * session the hub created. `?after=<ms>` asks for the samples newer than the
 * hub has; those it has are dropped. The samples name the app in use, so the
 * route asks what a command to the session asks, as the session-status route
 * does (answerForHub).
 */
export interface NodeSessionMetricsDeps extends HubAnswerDeps {
  read: (sessionId: string, after: number | null) => NodeMetricsAnswer;
}

/** `?after=`: a time in ms, else none. */
export function parseAfter(raw: unknown): number | null {
  return typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
}

export function nodeSessionMetricsHandler(deps: NodeSessionMetricsDeps): RequestHandler {
  return (req, res) => {
    res.setHeader(NODE_METRICS_HEADER, '1');
    const sessionId = String(req.params?.sessionId ?? '');
    answerForHub(deps, req, res, sessionId, 'Session metrics', () =>
      res.status(200).json({ value: deps.read(sessionId, parseAfter(req.query?.after)) }),
    );
  };
}

/** A node's route, ahead of its login, like the session-status route. A hub or standalone server has none. */
export function registerNodeSessionMetrics(router: Router, pluginArgs: IPluginArgs): void {
  if (pluginArgs.hub === undefined) return;
  router.get(
    NODE_METRICS_ROUTE,
    nodeSessionMetricsHandler({
      hubTokens: new HubSessionTokenVerifier(pluginArgs.hub),
      enforced: () => commandAuthEnabled() && config.authDisabled !== true,
      read: (sessionId, after) => Container.get(NodeMetricsStore).read(sessionId, after),
      logger: log.scope('NodeSessionMetrics'),
    }),
  );
}
```

In `src/app/index.ts`, import `registerNodeSessionMetrics` and call it on the
line after `registerNodeSessionStatus(apiRouter, pluginArgs);`:

```ts
  registerNodeSessionMetrics(apiRouter, pluginArgs);
```

- [ ] **Step 5: Run both specs and watch them pass**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/node-session-metrics-route.spec.ts test/unit/hub-remote-session-heartbeat.spec.ts`
Expected: PASS. The heartbeat spec is unchanged and still green.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/gateway/nodeSessionMetrics.ts test/unit/node-session-metrics-route.spec.ts
git add src/gateway/nodeSessionStatus.ts src/gateway/nodeSessionMetrics.ts src/app/index.ts test/unit/node-session-metrics-route.spec.ts
git commit -m "feat(node): GET /node/sessions/:id/metrics serves a session's figures to the hub"
```

---

### Task 3: A node samples the hub's sessions

**Files:**
- Modify: `src/services/metrics/SessionMetricsService.ts`
- Modify: `src/services/SessionLifecycleService.ts` (`finalizeSession` ~line 960, `deleteSession` finally ~line 1312, `stopSessionForShutdown` ~line 1447)
- Modify: `src/plugin.ts:137` (`onUnexpectedShutdown`)
- Test: `test/unit/session-metrics-service.spec.ts` (add cases)
- Test: `test/unit/session-metrics-lifecycle.spec.ts` (new)

**Interfaces:**
- Consumes: `NodeMetricsStore` from Task 1.
- Produces:
  - `SessionMetricsService.holdsForHub(): boolean` (protected): true on a
    node;
  - `nodeStore(): NodeMetricsStore` (protected seam).
  - On a node the service never writes `SessionMetric`. It calls
    `store.begin` at start, `store.add` for each sample, `store.gaveUp` and
    `store.end`.

- [ ] **Step 1: Write the failing service tests**

Add to `test/unit/session-metrics-service.spec.ts`. Give `TestMetrics` a
store seam:

```ts
class FakeStore {
  calls: string[] = [];
  begin(id: string, platform: string) {
    this.calls.push(`begin ${id} ${platform}`);
  }
  add(id: string, s: MetricSample) {
    this.calls.push(`add ${id} ${s.at}`);
  }
  gaveUp(id: string) {
    this.calls.push(`gaveUp ${id}`);
  }
  end(id: string) {
    this.calls.push(`end ${id}`);
  }
}
```

Inside `class TestMetrics`, add:

```ts
  store = new FakeStore();
  protected nodeStore(): any {
    return this.store;
  }
```

Then the cases, inside the existing `describe('SessionMetricsService')`:

```ts
  it('on a node, holds the figures for the hub instead of writing them', async () => {
    m.args = { hub: 'http://hub:4723' };
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    const hooks = m.samplers[0].hooks;
    [1, 2].forEach((t) => hooks.onSample(sample(t)));
    hooks.onGiveUp('adb gone');
    await clock.tickAsync(FLUSH_INTERVAL_MS * 2);
    await m.stop('s1');

    expect(m.written).to.deep.equal([]);
    expect(m.store.calls).to.deep.equal([
      'begin s1 android',
      'add s1 1',
      'add s1 2',
      'gaveUp s1',
      'end s1',
    ]);
    expect(m.samplers[0].stopped).to.equal(true);
  });

  it('on a node with sessionMetrics off, holds nothing', () => {
    m.args = { hub: 'http://hub:4723', sessionMetrics: false };
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    expect(m.samplers).to.have.length(0);
    expect(m.store.calls).to.deep.equal([]);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx mocha test/unit/session-metrics-service.spec.ts -g "on a node"`
Expected: FAIL. `written` holds `[1, 2]`, and the store has no calls.

- [ ] **Step 3: Hold for the hub on a node**

In `SessionMetricsService.ts`, import `NodeMetricsStore` and change
`Running` and `start`/`stop`:

```ts
interface Running {
  sampler: MetricsSampler;
  buffer: MetricSample[];
  /** None on a node, which holds samples for its hub instead of writing them. */
  flushTimer?: ReturnType<typeof setInterval>;
  /** Writes run one after another. */
  writing: Promise<void>;
  /** The sampler stopped itself after repeated failures. */
  gaveUp: boolean;
  /** On a node: the samples go to the NodeMetricsStore. */
  held: boolean;
}
```

```ts
  start({ sessionId, device, capabilities }: MetricsStart): void {
    if (this.running.has(sessionId) || !this.appliesTo(device)) return;
    // A node has no Session row for the hub's sessions, so it holds the
    // figures for its hub to collect (GET /node/sessions/:id/metrics).
    const held = this.holdsForHub();
    const store = held ? this.nodeStore() : null;
    const hooks: SamplerHooks = {
      onSample: (s) => {
        if (store) store.add(sessionId, s);
        else this.running.get(sessionId)?.buffer.push(s);
      },
      onGiveUp: (reason) => {
        const entry = this.running.get(sessionId);
        if (entry) entry.gaveUp = true;
        store?.gaveUp(sessionId);
        this.log.warn(`[${sessionId}] Stopped sampling ${device.udid}: ${reason}`);
      },
    };
    let sampler: MetricsSampler;
    try {
      sampler = this.samplerFor(sessionId, device, capabilities, hooks);
    } catch (err: any) {
      this.log.warn(`[${sessionId}] Can't sample ${device.udid}: ${err?.message ?? err}`);
      return;
    }
    store?.begin(sessionId, String(device.platform ?? ''));
    let flushTimer: ReturnType<typeof setInterval> | undefined;
    if (!held) {
      flushTimer = setInterval(() => void this.flush(sessionId), FLUSH_INTERVAL_MS);
      flushTimer.unref?.();
    }
    this.running.set(sessionId, {
      sampler,
      buffer: [],
      flushTimer,
      writing: Promise.resolve(),
      gaveUp: false,
      held,
    });
    sampler.start();
    this.log.info(`[${sessionId}] Sampling CPU and memory on ${device.udid}`);
  }
```

```ts
  async stop(sessionId: string): Promise<void> {
    const entry = this.running.get(sessionId);
    if (!entry) return;
    this.running.delete(sessionId);
    if (entry.flushTimer) clearInterval(entry.flushTimer);
    await entry.sampler.stop().catch(() => undefined);
    if (entry.held) this.nodeStore().end(sessionId);
    else await this.write(sessionId, entry);
  }
```

Add the seams under `// Seams.`:

```ts
  /** A node (a server with `hub`) holds the figures for its hub instead of writing them. */
  protected holdsForHub(): boolean {
    return this.context().pluginArgs?.hub !== undefined;
  }

  protected nodeStore(): NodeMetricsStore {
    return Container.get(NodeMetricsStore);
  }
```

- [ ] **Step 4: Run the service spec and watch it pass**

Run: `npx mocha test/unit/session-metrics-service.spec.ts`
Expected: PASS, the earlier cases included.

- [ ] **Step 5: Write the failing lifecycle tests**

```ts
// test/unit/session-metrics-lifecycle.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import NodeDevices from '../../src/device-managers/NodeDevices';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * A session's sampling stops however the session ends on this server, its
 * dashboard on or off: on a node that ends the figures it holds for the hub.
 */
describe('session sampling stops however a session ends', function () {
  this.timeout(30_000);
  useScratchDatabase();
  let restore: () => void;
  let stop: sinon.SinonStub;

  beforeEach(() => {
    restore = saveRegistrations(SessionMetricsService);
    stop = sinon.stub().resolves();
    Container.set(SessionMetricsService, { stop } as any);
  });
  afterEach(() => {
    sinon.restore();
    restore();
  });

  it('at shutdown', async () => {
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
    await Container.get(SessionLifecycleService).stopSessionForShutdown('s-down', 'shutdown');
    expect(stop.calledWith('s-down')).to.equal(true);
  });

  it('when the driver shuts down unexpectedly on a node', async () => {
    sinon.stub(NodeDevices.prototype, 'unblockDevice').resolves();
    const plugin = { pluginArgs: { hub: 'http://hub:4723' } };
    await XenonPlugin.prototype.onUnexpectedShutdown.call(
      plugin as any,
      { sessionId: 's-crash', caps: {} },
      null,
    );
    expect(stop.calledWith('s-crash')).to.equal(true);
  });
});
```

Ending through `deleteSession`, and starting in `finalizeSession` on a node,
are tested end to end in Task 7.

- [ ] **Step 6: Run it and watch it fail**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/session-metrics-lifecycle.spec.ts`
Expected: FAIL. Neither path calls `SessionMetricsService.stop`.

- [ ] **Step 7: Start on a node; stop at every end**

In `SessionLifecycleService.ts`, import `SessionMetricsService` from
`'./metrics/SessionMetricsService'`. In `finalizeSession`, after the
`LiveSessionOwners.record` block:

```ts
    // A node samples its own phones for its hub, whatever its dashboard
    // setting (the hub collects the figures). A hub and a standalone server
    // start sampling in EventManager.onSessionStarted, once the row exists.
    if (!this.isHub(context.pluginArgs) && sessionInstance instanceof LocalSession) {
      Container.get(SessionMetricsService).start({
        sessionId,
        device: freshDevice,
        capabilities: sessionResponse,
      });
    }
```

In `deleteSession`'s `finally`, after
`Container.get(LiveSessionOwners).forget(sessionId);`:

```ts
        // Before the lock's "still in memory?" check, which a dashboard-off
        // node fails. On a node this ends the figures it holds for its hub;
        // on a hub it collects a node session's last ones. Idempotent.
        await Container.get(SessionMetricsService).stop(sessionId);
```

In `stopSessionForShutdown`, after
`Container.get(LiveSessionOwners).forget(sessionId);`:

```ts
      await Container.get(SessionMetricsService).stop(sessionId);
```

In `src/plugin.ts`, import `SessionMetricsService` and, in
`onUnexpectedShutdown`, after `Container.get(LiveSessionOwners).forget(sessionId);`:

```ts
    if (sessionId) await Container.get(SessionMetricsService).stop(sessionId);
```

- [ ] **Step 8: Run the specs and watch them pass**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/session-metrics-lifecycle.spec.ts test/unit/session-metrics-service.spec.ts test/unit/dashboard-events-metrics.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
npx prettier --write test/unit/session-metrics-lifecycle.spec.ts
git add src/services/metrics/SessionMetricsService.ts src/services/SessionLifecycleService.ts src/plugin.ts test/unit/session-metrics-service.spec.ts test/unit/session-metrics-lifecycle.spec.ts
git commit -m "feat(node): sample the hub's sessions and hold the figures until the hub collects them"
```

---

### Task 4: The hub's collector

**Files:**
- Modify: `src/services/metrics/nodeMetrics.ts` (add `NodeAsk`,
  `readNodeMetricsReply`, `NodeMetricsSource`, `nodeMetricsSourceOf`,
  `NodeMetricsSupport`, `NODE_METRICS_RECHECK_MS`)
- Create: `src/services/metrics/NodeMetricsCollector.ts`
- Modify: `src/services/metrics/types.ts` (`MetricsSampler.state?()`)
- Modify: `src/sessions/RemoteSession.ts` (`nodeOrigin()`, `nodeMetrics(after)`)
- Test: `test/unit/node-metrics-collector.spec.ts`

**Interfaces:**
- Consumes: `NodeMetricsAnswer` and `NODE_METRICS_HEADER` from Task 1.
- Produces:
  - `type NodeAsk = { kind: 'answer'; answer: NodeMetricsAnswer } | { kind: 'unsupported'; status: number } | { kind: 'refused' } | { kind: 'unavailable'; reason: string }`;
  - `readNodeMetricsReply(status, headers, data): NodeAsk`;
  - `interface NodeMetricsSource { nodeOrigin(): string | null; nodeMetrics(after: number | null): Promise<NodeAsk> }`;
  - `nodeMetricsSourceOf(session: unknown): NodeMetricsSource | undefined`;
  - `class NodeMetricsSupport` (`@Service()`), with `shouldAsk(origin)` and
    `unsupported(origin, status)`;
  - `COLLECT_INTERVAL_MS = 10_000`;
  - `class NodeMetricsCollector implements MetricsSampler`, constructed with
    `{ source, hooks, support, logger, after?, intervalMs? }` and offering
    `state(): RecordingState`;
  - `RemoteSession.nodeOrigin()` and `RemoteSession.nodeMetrics(after)`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/node-metrics-collector.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { NodeMetricsCollector } from '../../src/services/metrics/NodeMetricsCollector';
import {
  NODE_METRICS_HEADER,
  NodeAsk,
  NodeMetricsState,
  NodeMetricsSupport,
  readNodeMetricsReply,
} from '../../src/services/metrics/nodeMetrics';
import { MetricSample } from '../../src/services/metrics/types';

const sample = (at: number): MetricSample => ({
  at,
  deviceCpuPct: 5,
  deviceMemMb: 1,
  deviceMemTotalMb: 2,
  appCpuPct: null,
  appMemMb: null,
  appId: null,
});
const answer = (state: NodeMetricsState, ats: number[]): NodeAsk => ({
  kind: 'answer',
  answer: { platform: 'android', state, samples: ats.map(sample) },
});

describe('NodeMetricsCollector: the hub collects a node session’s figures', () => {
  let clock: sinon.SinonFakeTimers;
  let replies: NodeAsk[];
  let asked: Array<number | null>;
  let got: number[];
  let warned: string[];
  let support: NodeMetricsSupport;
  /** While set, an ask waits on it: a node slow to answer. */
  let gate: Promise<void> | null;

  const source = {
    nodeOrigin: () => 'http://node:4723',
    nodeMetrics: async (after: number | null): Promise<NodeAsk> => {
      asked.push(after);
      if (gate) await gate;
      return replies.shift() ?? answer('sampling', []);
    },
  };
  const make = (after: number | null = null) =>
    new NodeMetricsCollector({
      source,
      hooks: { onSample: (s) => got.push(s.at), onGiveUp: () => undefined },
      support,
      logger: { info: () => undefined, warn: (m: string) => warned.push(m) },
      after,
    });

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 0 });
    replies = [];
    asked = [];
    got = [];
    warned = [];
    gate = null;
    support = new NodeMetricsSupport();
    support.now = () => clock.now;
    support.logger = { warn: (m: string) => warned.push(m) };
  });
  afterEach(() => clock.restore());

  it('asks every 10 s from the newest sample it has, and passes the samples on', async () => {
    replies = [answer('sampling', [1, 2]), answer('sampling', [3])];
    const c = make();
    c.start();
    await clock.tickAsync(10_000);
    await clock.tickAsync(10_000);
    expect(asked).to.deep.equal([null, 2]);
    expect(got).to.deep.equal([1, 2, 3]);
    expect(c.state()).to.equal('sampling');
  });

  it('starts from the newest sample stored, after a hub restart', async () => {
    const c = make(500);
    c.start();
    await clock.tickAsync(10_000);
    expect(asked).to.deep.equal([500]);
  });

  it('asks once more when the session ends, and takes the last samples', async () => {
    replies = [answer('sampling', [1]), answer('ended', [2, 3])];
    const c = make();
    c.start();
    await clock.tickAsync(10_000);
    await c.stop();
    expect(got).to.deep.equal([1, 2, 3]);
    expect(c.state()).to.equal('stopped');
    await clock.tickAsync(30_000);
    expect(asked).to.have.length(2);
  });

  it('stops asking when the node says off, or that its sampler stopped', async () => {
    for (const [state, expected] of [
      ['off', 'off'],
      ['stopped', 'stopped'],
    ] as const) {
      asked = [];
      replies = [answer(state, [7])];
      const c = make();
      c.start();
      await clock.tickAsync(30_000);
      expect(asked, state).to.have.length(1);
      expect(c.state(), state).to.equal(expected);
      await c.stop();
      expect(asked, `${state}: no last ask`).to.have.length(1);
    }
  });

  it('stops asking a node without the route, says so once, and asks it again later', async () => {
    replies = [{ kind: 'unsupported', status: 404 }];
    const first = make();
    first.start();
    await clock.tickAsync(10_000);
    expect(first.state()).to.equal('off');

    const second = make();
    second.start();
    await clock.tickAsync(10_000);
    expect(asked).to.have.length(1);
    expect(second.state()).to.equal('off');
    expect(warned.filter((m) => m.includes('http://node:4723'))).to.have.length(1);

    await clock.tickAsync(10 * 60_000);
    const third = make();
    third.start();
    await clock.tickAsync(10_000);
    expect(asked).to.have.length(2);
  });

  it("stops asking when the node refuses the hub's token", async () => {
    replies = [{ kind: 'refused' }];
    const c = make();
    c.start();
    await clock.tickAsync(30_000);
    expect(asked).to.have.length(1);
    expect(c.state()).to.equal('off');
  });

  it('keeps asking an unreachable node, saying so once per outage', async () => {
    replies = [
      { kind: 'unavailable', reason: 'ECONNREFUSED' },
      { kind: 'unavailable', reason: 'ECONNREFUSED' },
      answer('sampling', [1]),
      { kind: 'unavailable', reason: 'timeout' },
    ];
    const c = make();
    c.start();
    await clock.tickAsync(40_000);
    expect(asked).to.have.length(4);
    expect(got).to.deep.equal([1]);
    expect(warned).to.have.length(2);
    expect(c.state()).to.equal('sampling');
  });

  it('finishes stopping when the node is unreachable', async () => {
    replies = [{ kind: 'unavailable', reason: 'timeout' }];
    const c = make();
    c.start();
    await c.stop();
    expect(asked).to.have.length(1);
  });

  it('never asks twice at once, or takes a sample twice', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    replies = [answer('sampling', [1, 2]), answer('sampling', [2, 3])];
    const c = make();
    c.start();
    await clock.tickAsync(10_000); // the first ask, held by the node
    await clock.tickAsync(20_000); // two more ticks while it is held
    expect(asked).to.have.length(1);

    gate = null;
    release();
    await clock.tickAsync(10_000); // the first answer arrives; the next ask goes
    expect(asked).to.deep.equal([null, 2]);
    expect(got).to.deep.equal([1, 2, 3]);
  });
});

describe("readNodeMetricsReply: what a node's answer means", () => {
  const h = { [NODE_METRICS_HEADER]: '1' };
  it('reads each answer', () => {
    expect(readNodeMetricsReply(404, {}, undefined)).to.deep.equal({
      kind: 'unsupported',
      status: 404,
    });
    expect(readNodeMetricsReply(404, h, {})).to.deep.equal({ kind: 'refused' });
    expect(
      readNodeMetricsReply(200, h, {
        value: { platform: 'ios', state: 'sampling', samples: [sample(1)] },
      }),
    ).to.deep.equal({
      kind: 'answer',
      answer: { platform: 'ios', state: 'sampling', samples: [sample(1)] },
    });
    expect(readNodeMetricsReply(503, h, {})).to.deep.equal({
      kind: 'unavailable',
      reason: 'answered 503',
    });
    expect(readNodeMetricsReply(200, h, { value: { state: 'weird', samples: [] } })).to.deep.equal({
      kind: 'unavailable',
      reason: 'answered 200',
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx mocha test/unit/node-metrics-collector.spec.ts`
Expected: FAIL, `Cannot find module '../../src/services/metrics/NodeMetricsCollector'`.

- [ ] **Step 3: Add the hub's types to `nodeMetrics.ts`**

Append:

```ts
import { Service } from 'typedi';
import log from '../../logger';

/** What a node's answer at NODE_METRICS_ROUTE means for the hub. */
export type NodeAsk =
  | { kind: 'answer'; answer: NodeMetricsAnswer }
  /** An older node, without the route. */
  | { kind: 'unsupported'; status: number }
  /** The node refused the hub's token: the session is gone, or isn't the hub's. */
  | { kind: 'refused' }
  /** Unreachable, timed out, or couldn't check the token (503): ask again. */
  | { kind: 'unavailable'; reason: string };

const STATES: readonly NodeMetricsState[] = ['sampling', 'stopped', 'ended', 'off'];

export function readNodeMetricsReply(
  status: number,
  headers: Record<string, unknown>,
  data: any,
): NodeAsk {
  if (!headers?.[NODE_METRICS_HEADER]) return { kind: 'unsupported', status };
  if (status === 404) return { kind: 'refused' };
  const value = data?.value;
  if (status === 200 && value && STATES.includes(value.state) && Array.isArray(value.samples)) {
    return {
      kind: 'answer',
      answer: { platform: String(value.platform ?? ''), state: value.state, samples: value.samples },
    };
  }
  return { kind: 'unavailable', reason: `answered ${status}` };
}

/** What the hub's collector needs of a session a node runs: a RemoteSession. */
export interface NodeMetricsSource {
  nodeOrigin(): string | null;
  nodeMetrics(after: number | null): Promise<NodeAsk>;
}

/** The session as a NodeMetricsSource, when it is one. */
export function nodeMetricsSourceOf(session: unknown): NodeMetricsSource | undefined {
  const s = session as Partial<NodeMetricsSource> | null | undefined;
  return s && typeof s.nodeMetrics === 'function' && typeof s.nodeOrigin === 'function'
    ? (s as NodeMetricsSource)
    : undefined;
}

/** How long the hub leaves a node without the route alone before asking it again. */
export const NODE_METRICS_RECHECK_MS = 10 * 60_000;

/**
 * Hub side: which nodes lack the route (an older Xenon). Their sessions show
 * no figures; the hub says so once per node, and asks again after
 * NODE_METRICS_RECHECK_MS, so a node upgraded in place is picked up.
 */
@Service()
export class NodeMetricsSupport {
  logger: { warn(message: string): void } = log.scope('NodeMetrics');
  now: () => number = () => Date.now();
  private readonly unsupportedUntil = new Map<string, number>();
  private readonly warned = new Set<string>();

  shouldAsk(origin: string): boolean {
    const until = this.unsupportedUntil.get(origin);
    if (until === undefined) return true;
    if (until > this.now()) return false;
    this.unsupportedUntil.delete(origin);
    return true;
  }

  unsupported(origin: string, status: number): void {
    this.unsupportedUntil.set(origin, this.now() + NODE_METRICS_RECHECK_MS);
    if (this.warned.has(origin)) return;
    this.warned.add(origin);
    this.logger.warn(
      `Node ${origin} has no session metrics route (answered ${status}): an older Xenon. ` +
        'Its sessions show no CPU or memory. Upgrade the node.',
    );
  }
}
```

Move the two new imports to the top of the file.

- [ ] **Step 4: Let a sampler report its own state**

In `src/services/metrics/types.ts`, extend `MetricsSampler`:

```ts
export interface MetricsSampler {
  start(): void;
  stop(): Promise<void>;
  /** Whether it is sampling, when it decides that itself (the hub's collector). */
  state?(): RecordingState;
}
```

- [ ] **Step 5: Write the collector**

```ts
// src/services/metrics/NodeMetricsCollector.ts
import { NodeMetricsSource, NodeMetricsSupport } from './nodeMetrics';
import { MetricsSampler, RecordingState, SamplerHooks } from './types';

/** How often the hub asks a node for a session's new figures. */
export const COLLECT_INTERVAL_MS = 10_000;

export interface NodeCollectorOptions {
  source: NodeMetricsSource;
  hooks: SamplerHooks;
  support: Pick<NodeMetricsSupport, 'shouldAsk' | 'unsupported'>;
  logger: { info(message: string): void; warn(message: string): void };
  /** Ask only for figures newer than this: the newest the hub stored before a restart. */
  after?: number | null;
  intervalMs?: number;
}

/**
 * On a hub: a session on a node's phone, sampled by asking the node
 * (GET /node/sessions/:id/metrics) every COLLECT_INTERVAL_MS instead of
 * reading the phone. Its samples go through the same hooks as a phone
 * sampler's, so SessionMetricsService buffers and writes them as its own.
 * Asks never overlap. An unreachable node is asked again; whether the
 * session is alive is the heartbeat's call. When the session ends it asks
 * once more, for the last seconds.
 */
export class NodeMetricsCollector implements MetricsSampler {
  private after: number | null;
  private current: RecordingState = 'sampling';
  private done = false;
  private timer?: ReturnType<typeof setInterval>;
  private asking: Promise<void> | null = null;
  private outage = false;

  constructor(private readonly o: NodeCollectorOptions) {
    this.after = o.after ?? null;
  }

  state(): RecordingState {
    return this.current;
  }

  start(): void {
    const origin = this.o.source.nodeOrigin();
    if (!origin || !this.o.support.shouldAsk(origin)) {
      this.finish('off');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.o.intervalMs ?? COLLECT_INTERVAL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.asking) await this.asking;
    if (!this.done) await this.ask();
    this.done = true;
  }

  private tick(): Promise<void> | undefined {
    if (this.done || this.asking) return undefined;
    this.asking = this.ask().finally(() => {
      this.asking = null;
    });
    return this.asking;
  }

  private async ask(): Promise<void> {
    const reply = await this.o.source.nodeMetrics(this.after);
    switch (reply.kind) {
      case 'answer': {
        if (this.outage) {
          this.outage = false;
          this.o.logger.info(`${this.o.source.nodeOrigin()} answers again`);
        }
        for (const s of reply.answer.samples) {
          if (this.after !== null && s.at <= this.after) continue;
          this.o.hooks.onSample(s);
          this.after = s.at;
        }
        const state = reply.answer.state;
        if (state === 'sampling') this.current = 'sampling';
        else this.finish(state === 'off' ? 'off' : 'stopped');
        return;
      }
      case 'unsupported':
        this.o.support.unsupported(this.o.source.nodeOrigin() ?? '', reply.status);
        this.finish('off');
        return;
      case 'refused':
        this.finish('off');
        return;
      case 'unavailable':
        if (!this.outage) {
          this.outage = true;
          this.o.logger.warn(
            `Can't collect CPU and memory from ${this.o.source.nodeOrigin()}: ${reply.reason}. Asking again.`,
          );
        }
        return;
    }
  }

  private finish(state: RecordingState): void {
    this.current = state;
    this.done = true;
    if (this.timer) clearInterval(this.timer);
  }
}
```

- [ ] **Step 6: Let a RemoteSession ask its node**

In `src/sessions/RemoteSession.ts`, import `NodeAsk` and
`readNodeMetricsReply` from `'../services/metrics/nodeMetrics'`, and add:

```ts
  /** The node's origin, where its own routes are; null for a base URL that isn't one. */
  nodeOrigin(): string | null {
    try {
      return new URL(this.baseUrl).origin;
    } catch {
      return null;
    }
  }

  /** The node's CPU and memory for this session newer than `after` (NodeMetricsCollector). */
  async nodeMetrics(after: number | null): Promise<NodeAsk> {
    const origin = this.nodeOrigin();
    if (!origin) return { kind: 'unavailable', reason: `no node origin in ${this.baseUrl}` };
    try {
      const response = await this.call({
        method: 'get',
        url: `${origin}/xenon/api/node/sessions/${encodeURIComponent(this.sessionId)}/metrics`,
        params: after === null ? undefined : { after },
        timeout: 5000,
        validateStatus: () => true,
      });
      return readNodeMetricsReply(response.status, response.headers ?? {}, response.data);
    } catch (err: any) {
      return { kind: 'unavailable', reason: String(err?.code ?? err?.message ?? err) };
    }
  }
```

- [ ] **Step 7: Run it and watch it pass**

Run: `npx mocha test/unit/node-metrics-collector.spec.ts`
Expected: PASS, 10 passing.

If the "never asks twice at once" case fails, check that `gate` is really
pending, rather than relaxing the assertion. The first answer must arrive
only after `release()`.

- [ ] **Step 8: Commit**

```bash
npx prettier --write src/services/metrics/NodeMetricsCollector.ts test/unit/node-metrics-collector.spec.ts
git add src/services/metrics/nodeMetrics.ts src/services/metrics/NodeMetricsCollector.ts src/services/metrics/types.ts src/sessions/RemoteSession.ts test/unit/node-metrics-collector.spec.ts
git commit -m "feat(hub): collect a node session's CPU and memory from the node"
```

---

### Task 5: The hub collects for a node's phone

**Files:**
- Modify: `src/services/metrics/SessionMetricsService.ts`
- Modify: `src/dashboard/event-manager.ts:90-148`
- Test: `test/unit/session-metrics-service.spec.ts` (add cases)
- Test: `test/unit/dashboard-events-metrics.spec.ts` (add a case)

**Interfaces:**
- Consumes: `NodeMetricsSource`, `nodeMetricsSourceOf` and
  `NodeMetricsSupport` (Task 4); `NodeMetricsCollector` (Task 4).
- Produces:
  - `MetricsStart` gains `source?: NodeMetricsSource` and
    `after?: number | null`;
  - `appliesTo(device, source?)`;
  - `collectorFor(source, hooks, after)` (protected seam);
  - `recordingState` follows `sampler.state()`.

- [ ] **Step 1: Write the failing tests**

Add to `TestMetrics` in `test/unit/session-metrics-service.spec.ts`:

```ts
  collected: Array<{ source: unknown; after: number | null }> = [];
  collectorState: string = 'sampling';
  protected collectorFor(source: any, hooks: SamplerHooks, after: number | null) {
    this.collected.push({ source, after });
    const f = new FakeSampler(hooks) as FakeSampler & { state: () => string };
    f.state = () => this.collectorState;
    this.samplers.push(f);
    return f as any;
  }
```

and the cases:

```ts
  const source = { nodeOrigin: () => 'http://node', nodeMetrics: async () => ({ kind: 'refused' }) } as any;

  it("on a hub, collects a node's phone from the node, never a cloud phone or without a session", () => {
    const nodePhone = phone({ nodeId: 'node-2', host: 'http://node:4723' });
    expect(m.appliesTo(nodePhone, source)).to.equal(true);
    expect(m.appliesTo(nodePhone)).to.equal(false);
    expect(m.appliesTo({ ...nodePhone, cloud: 'browserstack' }, source)).to.equal(false);
    expect(m.appliesTo(phone({ nodeId: 'node-2', platform: 'ios', realDevice: false }), source)).to.equal(false);
    m.args = { sessionMetrics: false };
    expect(m.appliesTo(nodePhone, source)).to.equal(false);
    m.args = { hub: 'http://hub:4723' };
    expect(m.appliesTo(nodePhone, source)).to.equal(false);
  });

  it("collects from the node, from where it left off, and writes the figures as its own", async () => {
    m.start({ sessionId: 's1', device: phone({ nodeId: 'node-2' }), capabilities: {}, source, after: 40 });
    expect(m.collected).to.deep.equal([{ source, after: 40 }]);
    m.samplers[0].hooks.onSample(sample(41));
    await m.stop('s1');
    expect(m.written).to.deep.equal([{ sessionId: 's1', ats: [41] }]);
  });

  it("says what the node says about a running session's sampling", () => {
    m.start({ sessionId: 's1', device: phone({ nodeId: 'node-2' }), capabilities: {}, source });
    expect(m.recordingState('s1')).to.equal('sampling');
    m.collectorState = 'off';
    expect(m.recordingState('s1')).to.equal('off');
  });
```

Add to `test/unit/dashboard-events-metrics.spec.ts`:

```ts
  it("hands the service a node's session, to collect its figures from the node", async () => {
    const { session, device } = startSession();
    const remote = Object.assign(session, {
      nodeOrigin: () => 'http://node:4723',
      nodeMetrics: async () => ({ kind: 'refused' }),
    });

    await DASHBORD_EVENT_MANAGER.onSessionStarted({}, remote as any, device as any);

    expect(metrics.appliesTo.firstCall.args).to.deep.equal([device, remote]);
    expect(metrics.start.firstCall.args[0].source).to.equal(remote);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx mocha test/unit/session-metrics-service.spec.ts test/unit/dashboard-events-metrics.spec.ts`
Expected: FAIL. `appliesTo` refuses the node's phone, `collected` is empty,
and `start` gets no `source`.

- [ ] **Step 3: Collect for a node's phone**

In `SessionMetricsService.ts`, import `NodeMetricsCollector`,
`NodeMetricsSource` and `NodeMetricsSupport`, and change:

```ts
export interface MetricsStart {
  sessionId: string;
  device: IDevice;
  capabilities: Record<string, any>;
  /** A session on a node's phone (a hub's RemoteSession): its figures are collected from the node. */
  source?: NodeMetricsSource;
  /** Collect only figures newer than this: resuming after a hub restart. */
  after?: number | null;
}
```

```ts
  /** Whether a session on this phone is sampled: this server's phone, or a node's through its session. */
  appliesTo(device: IDevice | undefined, source?: NodeMetricsSource): boolean {
    if (!device) return false;
    const ctx = this.context();
    if (ctx.pluginArgs?.sessionMetrics === false) return false;
    const platform = String(device.platform ?? '').toLowerCase();
    // An emulator's /proc reads like a phone's; a simulator has no sysmontap.
    if (platform !== 'android' && !(platform === 'ios' && device.realDevice === true)) {
      return false;
    }
    if (this.ownPhone(device)) return true;
    // A node's phone, on a hub: collected from the node. Never a cloud provider's.
    return !!source && !device.cloud && !this.holdsForHub();
  }

  private ownPhone(device: IDevice): boolean {
    const ctx = this.context();
    return isOwnDevice(localDeviceHosts(ctx.pluginArgs, ctx.port), ctx.nodeId, device);
  }
```

In `start`, take `source` and `after`, check `this.appliesTo(device, source)`,
and choose the sampler:

```ts
  start({ sessionId, device, capabilities, source, after }: MetricsStart): void {
    if (this.running.has(sessionId) || !this.appliesTo(device, source)) return;
```

```ts
    try {
      sampler =
        source && !this.ownPhone(device)
          ? this.collectorFor(source, hooks, after ?? null)
          : this.samplerFor(sessionId, device, capabilities, hooks);
    } catch (err: any) {
```

```ts
  recordingState(sessionId: string): RecordingState {
    const entry = this.running.get(sessionId);
    if (!entry) return 'off';
    return entry.sampler.state?.() ?? (entry.gaveUp ? 'stopped' : 'sampling');
  }
```

Add the seam:

```ts
  protected collectorFor(
    source: NodeMetricsSource,
    hooks: SamplerHooks,
    after: number | null,
  ): MetricsSampler {
    return new NodeMetricsCollector({
      source,
      hooks,
      after,
      support: Container.get(NodeMetricsSupport),
      logger: this.log,
    });
  }
```

In `src/dashboard/event-manager.ts`, import `nodeMetricsSourceOf` from
`'../services/metrics/nodeMetrics'`, and:

```ts
    const metrics = Container.get(SessionMetricsService);
    const source = nodeMetricsSourceOf(session);
    const sampled = metrics.appliesTo(device, source);
```

```ts
    if (sampled) {
      metrics.start({
        sessionId: session.getId(),
        device,
        capabilities: session.getCapabilities(),
        ...(source ? { source } : {}),
      });
    }
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx mocha test/unit/session-metrics-service.spec.ts test/unit/dashboard-events-metrics.spec.ts test/unit/session-metrics-route.spec.ts`
Expected: PASS, the earlier cases included.

- [ ] **Step 5: Commit**

```bash
git add src/services/metrics/SessionMetricsService.ts src/dashboard/event-manager.ts test/unit/session-metrics-service.spec.ts test/unit/dashboard-events-metrics.spec.ts
git commit -m "feat(hub): a session on a node's phone gets the Performance panel, collected from the node"
```

---

### Task 6: The hub resumes after a restart

**Files:**
- Modify: `src/sessions/SessionManager.ts` (the RemoteSession branch of `recoverActiveSessions`)
- Test: `test/unit/session-recovery-metrics.spec.ts`

**Interfaces:**
- Consumes: `SessionMetricsService.start({ sessionId, device, capabilities, source, after })` (Task 5); `nodeMetricsSourceOf` (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/session-recovery-metrics.spec.ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionManager, SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * After a hub restart, a node session whose figures the hub was collecting
 * goes on being collected, from the newest sample the hub stored: the node's
 * memory fills the gap.
 */
describe('a hub restart resumes collecting a node session’s figures', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  let restore: () => void;
  let start: sinon.SinonStub;
  let savedStore: unknown;

  beforeEach(async () => {
    restore = saveRegistrations(SessionMetricsService);
    start = sinon.stub();
    Container.set(SessionMetricsService, { start } as any);
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    await scratch.db.sessionMetric.deleteMany({});
    await scratch.db.session.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.device.create({
      data: {
        udid: 'node-phone',
        host: 'http://127.0.0.1:1',
        nodeId: 'node-2',
        platform: 'android',
        name: 'S9',
        sdk: '10',
        busy: true,
        userBlocked: false,
        offline: false,
      } as any,
    });
    const row = (id: string, profiled: boolean) =>
      scratch.db.session.create({
        data: {
          id,
          device_udid: 'node-phone',
          device_platform: 'android',
          device_version: '10',
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'node-2',
          has_live_video: false,
          status: 'running',
          is_profiling_available: profiled,
        },
      });
    await row('collected', true);
    await row('fresh', true);
    await row('never', false);
    await scratch.db.sessionMetric.createMany({
      data: [100, 200].map((at) => ({ session_id: 'collected', at })),
    });
  });

  afterEach(() => {
    for (const s of SESSION_MANAGER.getAllSessions()) SESSION_MANAGER.removeSession(s.getId());
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restore();
  });

  it('resumes each from its newest stored sample, and never one the hub did not collect', async () => {
    await new SessionManager().recoverActiveSessions('hub-1', '/wd/hub');

    const byId = new Map(start.getCalls().map((c) => [c.args[0].sessionId, c.args[0]]));
    expect(Array.from(byId.keys()).sort()).to.deep.equal(['collected', 'fresh']);
    expect(byId.get('collected').after).to.equal(200);
    expect(byId.get('fresh').after).to.equal(null);
    expect(typeof byId.get('collected').source.nodeMetrics).to.equal('function');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/session-recovery-metrics.spec.ts`
Expected: FAIL, `start` not called (`[]` against `['collected', 'fresh']`).
If `SessionManager` isn't exported as a class, use the module's exported
instance in the test and say so in the ledger.

- [ ] **Step 3: Resume in recovery**

In `SessionManager.ts`, import `nodeMetricsSourceOf` from
`'../services/metrics/nodeMetrics'`. In the RemoteSession branch, after
`await this.adoptHeartbeat(dbSession.id);`:

```ts
          // A node session whose figures the hub was collecting goes on from
          // the newest sample stored here; the node's memory fills the gap.
          if (!device.cloud && dbSession.is_profiling_available) {
            await this.resumeNodeMetrics(dbSession.id, device, recoveredSession, sessionResponse);
          }
```

and the method:

```ts
  private async resumeNodeMetrics(
    sessionId: string,
    device: IDevice,
    session: XenonSession,
    capabilities: Record<string, any>,
  ): Promise<void> {
    try {
      const newest = await prisma.sessionMetric.aggregate({
        where: { session_id: sessionId },
        _max: { at: true },
      });
      // Loaded here: SessionMetricsService imports the device managers.
      const { SessionMetricsService } = await import('../services/metrics/SessionMetricsService');
      Container.get(SessionMetricsService).start({
        sessionId,
        device,
        capabilities,
        source: nodeMetricsSourceOf(session),
        after: newest._max.at ?? null,
      });
    } catch (err: any) {
      this.log.warn(`Session ${sessionId}: CPU and memory not resumed: ${err.message}`);
    }
  }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/session-recovery-metrics.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write test/unit/session-recovery-metrics.spec.ts
git add src/sessions/SessionManager.ts test/unit/session-recovery-metrics.spec.ts
git commit -m "feat(hub): after a restart, go on collecting a node session's figures from where they stopped"
```

---

### Task 7: Hub and node together

**Files:**
- Test: `test/unit/hub-node-session-metrics.spec.ts` (new, built on the
  harness of `test/unit/hub-remote-session-heartbeat.spec.ts`)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the test**

Copy the heartbeat spec's imports, its `before`/`after`, its
`beforeEach`/`afterEach`, `port`, `boot` and `nodeSession`. Then make these
changes:

- In `boot`, also call `registerNodeSessionMetrics(api, pluginArgs)` after
  `registerNodeSessionStatus(...)`, with `withRoute` dropped (always on).
- In `beforeEach`, also save and set the node's services:

```ts
    restore = saveRegistrations(
      JwtKeyService,
      HubSessionTokenIssuer,
      XenonManager,
      AppiumUmbrella,
      NodeSessionProbeSupport,
      SessionMetricsService,
      NodeMetricsStore,
      NodeMetricsSupport,
    );
    nodeMetrics = new NodeSideMetrics();
    Container.set(SessionMetricsService, nodeMetrics);
    Container.set(NodeMetricsStore, new NodeMetricsStore());
    Container.set(NodeMetricsSupport, new NodeMetricsSupport());
```

with:

```ts
/** The node's sampler service, its phone sampler replaced by one the test drives. */
class NodeSideMetrics extends SessionMetricsService {
  hooks: SamplerHooks[] = [];
  stopped = 0;
  protected samplerFor(_id: string, _d: any, _c: any, hooks: SamplerHooks): MetricsSampler {
    this.hooks.push(hooks);
    return { start: () => undefined, stop: async () => void (this.stopped += 1) };
  }
}

/** The hub's sampler service: this hub's own phones are none, it asks the node every 50 ms. */
class HubSideMetrics extends SessionMetricsService {
  written: number[] = [];
  protected context(): any {
    return { pluginArgs: { ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' }, port: 4799, nodeId: 'hub-1' };
  }
  protected async writeSamples(_id: string, samples: MetricSample[]): Promise<void> {
    this.written.push(...samples.map((s) => s.at));
  }
  protected collectorFor(source: any, hooks: SamplerHooks, after: number | null): MetricsSampler {
    return new NodeMetricsCollector({
      source,
      hooks,
      after,
      support: Container.get(NodeMetricsSupport),
      logger: quiet,
      intervalMs: 50,
    });
  }
}

const until = async (ok: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const at = (t: number): MetricSample => ({
  at: t,
  deviceCpuPct: 12,
  deviceMemMb: 900,
  deviceMemTotalMb: 4000,
  appCpuPct: 3,
  appMemMb: 150,
  appId: 'com.android.settings',
});
```

The test:

```ts
  it("the hub collects a node session's figures as it runs, and the last ones when it ends", async () => {
    await boot();
    const sessionId = await nodeSession();

    // The node samples the session the hub created, its dashboard off.
    expect(nodeMetrics.hooks).to.have.length(1);
    nodeMetrics.hooks[0].onSample(at(1000));
    nodeMetrics.hooks[0].onSample(at(2000));

    const hub = new HubSideMetrics();
    const device = {
      udid: 'phone-1',
      host: nodeOrigin,
      nodeId: NODE_ID,
      platform: 'android',
      realDevice: true,
    } as any;
    hub.start({ sessionId, device, capabilities: {}, source: hubSide(sessionId) });
    expect(hub.recordingState(sessionId)).to.equal('sampling');

    // Live: asked with the hub's token (per-command auth is on), every 50 ms here.
    await until(() => hub.written.length === 0 && Container.get(NodeMetricsStore).read(sessionId, null).samples.length === 0);

    nodeMetrics.hooks[0].onSample(at(3000));
    const token = await Container.get(HubSessionTokenIssuer).tokenFor(sessionId);
    const del = await request(nodeOrigin)
      .delete(`/node/session/${sessionId}`)
      .set(HUB_TOKEN_HEADER, token as string);
    expect(del.status, JSON.stringify(del.body)).to.equal(200);
    expect(nodeMetrics.stopped).to.equal(1);
    expect(Container.get(NodeMetricsStore).read(sessionId, 2000).state).to.equal('ended');

    await hub.stop(sessionId);
    expect(hub.written).to.deep.equal([1000, 2000, 3000]);
  });

  it("an older node's sessions say they aren't recorded", async () => {
    await boot();
    const sessionId = await nodeSession();
    const hub = new HubSideMetrics();
    const device = { udid: 'phone-1', host: nodeOrigin, nodeId: NODE_ID, platform: 'android', realDevice: true } as any;
    const older = Object.assign(hubSide(sessionId), {
      nodeMetrics: async () => ({ kind: 'unsupported', status: 404 }),
    });
    hub.start({ sessionId, device, capabilities: {}, source: older as any });
    await until(() => hub.recordingState(sessionId) === 'off');
  });
```

The first `until` waits for two things: the hub has collected the two
samples (the node dropped them on the next ask), and none is written yet
(writes come every 10 s, or on stop).

- [ ] **Step 2: Run it**

Run: `npx mocha --require test/setup/scratch-default-database.js test/unit/hub-node-session-metrics.spec.ts`
Expected: PASS. This test follows Tasks 1 to 6, so it should pass at once.

To check it would catch a break: comment out the `stop` line added to
`deleteSession` in Task 3, run the test, and confirm it fails
(`nodeMetrics.stopped` is 0, or the last sample is missing). Then restore
the line.

- [ ] **Step 3: Commit**

```bash
npx prettier --write test/unit/hub-node-session-metrics.spec.ts
git add test/unit/hub-node-session-metrics.spec.ts
git commit -m "test: a hub collects a node session's CPU and memory, live and at the end"
```

---

### Task 8: Docs, the whole suite and a live check

**Files:**
- Modify: `CLAUDE.md`
  - "Session performance": replace the "A node's phones get no figures"
    bullet.
  - "Per-command auth": after "Neither does a hub's heartbeat on a node's
    session", add a line on the metrics route.
  - Key Files: add rows for `NodeMetricsStore` and `NodeMetricsCollector`.

- [ ] **Step 1: Update CLAUDE.md**

Replace the bullet that starts "**A node's phones get no figures.**" with:

```markdown
- **A node's phones** (`NodeMetricsStore`, `NodeMetricsCollector`). A node
  samples its own phones for the sessions its hub creates, whatever its
  dashboard setting (`finalizeSession`), and holds the figures in memory: it
  has no Session row for them. The newest 900 per session; what the hub has
  collected is dropped; an ended session is kept 10 minutes. The node serves
  them at `GET /xenon/api/node/sessions/:id/metrics?after=` (beside the
  session-status route, ahead of the login, the same token rule). The hub
  asks every 10 s through the session's `RemoteSession`, in place of a phone
  sampler, so its buffer, writes and `recordingState` are the local ones,
  and asks once more when the session ends. After a hub restart it resumes
  from the newest sample it stored. An older node answers without
  `x-xenon-node-metrics`: its sessions say "isn't recorded", logged once per
  node, asked again after 10 minutes. Both sides need this release.
```

In the Key Files table, add:

```markdown
| `src/services/metrics/NodeMetricsStore.ts` | On a node: each sampled session's figures in memory for the hub to collect; dropped once collected, kept 10 minutes after the session ends |
| `src/services/metrics/NodeMetricsCollector.ts` | On a hub: a session on a node's phone sampled by asking the node every 10 s; never two asks at once, a last ask at the end |
```

- [ ] **Step 2: Run the whole suite, lint and the gates**

```bash
ANDROID_HOME=$HOME/Library/Android/sdk npm run test:all
cd web && npx vitest run && cd ..
DATABASE_URL='file:./ci-check.db' npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: all green, and "No difference detected". Compare ESLint counts per
changed file with main (`npx eslint --no-fix <file>`). They must not rise.

- [ ] **Step 3: Check it live**

Use the hub-and-node recipe in the scratchpad's `hubnode/`: a hub and a
node, each a scratch server built from this branch
(`npx tsc -b && npm run build:copy` after `npm run build:xenon`), never the
lab's checkout. Put the Galaxy S9+ on the node.

- Run a session through the hub on the S9+ (`POST <hub base>/session`) for
  about a minute, opening a few apps.
- On the hub's session page, the Performance panel fills as the session
  runs: device and app CPU and memory, the app's name in the tooltip.
- After the session ends, the figures are still there, ending with its last
  seconds.
- Restart the hub mid-session (SIGTERM, not kill). The chart carries on with
  no gap.
- If an iPhone is free, a session on it through the node shows device CPU.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: performance figures for a node's phones"
```
