/**
 * Runs an async job one at a time. A call made while one is under way is
 * refused with `busy()`, and not run alongside it; once that one has ended,
 * well or not, the next call runs. Set up uses it: two runs at once would
 * write the same Appium folder.
 */
export function oneAtATime<A extends unknown[], R>(
  job: (...args: A) => Promise<R>,
  busy: () => Error
): (...args: A) => Promise<R> {
  let running = false;
  return async (...args: A): Promise<R> => {
    if (running) throw busy();
    running = true;
    try {
      return await job(...args);
    } finally {
      running = false;
    }
  };
}
