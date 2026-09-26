/** "Captured 12 s ago": how old the tree and highlights are. */
export function captureAge(capturedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - capturedAt) / 1000));
  if (s < 5) return 'Captured just now';
  if (s < 60) return `Captured ${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Captured ${m} min ago`;
  return `Captured ${Math.floor(m / 60)} h ago`;
}

/** Whether an input reached the phone after the capture was taken. */
export function isStale(capturedAt: number, lastActionAt: number): boolean {
  return capturedAt > 0 && lastActionAt > capturedAt;
}
