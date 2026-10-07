// Main-process text that reaches the window. Later changes add their sentences
// here rather than inline.
export const MAIN_COPY = {
  /** A Set up asked for while one is still running (a window opened again mid-run asks anew). */
  setupAlreadyRunning: 'Set up is already running. Wait for it to finish.'
} as const;
