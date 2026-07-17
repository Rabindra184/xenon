import { describe, it, expect } from 'vitest';
import { LogBatcher } from '../src/main/logBatcher';

// Regression guard for the log-emit batching that keeps a chatty Appium server
// from stalling the Electron main thread. The old ProcessSupervisor did one
// webContents.send per stdout line; the LogBatcher collapses that to a bounded
// number of emits. These lock in the anti-flood behaviour with the real
// production constants, so a future change that reintroduces per-line emits
// (or drops lines) fails loudly.
const FLUSH_MS = 80;
const MAX_BATCH = 250;

describe('LogBatcher under an Appium-style firehose', () => {
  it('collapses a large synchronous burst into a tiny number of emits', () => {
    const LINES = 5000; // a chatty boot / streaming chunk
    let emits = 0;
    let delivered = 0;
    const b = new LogBatcher<number>({
      flushMs: FLUSH_MS,
      maxBatch: MAX_BATCH,
      onFlush: (batch) => {
        emits += 1;
        delivered += batch.length;
      }
    });

    for (let i = 0; i < LINES; i++) b.push(i);
    b.flush(); // drain the tail

    expect(delivered).toBe(LINES); // nothing dropped
    expect(emits).toBe(Math.ceil(LINES / MAX_BATCH)); // 20 emits for 5000 lines
    expect(emits).toBeLessThan(LINES / 100); // >100× fewer main-thread IPC sends
  });

  it('keeps emits bounded when lines are spread across event-loop ticks', async () => {
    // Realistic: stdout 'data' chunks arrive over time, not all at once. With
    // ~10ms between chunks and an 80ms window, several chunks fold into one emit.
    const CHUNKS = 40;
    const LINES_PER_CHUNK = 30; // 1200 lines total
    let emits = 0;
    let delivered = 0;
    const b = new LogBatcher<number>({
      flushMs: FLUSH_MS,
      maxBatch: MAX_BATCH,
      onFlush: (batch) => {
        emits += 1;
        delivered += batch.length;
      }
    });

    for (let c = 0; c < CHUNKS; c++) {
      for (let i = 0; i < LINES_PER_CHUNK; i++) b.push(c * LINES_PER_CHUNK + i);
      await new Promise((r) => setTimeout(r, 10));
    }
    b.flush();

    const total = CHUNKS * LINES_PER_CHUNK;
    expect(delivered).toBe(total); // nothing dropped
    // ~10ms/chunk into 80ms windows ⇒ far fewer emits than chunks, never per-line.
    expect(emits).toBeLessThan(CHUNKS);
  });
});
