// Setup's words, to start with the plain sentences for a Node.js or Appium
// that is missing or no good. Home's "Can’t start yet" says them, and the Setup
// screen's rows say the same ones, so the two never differ. Commands and
// versions-as-instructions are not here: they belong to the technical details.

export const SETUP = {
  node: {
    /** The Node.js check, status missing. */
    missing: 'Node.js isn’t installed on this Mac. Appium needs it.',
    /** The Node.js check, status warn: it is there but the wrong version. */
    wrongVersion: 'This Mac’s Node.js version doesn’t work with Appium 3.'
  },
  appium: {
    /** The Appium check, status missing. */
    missing: 'Appium isn’t installed on this Mac. Xenon needs Appium 3.1.1 or newer.',
    /** The Appium check, status warn: it is there but too old. */
    tooOld: 'This Mac’s Appium is too old. Xenon needs Appium 3.1.1 or newer.'
  }
} as const;
