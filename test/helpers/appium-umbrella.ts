import path from 'path';

/**
 * Appium's own umbrella driver (`AppiumDriver`) and base-driver, as installed
 * with the `appium` devDependency, for specs that run a real Appium 3
 * `server()` in-process. Xenon's own `@appium/base-driver` is an older copy;
 * these are the ones Appium runs.
 */

export function appiumDir(): string {
  return path.dirname(require.resolve('appium/package.json'));
}

export function appiumBaseDriver(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(require.resolve('@appium/base-driver', { paths: [appiumDir()] }));
}

/** Silence Appium's own logger (its HTTP log writes every request) until restore(). */
export function quietAppiumLogs(): { restore(): void } {
  appiumBaseDriver();
  const support = require.resolve('@appium/support', { paths: [appiumDir()] });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const log: { level: string } = require(
    require.resolve('@appium/logger', { paths: [support] }),
  ).default;
  const level = log.level;
  log.level = 'silent';
  return {
    restore: () => {
      log.level = level;
    },
  };
}

/** The automationName the fake inner driver answers to. */
export const FAKE_AUTOMATION = 'XenonTestFake';

let fakeInnerDriver: any;

/**
 * A driver the umbrella can start a session with: Appium's own BaseDriver,
 * which validates the capabilities and makes a session id, and nothing more.
 */
export function fakeInnerDriverClass(): any {
  if (!fakeInnerDriver) {
    const { BaseDriver } = appiumBaseDriver();
    fakeInnerDriver = class XenonTestFakeDriver extends BaseDriver {};
  }
  return fakeInnerDriver;
}

/**
 * Appium's umbrella driver with these plugin classes, which finds the fake
 * inner driver for `appium:automationName` FAKE_AUTOMATION and, like Appium,
 * no driver for anything else.
 */
export function umbrellaWith(plugins: Array<[any, string]>): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AppiumDriver } = require(path.join(appiumDir(), 'build/lib/appium.js'));
  const umbrella = new AppiumDriver({});
  umbrella.pluginClasses = new Map(plugins);
  umbrella.driverConfig = {
    findMatchingDriver: async (caps: { automationName?: string }) => {
      if (caps.automationName !== FAKE_AUTOMATION) {
        throw new Error(
          `Could not find a driver for automationName '${caps.automationName}' and platformName ` +
            'Android.',
        );
      }
      return { driver: fakeInnerDriverClass(), version: '0.0.1', driverName: 'fake' };
    },
  };
  return umbrella;
}
