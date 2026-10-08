// Main-process text that reaches the window. Later changes add their sentences
// here rather than inline.
export const MAIN_COPY = {
  /** A Set up asked for while one is still running (a window opened again mid-run asks anew). */
  setupAlreadyRunning: 'Set up is already running. Wait for it to finish.',
  /** A launch config file (an older version's can hold a password or key) that could not be deleted. */
  launchConfigNotDeleted: 'Could not delete a launch config file, which may hold a password or key.'
} as const;
