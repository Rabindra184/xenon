/**
 * Serialises recording writes (marks, clears) in the order the user made them.
 * A Clear sent while a mark's POST is still in flight could otherwise reach the
 * server first, and the mark, created after the clear, would stay in the video
 * until the end. A failed write does not stall the ones after it.
 */
export function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const run = tail.then(task, task);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
