// Home: the words for each state it can be in, and for the quick fixes on
// "Can’t start". The models (homeState, quickFix) take every string from here.
// Button words that mean the same everywhere come from the shared copy.
import { COMMON } from './common';
import { SHELL } from './shell';

export const HOME = {
  /** Another profile’s server is active. Only one profile runs at a time. */
  otherRunning: {
    title: (name: string) => `“${name}” is running`,
    sentence: 'Only one profile runs at a time. Stop it to start this one.',
    /** The running profile was deleted, so there is nothing to switch to. */
    removedTitle: 'A removed profile is still running',
    removedSentence: 'Stop it to start this one.',
    switchTo: 'Switch to it'
  },
  starting: {
    title: 'Starting…',
    sentence: 'Usually under 10 seconds.'
  },
  running: {
    title: 'Running',
    openDashboard: SHELL.home.openDashboard,
    /** After the title: "Running for 1 h 12 min". */
    forUnderMinute: 'for under a minute',
    forMinutes: (min: number) => `for ${min} min`,
    forHours: (h: number) => `for ${h} h`,
    forHoursMinutes: (h: number, min: number) => `for ${h} h ${min} min`
  },
  stopping: {
    title: 'Stopping — saving recordings and releasing phones…'
  },
  settingUp: {
    title: 'Setting up this Mac…',
    /** The steps of the run, as a list. */
    stepsLabel: 'Setup steps',
    /** A screen reader's word for each step's mark. */
    step: {
      running: 'In progress',
      ok: 'Done',
      note: 'Needs attention',
      failed: 'Failed'
    }
  },
  crashed: {
    title: 'Xenon stopped unexpectedly',
    /** The last line the server printed, quoted. */
    lastMessage: (message: string) => `Last message: “${message}”`,
    startAgain: 'Start again',
    seeWhatHappened: 'See what happened',
    portTaken: (port: number) => `Port ${port} was taken by another app.`,
    refusedSettings: 'Appium refused this profile’s settings.',
    closedOnItsOwn: 'Appium closed on its own.',
    /** With technical details on: above the message the server reported, quoted as it was. */
    reported: 'What the server reported'
  },
  firstRun: {
    title: 'Let’s get this Mac ready',
    sentence: 'A one-time setup, about 2 minutes.',
    setUp: 'Set up this Mac',
    checklist: {
      node: 'Node.js',
      appium: 'Appium',
      xenon: 'Xenon',
      android: 'Android support',
      iphone: 'iPhone support'
    },
    /** What this Mac needs to test, as a list: Set up installs some of it (Xenon, the drivers), not Node.js or Appium. */
    checklistLabel: 'What this Mac needs',
    /** A screen reader's word for a ✓. */
    installed: 'Installed',
    /** After an item that is not on this Mac yet. */
    notInstalled: '— not installed yet',
    /** After an item the check could not read (the driver list): not done, and no claim it is missing. */
    couldNotCheck: '— couldn’t check'
  },
  cantStart: {
    title: 'Can’t start yet',
    tryAgain: COMMON.tryAgain,
    footer: 'Something else? See Setup for every check.',
    /** With technical details on: above what the check found, and the fix it gives, as they are. */
    reported: 'What the check found'
  },
  checking: {
    title: 'Checking this Mac…'
  },
  ready: {
    title: 'Ready to start',
    start: SHELL.status.start,
    phones: {
      both: 'Android phones and iPhones',
      android: 'Android phones',
      ios: 'iPhones'
    },
    thisMacOnly: ' · this Mac only',
    sharedWith: (hub: string) => ` · shared with ${hub}`
  },
  stop: SHELL.status.stop,
  /** The running server's addresses, on Home and from Copy Test Address. */
  address: {
    test: 'Test address',
    /** Before the address colleagues on the same network use: "Colleagues on your network: http://…". */
    colleagues: 'Colleagues on your network:',
    copy: COMMON.copy,
    /** The Copy buttons' names, which start with what they show. */
    copyTest: 'Copy test address',
    copyColleagues: 'Copy colleagues’ address',
    copied: COMMON.copied,
    /** The clipboard refused an address (the test address or the colleagues'): copying again may work. */
    copyFailed: 'Couldn’t copy the address. Try again.',
    /** Copy Test Address with no address to give: no profile is open, or main gave none for its port. */
    noAddress: 'There’s no test address yet. Check the port in Settings.'
  },
  lastRun: {
    line: (day: string, time: string, how: string) => `Last run: ${day} ${time} · ${how}`,
    today: 'today',
    yesterday: 'yesterday',
    /** Older than yesterday: "3 Oct". The month names are fixed so the line reads the same in any locale. */
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    stopped: 'stopped normally',
    crashed: 'stopped unexpectedly'
  },
  /** The one button that fixes what stops a start, by what it is. */
  quickFix: {
    usePort: (port: number) => `Use port ${port}`,
    seeSetup: 'See Setup',
    setUp: 'Set up this Mac',
    fixIt: 'Fix it',
    howToInstall: 'How to install'
  }
} as const;
