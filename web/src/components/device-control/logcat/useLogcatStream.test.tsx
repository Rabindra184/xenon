import * as React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLogcatStream, type LogcatRecord, type LogcatStreamState } from './useLogcatStream';

// ---------------------------------------------------------------------------
// Fake WebSocket — jsdom has no real network stack, and the hook drives the
// socket entirely through onopen/onmessage/onclose, so a hand-rolled fake
// that lets tests fire those events is simpler and more precise than any
// mock-server library.
// ---------------------------------------------------------------------------
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  // Called by the hook itself (e.g. ws.close() in the effect cleanup, or
  // ws.onerror = () => ws.close()). Deliberately does NOT fire `onclose`:
  // a real browser's close handshake is asynchronous — `onclose` fires on
  // a later turn of the event loop, not synchronously inside the `close()`
  // call — so a test relying on this firing onclose immediately would be
  // testing a fake that is easier on the hook than any real WebSocket,
  // masking bugs a synchronous fake would hide (see the effect-cleanup
  // flush() test below, which exists because of exactly this trap).
  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  // --- test-only helpers simulating the server side ---
  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  serverMessage(record: unknown) {
    this.onmessage?.({ data: JSON.stringify(record) });
  }
  serverClose(code: number, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

const rec = (over: Partial<LogcatRecord> = {}): LogcatRecord => ({
  ts: 1000,
  pid: 1,
  tid: 1,
  level: 'D',
  tag: 'Tag',
  message: 'msg',
  ...over,
});

// React 17 + @testing-library/react 11 predates `renderHook`; a null-render
// probe that reports the hook's return value via a prop callback is the
// established pattern in this repo — see src/hooks/useIdleDetector.test.ts.
interface ProbeProps {
  udid: string;
  enabled: boolean;
  onState: (s: LogcatStreamState) => void;
}
function Probe({ udid, enabled, onState }: ProbeProps) {
  const state = useLogcatStream(udid, enabled);
  React.useEffect(() => {
    onState(state);
  });
  return null;
}

// IMPORTANT: `probe.state` must be read fresh via the getter on every access
// (`probe.state.foo`) — destructuring it (`const { state } = renderProbe()`)
// or spreading the probe object (`{ ...probe }`) evaluates the getter once
// and freezes a stale snapshot instead of a live read.
function renderProbe(udid = 'DEV-1', enabled = true) {
  let latest!: LogcatStreamState;
  const onState = (s: LogcatStreamState) => {
    latest = s;
  };
  const utils = render(React.createElement(Probe, { udid, enabled, onState }));
  return {
    ...utils,
    get state() {
      return latest;
    },
  };
}

// Advances fake timers AND drains the microtask queue between ticks, so a
// pending `fetch(...).then(...)` chain resolves along the way — plain
// `vi.advanceTimersByTime` does not touch the promise queue.
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// `any` deliberately: successive tests stub varying fetch response shapes
// (missing `json`, rejected, etc.) that a single precise mock type can't cover.
let fetchMock: any;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  (global as any).WebSocket = FakeWebSocket;
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ticket: 'tkt-1' }),
  }));
  (global as any).fetch = fetchMock;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useLogcatStream — connecting', () => {
  it('mints a ticket then opens a WS at the ticket-authenticated logcat URL', async () => {
    renderProbe('DEV-1');
    await tick();

    expect(fetchMock).toHaveBeenCalledWith(
      '/xenon/api/control/DEV-1/stream/ticket',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain(
      '/xenon/api/control/DEV-1/logcat?ticket=tkt-1',
    );
  });

  it('reports connected only after the socket actually opens', async () => {
    const probe = renderProbe('DEV-1');
    await tick();
    expect(probe.state.connected).toBe(false);

    act(() => FakeWebSocket.instances[0].serverOpen());
    expect(probe.state.connected).toBe(true);
  });

  it('does not connect at all when disabled', async () => {
    renderProbe('DEV-1', false);
    await tick(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe('useLogcatStream — ticket fetch failures (correction 2)', () => {
  // Previously: `if (cancelledRef.current || !ticket) return;` with no
  // `res.ok` check — a non-2xx ticket response silently killed the pane
  // (no retry scheduled), while a thrown fetch error DID retry. Both must
  // now retry identically.
  it('retries after a non-OK ticket response instead of going silent', async () => {
    // The body deliberately DOES carry a `ticket` even though `ok` is
    // false (a real 500 wouldn't, but this isolates the `res.ok` check from
    // the separate `!ticket` guard below it — without this, a mutant that
    // deletes the `res.ok` check would still be caught by `!ticket` alone,
    // and this test would pass for the wrong reason).
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ticket: 'should-be-ignored' }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ticket: 'tkt-2' }) });

    renderProbe('DEV-1');
    await tick(); // first attempt: res.ok === false
    expect(FakeWebSocket.instances).toHaveLength(0); // no socket opened yet
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await tick(1000); // past the first backoff delay (500ms)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain('ticket=tkt-2');
  });

  it('retries when the ticket response is OK but carries no ticket', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ticket: 'tkt-2' }) });

    renderProbe('DEV-1');
    await tick();
    expect(FakeWebSocket.instances).toHaveLength(0);

    await tick(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('retries when the ticket fetch itself throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ticket: 'tkt-2' }) });

    renderProbe('DEV-1');
    await tick();
    expect(FakeWebSocket.instances).toHaveLength(0);

    await tick(1000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('useLogcatStream — close-code branching (correction 1)', () => {
  async function connectAndOpen(udid = 'DEV-1') {
    const probe = renderProbe(udid);
    await tick();
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    act(() => ws.serverOpen());
    return { probe, ws };
  }

  it('1008 is terminal: surfaces the reason and never reconnects', async () => {
    const { probe, ws } = await connectAndOpen();

    act(() => ws.serverClose(1008, 'device held by another user'));

    expect(probe.state.connected).toBe(false);
    expect(probe.state.deniedReason).toBe('device held by another user');
    expect(probe.state.exhausted).toBe(false);

    // Advance well past every backoff step (max 10s) and the full attempt
    // budget (10 attempts) — a second socket must never appear.
    await tick(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('falls back to a generic reason when the server sends none', async () => {
    const { probe, ws } = await connectAndOpen();
    act(() => ws.serverClose(1008, ''));
    expect(probe.state.deniedReason).toBe('access denied');
  });

  it('1012 reconnects through the bounded backoff path, without denying or warning', async () => {
    const { probe, ws } = await connectAndOpen();

    act(() => ws.serverClose(1012, 'stream ended (process exited)'));
    expect(probe.state.deniedReason).toBeNull();
    expect(probe.state.connected).toBe(false);
    // eslint-disable-next-line no-console
    expect(console.warn).not.toHaveBeenCalled();

    await tick(600); // > BACKOFF_START_MS (500ms)
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('an abnormal close (e.g. 1006) also reconnects, but is logged as unexpected', async () => {
    const { probe, ws } = await connectAndOpen();

    act(() => ws.serverClose(1006, ''));
    expect(probe.state.deniedReason).toBeNull();
    // eslint-disable-next-line no-console
    expect(console.warn).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line no-console
    expect((console.warn as any).mock.calls[0][0]).toMatch(/1006/);

    await tick(600);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  // Regression guard for the original bug: EVERY close code used to retry,
  // including 1008. This pins that 1008 is singled out — if the 1008 branch
  // were ever deleted (falling through to the generic retry), this test and
  // the "1008 is terminal" test above would both go red.
  it('does not warn on an authorization denial the way it warns on an abnormal close', async () => {
    const { ws } = await connectAndOpen();
    act(() => ws.serverClose(1008, 'device held by another user'));
    // eslint-disable-next-line no-console
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('useLogcatStream — ticket freshness', () => {
  it('mints a FRESH ticket for every reconnect', async () => {
    let minted = 0;
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ ticket: `tkt-${++minted}` }),
    }));

    renderProbe('DEV-1');
    await tick();
    act(() => FakeWebSocket.instances[0].serverOpen());
    expect(FakeWebSocket.instances[0].url).toContain('ticket=tkt-1');

    act(() => FakeWebSocket.instances[0].serverClose(1006, ''));
    await tick(600);

    // Stream tickets are single-use. Caching the first one and replaying it
    // on reconnect would hand the server a spent ticket, which it rejects
    // with 1008 — a code this hook treats as TERMINAL — so the pane would go
    // permanently DENIED after the first wifi blip. The reconnect tests
    // above only count sockets, and every test that asserts a ticket value
    // follows a FAILED first mint, so no ticket ever existed to be cached:
    // nothing else here can see a regression to caching.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toContain('ticket=tkt-2');
    expect(FakeWebSocket.instances[1].url).not.toContain('ticket=tkt-1');
  });
});

describe('useLogcatStream — retry exhaustion (correction 3)', () => {
  it('goes exhausted after MAX_ATTEMPTS failed connects, and stays disconnected quietly no longer', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    const probe = renderProbe('DEV-1');

    // Backoff schedule (500ms doubling, capped at 10s) puts the 10th and
    // final scheduled retry's connect attempt at cumulative t=65500ms:
    // 1 immediate attempt + retries at +500, +1000, +2000, +4000, +8000,
    // then five more at the 10s cap (+10000 each) = 10 connect attempts by
    // t=60000, an 11th (final) attempt at t=65500. Straddling that exact
    // point — not exhausted just before, exhausted just after — is what
    // pins MAX_ATTEMPTS=10 rather than merely "eventually gives up".
    await tick(60_000);
    expect(probe.state.exhausted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(10);

    await tick(10_000); // past t=65500: the 11th (final) attempt fires and fails
    expect(probe.state.exhausted).toBe(true);
    expect(probe.state.connected).toBe(false);
    expect(probe.state.deniedReason).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(11);

    // No further attempts, however long we wait — the whole point of
    // "exhausted" is that the loop has stopped.
    await tick(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });

  it('retry() clears the exhausted state and restarts the connect loop', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    const probe = renderProbe('DEV-1');
    await tick(600_000);
    expect(probe.state.exhausted).toBe(true);

    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ ticket: 'tkt-9' }),
    }));
    act(() => probe.state.retry());
    expect(probe.state.exhausted).toBe(false);

    await tick();
    expect(FakeWebSocket.instances[FakeWebSocket.instances.length - 1].url).toContain('tkt-9');
  });

  // The test above makes the FIRST retry succeed, so `onopen` resets the
  // attempt counter and `retry()`'s own reset never has to do anything — the
  // input cannot reach the boundary this pins. Keep both: that one covers the
  // happy path, this one covers the budget.
  it('retry() refills the attempt budget: a retry that keeps failing runs a full fresh ladder', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    const probe = renderProbe('DEV-1');
    await tick(600_000);
    expect(probe.state.exhausted).toBe(true);
    // 1 immediate attempt + MAX_ATTEMPTS (10) scheduled retries.
    expect(fetchMock).toHaveBeenCalledTimes(11);

    act(() => probe.state.retry());
    expect(probe.state.exhausted).toBe(false);
    await tick(600_000);

    // Without resetting the counter, retry() would make exactly ONE attempt
    // and re-exhaust on it (the counter is still parked at MAX_ATTEMPTS), so
    // the RECONNECT button would silently degrade to a single try after its
    // first use. A fresh ladder is another 11 attempts, not 1.
    expect(fetchMock).toHaveBeenCalledTimes(22);
    expect(probe.state.exhausted).toBe(true);
  });

  it('a successful open replenishes the budget: MAX_ATTEMPTS means 10 CONSECUTIVE failures', async () => {
    const probe = renderProbe('DEV-1');
    await tick();

    // A long-lived tab: ten disconnects that each RECONNECT SUCCESSFULLY.
    // None of them may count against the retry budget.
    for (let i = 0; i < 10; i++) {
      const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
      act(() => ws.serverOpen());
      act(() => ws.serverClose(1006, ''));
      // Deliberately generous: a hook that never reset the counter would
      // climb to the 10s backoff cap, and this must still give it its socket
      // — the assertion below is about the BUDGET, not about timing out.
      await tick(20_000);
      expect(probe.state.exhausted).toBe(false);
      expect(FakeWebSocket.instances).toHaveLength(i + 2);
    }

    // The 11th disconnect. Without the reset in `onopen` the counter now sits
    // at MAX_ATTEMPTS, so this one goes straight to OFFLINE and never
    // reconnects — even though every single reconnect so far worked.
    const last = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    act(() => last.serverOpen());
    act(() => last.serverClose(1006, ''));
    await tick(20_000);

    expect(probe.state.exhausted).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(12);
  });

  it('retry() also clears a 1008 denial and restarts the connect loop', async () => {
    const probe = renderProbe('DEV-1');
    await tick();
    act(() => FakeWebSocket.instances[0].serverOpen());
    act(() => FakeWebSocket.instances[0].serverClose(1008, 'device held by another user'));
    expect(probe.state.deniedReason).toBe('device held by another user');

    act(() => probe.state.retry());
    expect(probe.state.deniedReason).toBeNull();

    await tick();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

describe('useLogcatStream — frame batching (correction 4)', () => {
  it('does not apply a burst of frames to `records` until the flush window elapses', async () => {
    const probe = renderProbe('DEV-1');
    await tick();
    const ws = FakeWebSocket.instances[0];
    act(() => ws.serverOpen());

    act(() => {
      ws.serverMessage(rec({ message: 'one' }));
      ws.serverMessage(rec({ message: 'two' }));
      ws.serverMessage(rec({ message: 'three' }));
    });
    // Three frames landed above; none should have reached `records` yet —
    // this is what proves they were coalesced rather than applied one
    // setState-per-line the instant each arrived.
    expect(probe.state.records).toHaveLength(0);

    await tick(50); // the flush window
    expect(probe.state.records.map((r) => r.message)).toEqual(['one', 'two', 'three']);
  });

  it('keeps accumulating and delivers everything once flushed, across more than one flush window', async () => {
    const probe = renderProbe('DEV-1');
    await tick();
    const ws = FakeWebSocket.instances[0];
    act(() => ws.serverOpen());

    act(() => ws.serverMessage(rec({ message: 'a' })));
    await tick(50);
    act(() => ws.serverMessage(rec({ message: 'b' })));
    await tick(50);

    expect(probe.state.records.map((r) => r.message)).toEqual(['a', 'b']);
  });

  it('flushes whatever is pending on teardown (udid change) instead of dropping it', async () => {
    let latest!: LogcatStreamState;
    const onState = (s: LogcatStreamState) => {
      latest = s;
    };
    const { rerender } = render(
      React.createElement(Probe, { udid: 'DEV-1', enabled: true, onState }),
    );
    await tick();
    const ws = FakeWebSocket.instances[0];
    act(() => ws.serverOpen());
    act(() => ws.serverMessage(rec({ message: 'pending-on-teardown' })));
    // Still inside the coalescing window — nothing flushed yet.
    expect(latest.records).toHaveLength(0);

    // A udid change tears down this connection's effect: React runs the
    // exact same cleanup function that an unmount would run. If that
    // cleanup didn't flush, this record would sit orphaned in the internal
    // buffer forever (nothing left to trigger a future flush for it).
    rerender(React.createElement(Probe, { udid: 'DEV-2', enabled: true, onState }));
    expect(latest.records.map((r) => r.message)).toEqual(['pending-on-teardown']);
  });

  it('caps the buffer at 5000 records, keeping the most recent', async () => {
    const probe = renderProbe('DEV-1');
    await tick();
    const ws = FakeWebSocket.instances[0];
    act(() => ws.serverOpen());

    act(() => {
      for (let i = 0; i < 5005; i++) {
        ws.serverMessage(rec({ message: `line-${i}` }));
      }
    });
    await tick(50);

    expect(probe.state.records).toHaveLength(5000);
    expect(probe.state.records[0].message).toBe('line-5');
    expect(probe.state.records[4999].message).toBe('line-5004');
  });
});

describe('useLogcatStream — reconnect must not duplicate the server replay', () => {
  // The whole point of replacing the 3-second `adb logcat -d` poll was that
  // the poll re-appended the same lines every tick until the buffer held them
  // twice. The stream reintroduces that on reconnect unless the buffer is
  // reset: `LogcatMultiplexer.addClient` replays its whole buffer
  // (REPLAY_BUFFER_SIZE = 2000) to every joining client, and the mux outlives
  // a client disconnect by IDLE_TIMEOUT_MS = 30s — longer than this hook's
  // entire 0.5–10s backoff ladder. So a reconnect inside that window lands on
  // a LIVE mux and is handed the same records again.
  //
  // 1006 (a wifi blip, sleep/wake, a proxy timeout) is the reachable path:
  // the 1012 path tears the mux down upstream, so its replay is empty and the
  // existing 1012 reconnect test structurally cannot catch this.
  it('drops the old buffer on reconnect instead of appending the replay twice', async () => {
    const probe = renderProbe('DEV-1');
    await tick();
    const first = FakeWebSocket.instances[0];
    act(() => first.serverOpen());

    // The fixture MUST actually hold records before the reconnect, or the
    // no-duplication assertion below is vacuous.
    act(() => {
      first.serverMessage(rec({ message: 'replayed-1' }));
      first.serverMessage(rec({ message: 'replayed-2' }));
    });
    await tick(50);
    expect(probe.state.records.map((r) => r.message)).toEqual(['replayed-1', 'replayed-2']);

    act(() => first.serverClose(1006, ''));
    await tick(600);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // The still-live mux replays what this client already has, then carries on.
    const second = FakeWebSocket.instances[1];
    act(() => second.serverOpen());
    act(() => {
      second.serverMessage(rec({ message: 'replayed-1' }));
      second.serverMessage(rec({ message: 'replayed-2' }));
      second.serverMessage(rec({ message: 'new-after-reconnect' }));
    });
    await tick(50);

    expect(probe.state.records.map((r) => r.message)).toEqual([
      'replayed-1',
      'replayed-2',
      'new-after-reconnect',
    ]);
  });

  // The mirror of the test above, and the reason the reset is conditional
  // rather than unconditional. 1012 means the upstream logcat died;
  // LogcatStreamService deletes the session BEFORE closing the mux, so the
  // reconnect gets a NEW multiplexer with an empty replay. Clearing there
  // discards up to 5000 records and gets nothing back — blanking the pane at
  // the one moment the preceding lines matter most, and erasing the server's
  // synthetic end-of-stream marker roughly 500ms after it arrived. That marker
  // is deliberately unfilterable so that loss is never silent; wiping it here
  // would reintroduce silent loss by the back door.
  it('keeps the buffer across a 1012 reconnect, where the server has no replay left', async () => {
    const probe = renderProbe('DEV-1');
    await tick();
    const first = FakeWebSocket.instances[0];
    act(() => first.serverOpen());

    act(() => {
      first.serverMessage(rec({ message: 'before-the-device-died' }));
      first.serverMessage(
        rec({ message: 'log stream ended (process exited)', level: 'E', synthetic: true }),
      );
    });
    await tick(50);
    expect(probe.state.records).toHaveLength(2);

    act(() => first.serverClose(1012, 'stream ended'));
    await tick(600);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // The new mux replays nothing. If onopen cleared here, the pane would go
    // blank and the end-of-stream marker would be gone.
    act(() => FakeWebSocket.instances[1].serverOpen());
    await tick(50);

    expect(probe.state.records.map((r) => r.message)).toEqual([
      'before-the-device-died',
      'log stream ended (process exited)',
    ]);
  });

  it('gives every record a unique, monotonic seq across clear() and a reconnect', async () => {
    const probe = renderProbe('DEV-1');
    await tick();
    const first = FakeWebSocket.instances[0];
    act(() => first.serverOpen());
    act(() => first.serverMessage(rec({ message: 'a' })));
    await tick(50);
    act(() => probe.state.clear());
    act(() => first.serverClose(1006, ''));
    await tick(600);
    const second = FakeWebSocket.instances[1];
    act(() => second.serverOpen());
    act(() => {
      second.serverMessage(rec({ message: 'b' }));
      second.serverMessage(rec({ message: 'c' }));
    });
    await tick(50);

    // Rows are keyed on `seq`, so a counter that restarted on clear() or on a
    // reconnect could hand React two mounted rows the same key.
    const seqs = probe.state.records.map((r) => r.seq);
    expect(seqs).toEqual([1, 2]);
  });
});

describe('useLogcatStream — clear()', () => {
  it('empties the buffer', async () => {
    const probe = renderProbe('DEV-1');
    await tick();
    const ws = FakeWebSocket.instances[0];
    act(() => ws.serverOpen());
    act(() => ws.serverMessage(rec({ message: 'one' })));
    await tick(50);
    expect(probe.state.records).toHaveLength(1);

    act(() => probe.state.clear());
    expect(probe.state.records).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Per-run cancellation. The effect's cancellation token used to be a ref
// shared across runs, so the socket a filter change had just closed came back
// from the dead — see the docblock on `run` in useLogcatStream.ts.
// ---------------------------------------------------------------------------
/** First retry lands at BACKOFF_START_MS; overshoot so the timer has fired. */
const BACKOFF_AFTER_FIRST_ATTEMPT_MS = 600;

describe('useLogcatStream — changing the source filter', () => {
  interface FilterProbeProps {
    sourceFilter: { levels?: string[]; process?: string };
  }
  function FilterProbe({ sourceFilter }: FilterProbeProps) {
    useLogcatStream('DEV-1', true, sourceFilter);
    return null;
  }
  const renderFilterProbe = (sourceFilter: FilterProbeProps['sourceFilter']) =>
    render(React.createElement(FilterProbe, { sourceFilter }));

  const params = (ws: FakeWebSocket) => {
    const q = new URLSearchParams(ws.url.split('?')[1]);
    return { levels: q.get('levels'), process: q.get('process') };
  };

  it('serialises the filter into the upgrade URL and reconnects when it changes', async () => {
    const utils = renderFilterProbe({ levels: ['Info'], process: 'wifid' });
    await tick();
    expect(params(FakeWebSocket.instances[0])).to.deep.equal({
      levels: 'Info',
      process: 'wifid',
    });

    utils.rerender(
      React.createElement(FilterProbe, { sourceFilter: { levels: ['Fault'], process: 'wifid' } }),
    );
    await tick();
    expect(FakeWebSocket.instances).to.have.length(2);
    expect(params(FakeWebSocket.instances[1])).to.deep.equal({
      levels: 'Fault',
      process: 'wifid',
    });
    expect(FakeWebSocket.instances[0].closeCalls, 'the old socket is closed').to.have.length(1);
  });

  // The leak. A real browser delivers `onclose` on a later turn, so the socket
  // cleanup closed still reports its death AFTER the next effect run has
  // started. With a shared token that run had already reset it to false, so
  // this close read as unexpected, retried on the 500ms backoff, and opened a
  // THIRD socket carrying the FIRST run's filter — which then overwrote
  // wsRef.current and orphaned the correct one. Measured on hardware as 16
  // connects against 4 disconnects from one tab.
  it('does not resurrect the socket a filter change closed', async () => {
    const utils = renderFilterProbe({ levels: ['Info'], process: 'wifid' });
    await tick();
    const first = FakeWebSocket.instances[0];

    utils.rerender(
      React.createElement(FilterProbe, { sourceFilter: { levels: ['Fault'], process: 'wifid' } }),
    );
    await tick();

    // The close event for the socket cleanup already closed, arriving late as
    // a real one does. 1006 is the abnormal code a dropped connection gives.
    await act(async () => {
      first.serverClose(1006);
    });
    await tick(BACKOFF_AFTER_FIRST_ATTEMPT_MS);

    expect(
      FakeWebSocket.instances,
      'a late close on a superseded socket must not open another',
    ).to.have.length(2);
    expect(
      params(FakeWebSocket.instances[1]),
      'the surviving socket keeps the new filter',
    ).to.deep.equal({ levels: 'Fault', process: 'wifid' });
  });

  // The other half of the same token: cancellation must still apply WITHIN a
  // run, or a genuinely dropped socket would never come back.
  it('still reconnects when the live socket drops', async () => {
    renderFilterProbe({ levels: ['Info'], process: 'wifid' });
    await tick();
    await act(async () => {
      FakeWebSocket.instances[0].serverOpen();
      FakeWebSocket.instances[0].serverClose(1006);
    });
    await tick(BACKOFF_AFTER_FIRST_ATTEMPT_MS);
    expect(FakeWebSocket.instances).to.have.length(2);
  });
});
