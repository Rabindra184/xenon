// The window's frame: the sidebar (profile switcher, places, status and
// Start/Stop) and, until each place gets its own screen, what the places show.
// Home, Setup and Settings have their own words (copy/home.ts, copy/setup.ts,
// copy/settings.ts and copy/keys.ts).

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
  /** The line under each profile in the switcher and the Profiles sheet: "Android and iPhone · port 4723". */
  profileSummary: {
    phones: {
      android: 'Android',
      ios: 'iPhone',
      both: 'Android and iPhone'
    },
    line: (phones: string, port: number) => `${phones} · port ${port}`
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
    openDashboard: 'Open dashboard'
  },
  /** The config export, from the Server menu, Settings' Technical group and the launch preview. */
  settings: {
    configSaved: 'Config saved',
    /** The export threw: the file may not have been written. */
    exportConfigFailed: 'Couldn’t export the config. Try again, or save it to another folder.'
  },
  logs: {
    openLogFolder: 'Open log folder'
  }
} as const;
