import 'reflect-metadata';
import { cleanPendingSessions, getDeviceFiltersFromCapability } from '../../src/device-utils';
import { expect } from 'chai';
import { serverCliArgs } from '../integration/cliArgs';
import { XenonDatabase } from '../../src/data-service/db';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { useLokiStores } from '../helpers/loki-stores';

const pluginArgs = DefaultPluginArgs;

describe('Device filter tests', () => {
  // The in-memory stores, also when this file runs on its own: without
  // NODE_ENV=test the factory handed out the Prisma stores, which are the
  // developer's ~/.cache/xenon/xenon.db.
  useLokiStores();

  it('Get Device filters for real device', async () => {
    // Imported here, not at the top: the module keeps the store it gets when
    // it loads, and only here is that the in-memory one on a file run alone.
    const { addCLIArgs } = await import('../../src/data-service/pluginArgs');
    await addCLIArgs(serverCliArgs);
    (await XenonDatabase.CLIArgs)
      .chain()
      .find()
      .update(function (d) {
        d.plugin['xenon'].iosDeviceType = 'real';
      });
    const capabilities = {
      alwaysMatch: {
        platformName: 'iOS',
        'appium:app': '/Downloads/VodQA.ipa',
        'appium:iPhoneOnly': true,
        'appium:platformVersion': '14.0',
        'appium:udid': '21112-1111-1111-111',
      },
      firstMatch: [{}],
    };
    const firstMatch = Object.assign({}, capabilities.firstMatch[0], capabilities.alwaysMatch);
    const filter = getDeviceFiltersFromCapability(firstMatch, pluginArgs);
    expect(filter).to.deep.equal({
      platform: 'ios',
      platformVersion: '14.0',
      appleFamily: 'iphone',
      deviceType: 'real',
      udid: ['21112-1111-1111-111'],
      minSDK: undefined,
      maxSDK: undefined,
      filterByHost: undefined,
      busy: false,
      userBlocked: false,
      tags: undefined,
    });
  });

  it('Get Device from filter properties for simulator', async () => {
    (await XenonDatabase.CLIArgs)
      .chain()
      .find()
      .update(function (d) {
        d.plugin['xenon'].iosDeviceType = 'simulated';
      });
    const capabilities = {
      alwaysMatch: {
        platformName: 'iOS',
        'appium:app': '/Downloads/VodQA.app',
        'appium:iPhoneOnly': true,
        'appium:platformVersion': '14.0',
      },
      firstMatch: [{}],
    };
    const firstMatch = Object.assign({}, capabilities.firstMatch[0], capabilities.alwaysMatch);
    const filter = getDeviceFiltersFromCapability(firstMatch, pluginArgs);
    expect(filter).to.deep.equal({
      platform: 'ios',
      platformVersion: '14.0',
      appleFamily: 'iphone',
      filterByHost: undefined,
      deviceType: 'simulator',
      udid: [],
      minSDK: undefined,
      maxSDK: undefined,
      busy: false,
      userBlocked: false,
      tags: undefined,
    });
  });

  it('Get Device filter properties with minSDK', () => {
    const capabilities = {
      alwaysMatch: {
        platformName: 'iOS',
        'appium:app': '/Downloads/VodQA.app',
        'appium:iPhoneOnly': true,
        'appium:minSDK': '10.2.0',
      },
      firstMatch: [{}],
    };
    const firstMatch = Object.assign({}, capabilities.firstMatch[0], capabilities.alwaysMatch);
    const filter = getDeviceFiltersFromCapability(firstMatch, pluginArgs);
    expect(filter).to.deep.equal({
      platform: 'ios',
      filterByHost: undefined,
      platformVersion: undefined,
      appleFamily: 'iphone',
      deviceType: 'simulator',
      udid: [],
      minSDK: '10.2.0',
      maxSDK: undefined,
      busy: false,
      userBlocked: false,
      tags: undefined,
    });
  });
});

describe('Pending sessions', () => {
  useLokiStores();

  beforeEach(async () => {
    (await XenonDatabase.PendingSessionsModel).removeDataOnly();
  });

  it('clean pending sessions', async () => {
    // insert pending sessions
    (await XenonDatabase.PendingSessionsModel).insert({
      capability_id: '1',
      createdAt: new Date().getTime(),
    });
    (await XenonDatabase.PendingSessionsModel).insert({
      capability_id: '2',
      createdAt: new Date().getTime() - 10000,
    });

    // clean pending sessions
    await cleanPendingSessions(5000);

    // check pending sessions
    const pendingSessions = (await XenonDatabase.PendingSessionsModel).chain().data();
    expect(pendingSessions.length).to.equal(1);
  });
});
