// The window's frame: the sidebar (profile switcher, places, status and
// Start/Stop) and, until each place gets its own screen, what the places show.
// Home has its own words (copy/home.ts).

export const SHELL = {
  skipToContent: 'Skip to content',
  places: {
    label: 'Places',
    home: 'Home',
    setup: 'Setup',
    settings: 'Settings',
    logs: 'Logs',
    /** The "!" on Setup. */
    needsAttention: 'Needs attention',
    /** The dot on Logs after the server stops unexpectedly. */
    newProblem: 'New problem'
  },
  switcher: {
    noProfile: 'No profile'
  },
  status: {
    /** The status word is a button that goes Home. */
    showHome: 'Show Home',
    start: 'Start',
    stop: 'Stop'
  },
  noProfiles: 'No profiles yet.',
  newProfile: 'New profile',
  loading: 'Loading…',
  home: {
    openDashboard: 'Open dashboard',
    /** Above the list of reasons Start is off, on Setup. */
    whyStartIsOff: 'Why Start is off:'
  },
  settings: {
    sections: 'Settings sections',
    allSettings: 'All settings',
    keysAndAccounts: 'Keys & accounts',
    issues: (n: number) => `${n} validation ${n === 1 ? 'issue' : 'issues'}:`,
    server: 'Server',
    port: 'Port',
    basePath: 'Base path',
    appiumFolder: 'Appium folder',
    appiumFolderHelp: 'Leave blank to use the one found on this Mac.',
    appiumFolderAuto: (path: string) => `auto: ${path}`,
    appiumFolderAutoUnknown: '(auto-detected)',
    appiumFolderOverride: 'Explicit override for this profile',
    appiumFolderDetected: (source: string, path: string) => `Auto-detected (${source}): ${path}`,
    openAppiumFolder: 'Open Appium folder',
    keepAlive: 'Keep-alive timeout',
    seconds: 'seconds',
    /** The group of base path, Appium folder, keep-alive, preview and export, shown with technical details. */
    technical: 'Technical',
    previewLaunch: 'Preview launch',
    exportConfig: 'Export config',
    configSaved: 'Config saved',
    /** The export threw: the file may not have been written. */
    exportConfigFailed: 'Couldn’t export the config. Try again, or save it to another folder.',
    /** The switch at the bottom of Settings; View > Show Technical Details is the same preference. */
    technicalDetails: 'Show technical details',
    technicalDetailsHelp: 'Option names, folders, commands and diagnostic lines',
    /** A secret-bearing setting points at where its value is kept: "<label> is a secret — set it in Keys & accounts (…)". */
    secretPointer: {
      before: 'is a secret — set it in',
      after: '(stored in the Keychain, injected as an env var). Not written to the config file.'
    }
  },
  setup: {
    /** Looks at this Mac again: the rows below, and whether Start is allowed. */
    checkAgain: 'Check again'
  },
  logs: {
    openLogFolder: 'Open log folder'
  }
} as const;
