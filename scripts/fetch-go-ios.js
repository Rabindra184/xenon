'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- a plain Node script, run without a build */

/**
 * The go-ios Xenon ships (see src/device-managers/ios/vendor/go-ios/README.md).
 *
 *   node scripts/fetch-go-ios.js                  `npm run build`, after tsc -b
 *   node scripts/fetch-go-ios.js --check-package  `prepublishOnly`, after the build
 *
 * With no argument it puts the pinned go-ios at
 * src/device-managers/ios/vendor/go-ios/ios, from its npm release, unless the
 * one there is it already; build:copy then ships it in lib/. With
 * --check-package it checks the copy in lib/, and what `npm pack` would
 * publish, before a release goes out. Either way a problem fails the step.
 *
 * The pin is read from the compiled src/scripts/goIosVersion.ts, so this runs
 * after tsc.
 */

const fs = require('fs');
const path = require('path');
const {
  pinFrom,
  fetchBundledGoIos,
  checkBundledGoIos,
  checkPackedGoIos,
  defaultRun,
} = require('./lib/go-ios-bundle');

const ROOT = path.resolve(__dirname, '..');
const PIN_MODULE = 'lib/src/scripts/goIosVersion.js';
const VENDOR_DIR = 'src/device-managers/ios/vendor/go-ios';
const SHIPPED_BINARY = 'lib/src/device-managers/ios/vendor/go-ios/ios';

function fail(problems) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}

function main() {
  const pinModule = path.join(ROOT, PIN_MODULE);
  if (!fs.existsSync(pinModule)) fail([`go-ios: ${PIN_MODULE} is missing. Run tsc -b first.`]);
  const pin = pinFrom(require(pinModule));

  if (process.argv.includes('--check-package')) {
    let problems;
    try {
      problems = [
        ...checkBundledGoIos({ pin, binaryPath: path.join(ROOT, SHIPPED_BINARY) }),
        ...checkPackedGoIos({ rootDir: ROOT, entryPath: SHIPPED_BINARY, run: defaultRun }),
      ];
    } catch (err) {
      problems = [err && err.message ? err.message : String(err)];
    }
    if (problems.length) fail(problems);
    console.log(`go-ios ${pin.version}: ready to publish`);
    return;
  }

  let outcome;
  try {
    outcome = fetchBundledGoIos({
      pin,
      vendorDir: path.join(ROOT, VENDOR_DIR),
      rootDir: ROOT,
      run: defaultRun,
    });
  } catch (err) {
    fail([err && err.message ? err.message : String(err)]);
  }
  console.log(
    outcome === 'kept'
      ? `go-ios ${pin.version}: kept the checked binary`
      : `go-ios ${pin.version}: fetched ${pin.packageSpec} and checked it`,
  );
}

main();
