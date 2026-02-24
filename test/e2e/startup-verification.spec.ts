import chai from 'chai';
chai.should();
import axios from 'axios';
import { HUB_APPIUM_PORT, PLUGIN_PATH, ensureAppiumHome, ensureHubConfig } from './e2ehelper';
import { pluginE2EHarness } from '@appium/plugin-test-support';
import ip from 'ip';

describe('Startup Verification E2E Test', () => {
  // dump hub config into a file
  const hub_config_file = ensureHubConfig('both');

  // setup appium home
  const APPIUM_HOME = ensureAppiumHome('startup-verify');

  // run hub
  pluginE2EHarness({
    before: global.before,
    after: global.after,
    serverArgs: {
      subcommand: 'server',
      configFile: hub_config_file,
    },
    pluginName: 'xenon',
    port: HUB_APPIUM_PORT,
    driverSource: 'npm',
    driverName: 'uiautomator2',
    driverSpec: 'appium-uiautomator2-driver',
    pluginSource: 'local',
    pluginSpec: PLUGIN_PATH,
    appiumHome: APPIUM_HOME as string,
  });

  const hub_url = `http://${ip.address()}:${HUB_APPIUM_PORT}`;

  it('Should start Appium server and load Xenon plugin without crashing', async () => {
    const response = await axios.get(`${hub_url}/xenon`);
    response.status.should.eql(200);
  });

  it('Should have operational REST API (Swagger verification)', async () => {
    // This confirms that the swagger YAML parsing succeeded
    const response = await axios.get(`${hub_url}/xenon/api/device`);
    response.status.should.eql(200);
    response.data.should.be.an('array');
  });
});
