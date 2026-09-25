/** Pure request parsing for the recordings router, kept testable without Express. */
export function parseClearBody(
  body: unknown,
): { ok: true; timecodeMs: number } | { ok: false; error: string } {
  const t = (body as { timecodeMs?: unknown } | null | undefined)?.timecodeMs;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
    return { ok: false, error: 'timecodeMs must be a finite number >= 0' };
  }
  return { ok: true, timecodeMs: Math.round(t) };
}
