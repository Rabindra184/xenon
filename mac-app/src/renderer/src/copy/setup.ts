// Setup's words. Each row of the Setup screen says one plain sentence, and the
// sentences for a Node.js or Appium that is missing or no good are the ones
// Home's "Can’t start yet" says, so the two never differ. A sentence never
// carries a command, a path or a raw message: those are the technical details,
// shown only with technical details on. The commands for them are `commands`
// below. The screen's own words (its header, groups, buttons and the Set up
// area) are under `screen`, `summary` and `steps`.
import { COMMON } from './common';

export const SETUP = {
  /** The Setup screen around the rows. */
  screen: {
    title: 'Setup',
    /** Looks at this Mac again: the rows, and whether Start is allowed. */
    checkAgain: 'Check again',
    /** Under the title, followed by how long ago the checks ran. */
    intro: 'Everything this Mac needs to run tests.',
    /** In This Mac and Phones, in place of their rows, until the first check is back. */
    checking: 'Checking…',
    groups: {
      mac: 'This Mac',
      xenon: 'Xenon',
      phones: 'Phones'
    },
    /** Above the reasons a start is refused that are not a row of their own (the port, a check that failed). */
    whyStartIsOff: 'Why Start is off',
    /** The one Set up button, under the groups, and a row's action that Set up fixes. */
    setUp: 'Set up this Mac',
    settingUp: 'Setting up…',
    setUpHint: 'Installs or updates whatever is missing.',
    /** Set up replaces files a running server uses (A3's hint). */
    serverActive: 'Stop the server to run Set up.',
    /** Check again can't look while Set up is changing what it would read. */
    waitForSetUp: 'Wait for Set up to finish.',
    /**
     * A row whose sentence does not say what it is about ("Needs Appium first.", "Couldn’t check which
     * phone support is installed.", said by both support rows) is led by its name.
     */
    named: (label: string, sentence: string): string => `${label}: ${sentence}`,
    /** A row the app can't fix itself (Node.js, Appium, Xcode, Android tools) links to the guide. */
    howToInstall: 'How to install',
    copy: COMMON.copy,
    /** The name of a row's Copy button, which starts with what it shows. */
    copyCommand: (label: string): string => `Copy the ${label} command`,
    copied: COMMON.copied,
    copyFailed: 'Couldn’t copy the command. Try again.',
    /** With technical details on, under the Xenon row: the Appium folder it is installed in, and how it was found. */
    appiumFolder: (path: string, source: string): string =>
      source === 'profile' ? `Appium folder: ${path} (set in this profile)` : `Appium folder: ${path} (found: ${source})`
  },

  /** Said (politely) when a check completes on Setup. */
  summary: {
    allPassed: 'All checks passed.',
    attention: (n: number): string => (n === 1 ? '1 thing needs attention.' : `${n} things need attention.`)
  },

  /** Set up's steps as it runs, on Home and Setup. */
  steps: {
    /** The steps, as a list. */
    label: 'Setup steps',
    /** A screen reader's word for each step's mark. */
    state: {
      running: 'In progress',
      ok: 'Done',
      note: 'Needs attention',
      failed: 'Failed'
    }
  },

  node: {
    /** The Node.js check, status missing. */
    missing: 'Node.js isn’t installed on this Mac. Appium needs it.',
    /** The Node.js check, status warn: it is there but the wrong version. */
    wrongVersion: 'This Mac’s Node.js version doesn’t work with Appium 3.',
    /** Appium and the two support rows while Node.js is not ok: what they found can't be trusted (R32). */
    needsFirst: 'Needs Node.js first.'
  },
  appium: {
    /** The Appium check, status missing. */
    missing: 'Appium isn’t installed on this Mac. Xenon needs Appium 3.1.1 or newer.',
    /** The Appium check, status warn: it is there but too old. */
    tooOld: 'This Mac’s Appium is too old. Xenon needs Appium 3.1.1 or newer.'
  },

  /** What each row is called. */
  labels: {
    node: 'Node.js',
    appium: 'Appium',
    androidTools: 'Android tools',
    xcode: 'Xcode',
    xenon: 'Xenon',
    androidSupport: 'Android support',
    iosSupport: 'iOS support',
    iphoneSupport: 'iPhone support'
  },

  /** The sentence of a row with nothing to do. */
  ready: {
    node: 'Node.js is ready.',
    appium: 'Appium is ready.',
    androidTools: 'Android tools are ready.',
    xcode: 'Xcode is ready.',
    iphoneSupport: 'iPhone support is ready.'
  },

  androidTools: {
    /** No adb and no Android SDK. */
    missing: 'Android tools aren’t installed. You need them only for Android phones on this Mac.',
    /** adb works, but no SDK folder can be named. */
    noSdkRoot: 'Android tools were found, but not where Xenon looks for them.'
  },

  xcode: {
    missing: 'Xcode isn’t installed. You need it only for iPhones and simulators.'
  },

  /** This Mac's one row when the check itself failed, so none of its rows could be said. */
  mac: {
    couldntCheck: 'Couldn’t check this Mac.'
  },

  xenon: {
    installed: (version: string): string => `Xenon ${version} is installed`,
    notInstalled: 'Xenon isn’t installed yet',
    /** The installed version has not been read yet. */
    checking: 'Checking Xenon…'
  },

  /** Android support and iOS support are the two drivers behind the drivers check. */
  androidSupport: {
    installed: 'Android support is installed.',
    missing: 'Android support isn’t installed yet.'
  },
  iosSupport: {
    installed: 'iOS support is installed.',
    missing: 'iOS support isn’t installed yet.'
  },
  /** Either of those two rows, when the drivers check could not tell. */
  support: {
    /** The driver list could not be read: not knowing, which is not "not installed". */
    couldntCheck: 'Couldn’t check which phone support is installed.',
    /** There is no Appium to ask. */
    needsAppium: 'Needs Appium first.'
  },

  iphoneSupport: {
    missing: 'iPhone support isn’t installed yet.',
    stale: 'iPhone support needs updating — Xenon was updated.'
  },

  /** What to type, for the technical details of a row that needs it. */
  commands: {
    installNode: 'brew install node@22',
    installAppium: 'npm i -g appium',
    updateAppium: 'npm i -g appium@latest',
    installAndroidDriver: 'appium driver install uiautomator2',
    installIosDriver: 'appium driver install xcuitest'
  },

  /** The Xenon row has no check of its own; these are its raw words, shown with technical details on. */
  xenonTechnical: {
    installed: (version: string): string => `xenon plugin ${version}`,
    notInstalled: 'xenon plugin not installed',
    checking: 'xenon plugin version not read yet'
  },

  /** How long ago the checks ran. */
  checked: {
    justNow: 'Checked just now.',
    minutes: (n: number): string => (n === 1 ? 'Checked 1 minute ago.' : `Checked ${n} minutes ago.`),
    hours: (n: number): string => (n === 1 ? 'Checked 1 hour ago.' : `Checked ${n} hours ago.`)
  }
} as const;
