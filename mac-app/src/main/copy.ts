// Main-process text that reaches the window. Later changes add their sentences
// here rather than inline.
export const MAIN_COPY = {
  /** A Set up asked for while one is still running (a window opened again mid-run asks anew). */
  setupAlreadyRunning: 'Set up is already running. Wait for it to finish.',
  /** A launch config file (an older version's can hold a password or key) that could not be deleted. */
  launchConfigNotDeleted: 'Could not delete a launch config file, which may hold a password or key.',
  /** A profile whose id would put its launch config outside the app's folder (an edited import). */
  profileIdNotUsable: 'This profile can’t be started as it is. Duplicate it in Profiles and start the copy.',
  /** The save dialog Logs opens for Save as…. */
  saveLogsTitle: 'Save logs',
  textFileFilter: 'Text file'
} as const;
