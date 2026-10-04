import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import _ from 'lodash';

// An Appium config file is checked against Xenon's schema.json before Appium
// fills in defaults (appium/build/lib/main.js: readConfigFile, then
// defaultsDeep(cli, file, schema defaults)). A `required` option therefore
// makes Appium refuse any file that leaves it out, even though it has a
// default. Through 2.13.1 the README's own five-option sample was refused with
// "REQUIRED must have required property 'enableJsonLogging'". These checks run
// Appium's own loader so a file that sets a few options keeps starting.

/* eslint-disable @typescript-eslint/no-var-requires -- Appium's internals have no type exports */
const appiumSchema = require('appium/build/lib/schema/schema');
const { readConfigFile } = require('appium/build/lib/config-file');
/* eslint-enable @typescript-eslint/no-var-requires */

const xenonSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schema.json'), 'utf8'),
);

// The README's sample, verbatim.
const README_SAMPLE = `server:
  use-plugins: [xenon]
  plugin:
    xenon:
      platform: both
      enableDashboard: true
      maxSessions: 8
      enableSelfHealing: true
      buildCleanupDays: 30
`;

describe('An Appium config file for Xenon', function () {
  let dir: string;

  async function load(yaml: string) {
    const file = path.join(dir, `config-${Math.random().toString(36).slice(2)}.yaml`);
    fs.writeFileSync(file, yaml);
    return readConfigFile(file);
  }

  before(function () {
    appiumSchema.resetSchema();
    appiumSchema.registerSchema('plugin', 'xenon', xenonSchema);
    appiumSchema.finalizeSchema();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-config-'));
  });

  after(function () {
    appiumSchema.resetSchema();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is accepted when it sets only a few options (the README sample)', async function () {
    const result = await load(README_SAMPLE);
    expect(result.reason ?? result.errors).to.be.empty;
  });

  it('is accepted when it sets no Xenon option at all', async function () {
    const result = await load('server:\n  use-plugins: [xenon]\n');
    expect(result.reason ?? result.errors).to.be.empty;
  });

  it('is accepted with the network capture option Xenon Control writes', async function () {
    // The server's `interceptor` option is now each session's default
    // (resolveInterceptorOptions); configs that set it must keep starting.
    const result = await load(
      `${README_SAMPLE}      interceptor:\n        enabled: true\n        bufferSize: 50\n        captureBodies: false\n`,
    );
    expect(result.reason ?? result.errors).to.be.empty;
    expect(result.config.server.plugin.xenon.interceptor).to.deep.equal({
      enabled: true,
      bufferSize: 50,
      captureBodies: false,
    });
  });

  it('is still refused when a value is invalid', async function () {
    const result = await load(README_SAMPLE.replace('platform: both', 'platform: windows'));
    expect(result.errors).to.not.be.empty;
  });

  it('leaves Appium to fill every option the file leaves out with its default', async function () {
    // What Appium's main does after a file passes: CLI args, then the file,
    // then the schema's defaults.
    const result = await load(README_SAMPLE);
    const defaults = appiumSchema.getDefaultsForSchema(false);
    const server = _.defaultsDeep({}, result.config?.server, defaults);
    const xenon = server.plugin.xenon;

    const setInFile = new Set(Object.keys(result.config.server.plugin.xenon));
    expect(xenon.maxSessions).to.equal(8); // from the file
    for (const [key, prop] of Object.entries<any>(xenonSchema.properties)) {
      if ('default' in prop && !setInFile.has(key)) {
        expect(xenon[key], `${key} should take its default`).to.deep.equal(prop.default);
      }
    }
  });
});
