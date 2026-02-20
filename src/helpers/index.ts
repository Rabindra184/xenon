/* eslint-disable no-prototype-builtins */
import os from 'os';
import path from 'path';
import tcpPortUsed from 'tcp-port-used';
import getPort from 'get-port';
import { IDevice } from '../interfaces/IDevice';
import _ from 'lodash';
import log from '../logger';
import Cloud from '../enums/Cloud';
import normalizeUrl from 'normalize-url';
import ora from 'ora';
import asyncWait from 'async-wait-until';
import { InternalHttpClient } from '../InternalHttpClient';

import { redactSecrets } from '../logger';

const APPIUM_VENDOR_PREFIX = 'appium:';

/**
 * Deep-clone an object, replacing values of sensitive keys with ***REDACTED***.
 * Safe to call before JSON.stringify for logging.
 * Re-exported from logger to maintain helper compatibility
 */
export { redactSecrets };

const XENON_PREFIXES = ['xe:'];

export async function asyncForEach(
  array: string | any[],
  callback: {
    (device: any): Promise<void>;
    (udid: any): Promise<void>;
    (arg0: any, arg1: number, arg2: any): any;
  },
) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export async function spinWith(
  msg: string,
  fn: () => Promise<boolean>,
  callback = (_msg: string) => {},
) {
  const spinner = ora(msg).start();
  await asyncWait(
    async () => {
      try {
        const res = await fn();
        spinner.succeed();
        return res;
      } catch (err) {
        spinner.fail();
        if (callback) callback(msg);
        return false;
      }
    },
    {
      intervalBetweenAttempts: 2000,
      timeout: 60 * 1000,
    },
  );
}

export function isMac() {
  return os.type() === 'Darwin';
}

export function cachePath(folder: string) {
  return path.join(os.homedir(), '.cache', 'xenon', folder);
}
export function isWindows() {
  return os.type() === 'win32';
}

export function checkIfPathIsAbsolute(configPath: string) {
  return path.isAbsolute(configPath);
}

export async function getFreePort() {
  return await getPort();
}

export function nodeUrl(device: IDevice, basePath = ''): string {
  const host = normalizeUrl(device.host, { removeTrailingSlash: false });
  if (device.cloud) {
    if (device.cloud.toLowerCase() === Cloud.PCLOUDY) {
      return `${host}/wd/hub`;
    } else if (device.cloud.toLowerCase() === Cloud.HEADSPIN) {
      return `${host}`;
    } else {
      return `https://${process.env.CLOUD_USERNAME}:${process.env.CLOUD_KEY}@${
        new URL(device.host).host
      }/wd/hub`;
    }
  }
  // hardcoded the `/wd/hub` for now. This can be fetch from serverArgs.basePath
  return `${host}${basePath || ''}`;
}

export async function isPortBusy(port: number) {
  try {
    if (!port) {
      return false;
    }
    return await tcpPortUsed.check(port);
  } catch (err) {
    return false;
  }
}

export function hasHubArgument(cliArgs: any) {
  return _.has(cliArgs, 'plugin["xenon"].hub');
}

export function hasCloudArgument(cliArgs: any) {
  return _.has(cliArgs, 'plugin["xenon"].cloud');
}
// Standard, non-prefixed capabilities (see https://www.w3.org/TR/webdriver/#dfn-table-of-standard-capabilities)
const STANDARD_CAPS = [
  'browserName',
  'browserVersion',
  'platformName',
  'acceptInsecureCerts',
  'pageLoadStrategy',
  'proxy',
  'setWindowRect',
  'timeouts',
  'unhandledPromptBehavior',
];

function isStandardCap(cap: any) {
  return !!_.find(
    STANDARD_CAPS,
    (standardCap) => standardCap.toLowerCase() === `${cap}`.toLowerCase(),
  );
}

// If the 'appium:' or Xenon prefixes were provided, strip them out (W3C Extension Capabilities)
// (NOTE: Method is destructive and mutates contents of caps)
export function stripAppiumPrefixes(caps: any) {
  const allPrefixes = [APPIUM_VENDOR_PREFIX, ...XENON_PREFIXES];
  const keys = _.keys(caps);

  const prefixedCaps = keys.filter((cap) => allPrefixes.some((prefix) => cap.startsWith(prefix)));
  const nonPrefixedCaps = _.difference(keys, prefixedCaps);

  // initialize this with the k/v pairs of the non-prefixed caps
  const strippedCaps = /** @type {import('@appium/types').Capabilities<C>} */ _.pick(
    caps,
    nonPrefixedCaps,
  );
  const badPrefixedCaps: string[] = [];

  // Strip prefixes
  for (const prefixedCap of prefixedCaps) {
    const activePrefix = allPrefixes.find((p) => prefixedCap.startsWith(p))!;
    const strippedCapName = prefixedCap.substring(activePrefix.length) as string;

    // If it's standard capability that was prefixed, add it to an array of incorrectly prefixed capabilities
    if (activePrefix === APPIUM_VENDOR_PREFIX && isStandardCap(strippedCapName)) {
      badPrefixedCaps.push(strippedCapName);
      if (_.isNil(strippedCaps[strippedCapName])) {
        strippedCaps[strippedCapName] = caps[prefixedCap];
      } else {
        log.warn(
          `Ignoring capability '${prefixedCap}=${caps[prefixedCap]}' and ` +
            `using capability '${strippedCapName}=${strippedCaps[strippedCapName]}'`,
        );
      }
    } else {
      strippedCaps[strippedCapName] = caps[prefixedCap];
    }
  }

  // If we found standard caps that were incorrectly prefixed, throw an exception (e.g.: don't accept 'appium:platformName', only accept just 'platformName')
  if (badPrefixedCaps.length > 0) {
    log.warn(
      `The capabilities ${JSON.stringify(
        badPrefixedCaps,
      )} are standard capabilities and do not require "appium:" prefix`,
    );
  }
  return strippedCaps;
}

export async function isXenonRunning(
  host: string,
  tlsRejectUnauthorized?: boolean,
): Promise<boolean> {
  try {
    const client = InternalHttpClient.getClient(tlsRejectUnauthorized);
    await client.get(`${host}/xenon/api/status`);
    return true;
  } catch (error: any) {
    log.info(`Xenon is not running at ${host}. Error: ${error}`);
    return false;
  }
}

export async function isAppiumRunningAt(
  url: string,
  tlsRejectUnauthorized?: boolean,
): Promise<boolean> {
  try {
    const client = InternalHttpClient.getClient(tlsRejectUnauthorized);
    await client.get(`${url}/status`);
    return true;
  } catch (error: any) {
    log.info(`Appium is not running at ${url}. Error: ${error}`);
    return false;
  }
}

export function safeParseJson(jsonString: string) {
  try {
    return JSON.parse(jsonString);
  } catch (err) {
    return jsonString;
  }
}

export async function takeScreenshot(driver: any): Promise<string | null> {
  try {
    // Use driver's native getScreenshot method
    const screenshot = await driver.getScreenshot();

    if (screenshot && typeof screenshot === 'string') {
      return screenshot;
    }

    log.warn('Screenshot did not return expected base64 string');
    return null;
  } catch (error: any) {
    log.error(`Failed to take screenshot: ${error.message}`);
    return null;
  }
}
