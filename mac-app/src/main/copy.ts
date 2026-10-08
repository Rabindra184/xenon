// Main-process text that reaches the window. Later changes add their sentences
// here rather than inline.
export const MAIN_COPY = {
  /** A Set up asked for while one is still running (a window opened again mid-run asks anew). */
  setupAlreadyRunning: 'Set up is already running. Wait for it to finish.',
  /** A launch config file (an older version's can hold a password or key) that could not be deleted. */
  launchConfigNotDeleted: 'Could not delete a launch config file, which may hold a password or key.',
  /** Open Appium folder (or log folder) asked for a folder that isn't there. */
  openFolderMissing: 'That folder isn’t there.',
  /** …or for something that is not a folder to look in: a file, a script, an app. Nothing is opened. */
  openNotAFolder: 'That isn’t a folder, so it wasn’t opened.',
  /** The save dialog Logs opens for Save as…. */
  saveLogsTitle: 'Save logs',
  textFileFilter: 'Text file'
} as const;
