// Settings' words. Essentials says each everyday option in plain words: no
// option key, environment name, command or path in a label, a line of help,
// a choice or a unit. The catalog (essentials.ts) takes every one of its words
// from here, and the screen that draws it adds the rest.
export const SETTINGS = {
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

    /** The one line of help under a label. The spec shows it after an em dash: "Keep a full record of each test — video, steps and logs, in the dashboard". */
    help: {
      enableDashboard: 'video, steps and logs, in the dashboard'
    },

    /** The words on each choice of a segmented row. */
    choices: {
      platform: { android: 'Android', ios: 'iPhone', both: 'Both' },
      androidDeviceType: { real: 'Real phones', simulated: 'Emulators', both: 'Both' },
      iosDeviceType: { real: 'Real iPhones', simulated: 'Simulators', both: 'Both' },
      aiProvider: { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', ollama: 'Ollama' }
    },

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
