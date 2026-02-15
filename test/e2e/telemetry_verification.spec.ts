import NodeDevices from '../../src/device-managers/NodeDevices';
import chai from 'chai';
chai.should();
import { expect } from 'chai';
import axios from 'axios';
import { HUB_APPIUM_PORT, PLUGIN_PATH, ensureAppiumHome, ensureHubConfig } from './e2ehelper';
import { pluginE2EHarness } from '@appium/plugin-test-support';
import ip from 'ip';
import { remote } from 'webdriverio';
import { prisma } from '../../src/prisma';

describe('Performance Telemetry Verification', () => {
  const APPIUM_HOME = ensureAppiumHome('telemetry-verify', true);
  const hub_config_file = ensureHubConfig('android', 'both', 'both', {
    enableDashboard: true,
  });

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
    driverName: 'fake',
    driverSpec: 'appium-fake-driver',
    pluginSource: 'local',
    pluginSpec: PLUGIN_PATH,
    appiumHome: APPIUM_HOME as string,
  });

  const hub_url = `http://${ip.address()}:${HUB_APPIUM_PORT}`;

  it('Should capture duration and OTel metadata for commands', async () => {
    const driver = await remote({
      protocol: 'http',
      hostname: ip.address(),
      port: HUB_APPIUM_PORT,
      path: '/wd/hub',
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'fake',
        'appium:deviceName': 'FakeDevice',
        'xe:enable_dashboard': true,
      } as any,
    } as any);

    try {
      await driver.getTitle();
      await driver.$('//button').click();

      // Give some time for background persistence
      await new Promise((r) => setTimeout(r, 1000));

      const sessionLogs = await prisma.sessionLog.findMany({
        where: { session_id: driver.sessionId },
        orderBy: { createdAt: 'desc' },
      });

      console.log(`Found ${sessionLogs.length} logs for session ${driver.sessionId}`);

      sessionLogs.forEach((log: any) => {
        console.log(
          `Command: ${log.command_name}, Duration: ${log.duration}ms, SpanID: ${log.span_id}`,
        );

        // Assertions
        expect(log.span_id).to.not.be.null;
        expect(log.trace_id).to.not.be.null;
        if (log.command_name !== 'createSession' && log.command_name !== 'deleteSession') {
          expect(log.duration).to.be.a('number').and.at.least(0);
        }
      });

      expect(sessionLogs.length).to.be.at.least(2);
    } finally {
      await driver.deleteSession();
    }
  });
});
