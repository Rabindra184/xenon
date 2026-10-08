// Settings' words. Essentials says each everyday option in plain words: no
// option key, environment name, command or path in a label, a line of help,
// a choice or a unit. The catalog (essentials.ts) takes every one of its words
// from here, and the screen that draws it adds the rest.
export const SETTINGS = {
  /** The Settings place: its title and tabs, and what every tab says. */
  screen: {
    title: 'Settings',
    tabsLabel: 'Settings sections',
    tabs: {
      essentials: 'Essentials',
      all: 'All settings',
      keys: 'Keys & accounts'
    },
    /** Part A's list of every problem with the profile's settings, at the top of Settings. */
    issues: (n: number): string => `${n} validation ${n === 1 ? 'issue' : 'issues'}:`,
    issueLine: (label: string, message: string): string => `${label}: ${message}`,
    /** The switch at the bottom of Essentials; View > Show Technical Details is the same preference. */
    technicalDetails: 'Show technical details',
    technicalDetailsHelp: 'Option names, folders, commands and diagnostic lines',
    /** Under an option whose value a value saved in the dashboard replaces. */
    dashboardCanOverride: 'The dashboard can override this.',
    /** Under the port, base path or Appium folder, edited while the server runs: it keeps what it started with. */
    restartToUse: 'Restart the server to use this.'
  },

  /** The All settings tab. */
  allSettings: {
    search: 'Search settings',
    noMatch: (query: string): string => `No settings match ‘${query}’.`,
    /** A choice list's first choice: nothing chosen, so Xenon's default applies. */
    defaultChoice: 'Default',
    /** In place of a secret's box: "<label> is a secret — set it in Keys & accounts. …" */
    secretPointer: {
      before: 'is a secret — set it in',
      after: 'It is kept in this Mac’s Keychain, never in a file.'
    },
    openKeys: 'Open Keys & accounts',
    /** With technical details on, an option that can hold more than its parts (the proxy), as JSON. */
    asJson: (label: string): string => `${label} as JSON`,
    /** Under a cloud provider's address that holds a user name or key (R55): the save cuts them out. */
    cloudAddressCredentials: 'Leave your user name and key out of the address; save the key in Keys & accounts.'
  },

  /** All settings' Technical group, shown with technical details on (or while one of its settings is wrong). */
  technical: {
    title: 'Technical',
    basePath: 'Base path',
    appiumFolder: 'Appium folder',
    appiumFolderHelp: 'Leave blank to use the one found on this Mac.',
    appiumFolderAuto: (path: string): string => `auto: ${path}`,
    appiumFolderAutoUnknown: '(auto-detected)',
    appiumFolderOverride: 'Explicit override for this profile',
    appiumFolderDetected: (source: string, path: string): string => `Auto-detected (${source}): ${path}`,
    openAppiumFolder: 'Open Appium folder',
    keepAlive: 'Keep-alive timeout',
    seconds: 'seconds',
    previewLaunch: 'Preview launch',
    exportConfig: 'Export config',
    /** The environment variables a launch adds (EnvVarsEditor). */
    env: {
      title: 'Environment variables',
      help: 'Extra non-secret vars (e.g. OTEL_EXPORTER_OTLP_ENDPOINT). Stored in the profile; injected at launch.',
      add: 'Add',
      none: 'No extra environment variables.',
      namePlaceholder: 'KEY',
      valuePlaceholder: 'value',
      nameLabel: (n: number): string => `Variable ${n} name`,
      valueLabel: (n: number): string => `Variable ${n} value`,
      remove: 'Remove variable',
      /** A5's warning, for a variable named like a Keychain secret. Keys & accounts is another tab now, so "above" became its name. */
      secretName: (name: string, label: string): string =>
        `${name} belongs in Keys & accounts, under ${label}, where it is kept in the Keychain. Here it is saved in the profile as plain text.`
    }
  },

  /** What a number box says when its text can't be used (numberField.ts). */
  numberField: {
    notANumber: 'Enter a number.',
    wholeNumber: 'Enter a whole number.',
    atLeast: (min: number): string => `Enter ${min} or more.`,
    atMost: (max: number): string => `Enter ${max} or less.`
  },

  /** The Essentials tab's catalog. */
  essentials: {
    groups: {
      phones: 'Phones',
      tests: 'Tests',
      history: 'Recording & history',
      sharing: 'Sharing & sign-in',
      ai: 'AI help'
    },

    labels: {
      platform: 'Which phones',
      androidDeviceType: 'Android',
      bootedEmulators: 'Only emulators that are already running',
      iosDeviceType: 'iPhone',
      bootedSimulators: 'Only simulators that are already running',
      maxSessions: 'Tests at the same time',
      port: 'Port tests connect to',
      deviceAvailabilityTimeoutMs: 'Wait for a free phone up to',
      enableDashboard: 'Keep a full record of each test',
      buildCleanupDays: 'Keep history for',
      signIn: 'Ask people to sign in',
      hub: 'Share this Mac’s phones with a lab hub',
      hubAddress: 'Hub address',
      hubAccessKey: 'Access key',
      hubToken: 'Token',
      enableSelfHealing: 'Repair broken element lookups automatically',
      aiProvider: 'AI service',
      geminiKey: 'Gemini key',
      openaiKey: 'OpenAI key',
      anthropicKey: 'Claude key',
      aiBaseUrl: 'Ollama address'
    },

    /**
     * The one line of help beside a label, after an em dash: "Keep a full record of each test — steps,
     * screenshots and logs, in the dashboard". R49: Xenon records video either way, so the spec's
     * "video" is not what the record adds.
     */
    help: {
      enableDashboard: 'steps, screenshots and logs, in the dashboard'
    },

    /** The words on each choice of a segmented row. */
    choices: {
      platform: { android: 'Android', ios: 'iPhone', both: 'Both' },
      androidDeviceType: { real: 'Real phones', simulated: 'Emulators', both: 'Both' },
      iosDeviceType: { real: 'Real iPhones', simulated: 'Simulators', both: 'Both' },
      aiProvider: { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', ollama: 'Ollama' }
    },

    /**
     * Under "Tests at the same time" when the stored number is below 1 (set in All settings), which
     * Xenon reads as no limit (I2).
     */
    noLimit: '0 means no limit',

    /** The unit after a number box. */
    suffix: {
      minutes: 'min',
      days: 'days'
    },

    /** An example address in an empty box. */
    placeholders: {
      hubAddress: 'http://hub-mac:4723',
      aiBaseUrl: 'http://localhost:11434'
    }
  }
} as const;
