// The window's frame: the sidebar (profile switcher, places, status and
// Start/Stop) and, until each place gets its own screen, what the places show.

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
    /** While running: the port and how long it has been up. */
    runningOn: (port: number, uptime: string) => `Port ${port} · up ${uptime}`,
    openDashboard: 'Open dashboard',
    lastMessage: 'Last message',
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
    previewLaunch: 'Preview launch',
    /** A secret-bearing setting points at where its value is kept: "<label> is a secret — set it in Keys & accounts (…)". */
    secretPointer: {
      before: 'is a secret — set it in',
      after: '(stored in the Keychain, injected as an env var). Not written to the config file.'
    }
  },
  logs: {
    openLogFolder: 'Open log folder'
  }
} as const;
