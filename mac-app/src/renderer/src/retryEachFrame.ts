/** The frame clock retryEachFrame runs on; the browser's by default. */
export interface FrameClock {
  request(cb: () => void): number;
  cancel(id: number): void;
}

const browserFrames: FrameClock = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id)
};

/**
 * Runs `attempt` now and then once a frame until it returns true, at most
 * `tries` times in all. For something that may not be drawn yet: Radix mounts a
 * newly chosen tab's panel in a render of its own, after the commit that chose
 * it. Returns a function that stops it.
 */
export function retryEachFrame(attempt: () => boolean, tries: number, clock: FrameClock = browserFrames): () => void {
  let frame: number | null = null;
  let made = 0;
  const run = () => {
    frame = null;
    if (attempt() || ++made >= tries) return;
    frame = clock.request(run);
  };
  run();
  return () => {
    if (frame !== null) clock.cancel(frame);
    frame = null;
  };
}
