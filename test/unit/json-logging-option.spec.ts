import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import { XenonPlugin } from '../../src/plugin';
import { XenonLogger } from '../../src/logger';

/* eslint-disable @typescript-eslint/no-var-requires -- Appium's internals have no type exports */
const appiumSchema = require('appium/build/lib/schema/schema');
/* eslint-enable @typescript-eslint/no-var-requires */

const xenonSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schema.json'), 'utf8'),
);

/**
 * XENON_JSON_LOGGING turns JSON log lines on. The plugin overwrote it with its
 * own default, `enableJsonLogging: false`, so the variable never worked. The
 * rule now: the option when it is set (either way), else the variable, else
 * off. For that the option has to be absent when nobody set it, so schema.json
 * gives it no default for Appium to fill in.
 */
describe('JSON logging', () => {
  let savedFlag: boolean;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedFlag = XenonLogger.isJsonLogging;
    savedEnv = process.env.XENON_JSON_LOGGING;
  });

  afterEach(() => {
    XenonLogger.isJsonLogging = savedFlag;
    if (savedEnv === undefined) delete process.env.XENON_JSON_LOGGING;
    else process.env.XENON_JSON_LOGGING = savedEnv;
  });

  /** The logger as it stands once the plugin is built the way Appium builds it. */
  function loggingAfterBuilding(cliArgs: Record<string, unknown>, env?: string): boolean {
    // The environment is read when the logger loads; this is that read.
    XenonLogger.isJsonLogging = env === 'true';
    new XenonPlugin('xenon', cliArgs);
    return XenonLogger.isJsonLogging;
  }

  it('is on when only the environment variable asks for it', () => {
    expect(loggingAfterBuilding({}, 'true')).to.equal(true);
  });

  it('is off when nothing asks for it', () => {
    expect(loggingAfterBuilding({})).to.equal(false);
  });

  it('is on when only the option asks for it', () => {
    expect(loggingAfterBuilding({ enableJsonLogging: true })).to.equal(true);
  });

  it('lets an option set to false win over the environment variable', () => {
    expect(loggingAfterBuilding({ enableJsonLogging: false }, 'true')).to.equal(false);
  });

  it('lets an option set to true win over a variable that is not "true"', () => {
    expect(loggingAfterBuilding({ enableJsonLogging: true }, 'false')).to.equal(true);
  });

  describe("Appium's defaults for an option nobody set", () => {
    before(() => {
      appiumSchema.resetSchema();
      appiumSchema.registerSchema('plugin', 'xenon', xenonSchema);
      appiumSchema.finalizeSchema();
    });

    after(() => appiumSchema.resetSchema());

    it('leave enableJsonLogging absent, so the variable can be told from a choice', () => {
      // What Appium's main does: CLI args, then the file, then schema defaults.
      const defaults = appiumSchema.getDefaultsForSchema(false);
      const server = _.defaultsDeep({}, { plugin: { xenon: { maxSessions: 8 } } }, defaults);
      expect(server.plugin.xenon).to.not.have.property('enableJsonLogging');
    });
  });
});
