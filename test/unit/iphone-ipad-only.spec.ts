import 'reflect-metadata';
import { expect } from 'chai';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { getDeviceFiltersFromCapability } from '../../src/device-utils';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * `appium:iPhoneOnly` / `appium:iPadOnly` become a device filter in
 * getDeviceFiltersFromCapability, but the Prisma store, the one a running
 * server uses, never applied it: a session asking for an iPad could be given
 * an iPhone. These run the real store against a real (scratch) database, from
 * the capability to the rows that come back.
 *
 * A real iPhone's name is whatever its owner typed ("QA-Phone-3"), so the
 * family is read from what the phone reports (its model, then its form
 * factor), and only from its name for a row written before those existed.
 */

const HOST = 'http://127.0.0.1:4723';

const row = (udid: string, over: Record<string, unknown>) => ({
  udid,
  host: HOST,
  platform: 'ios',
  deviceType: 'real',
  realDevice: true,
  busy: false,
  userBlocked: false,
  ...over,
});

const DEVICES = [
  // Simulators: the name is the marketing name, and the form factor comes from it.
  row('sim-iphone', {
    name: 'iPhone 16 Pro',
    deviceType: 'simulator',
    realDevice: false,
    formFactor: 'phone',
    marketingName: 'iPhone 16 Pro',
  }),
  row('sim-ipad', {
    name: 'iPad Pro 13-inch (M4)',
    deviceType: 'simulator',
    realDevice: false,
    formFactor: 'tablet',
    marketingName: 'iPad Pro 13-inch (M4)',
  }),
  row('sim-tv', {
    name: 'Apple TV 4K',
    deviceType: 'simulator',
    realDevice: false,
    formFactor: 'tv',
    marketingName: 'Apple TV 4K',
  }),
  // Real phones, named by their owners.
  row('real-iphone', {
    name: 'QA-Phone-3',
    model: 'iPhone17,3',
    formFactor: 'phone',
    marketingName: 'iPhone 16',
  }),
  row('real-ipad-named-iphone', {
    name: 'iPhone spare',
    model: 'iPad13,4',
    formFactor: 'tablet',
    marketingName: 'iPad Pro 11-inch (3rd generation)',
  }),
  // Rows written before the identity columns: only the name is known.
  row('old-iphone', { name: 'iPhone 13' }),
  row('old-ipad', { name: 'iPad (9th generation)' }),
  row('old-unnamed', { name: 'unknown' }),
  // Android: never an iPhone or an iPad, whatever its form factor.
  row('pixel', {
    name: 'Pixel 7',
    platform: 'android',
    formFactor: 'phone',
    model: 'Pixel 7',
  }),
  row('pixel-tablet', {
    name: 'Pixel Tablet',
    platform: 'android',
    formFactor: 'tablet',
    model: 'Pixel Tablet',
  }),
];

describe('appium:iPhoneOnly and appium:iPadOnly', () => {
  const scratch = useScratchDatabase();

  beforeEach(async () => {
    await scratch.db.device.deleteMany({});
    for (const d of DEVICES) await scratch.db.device.create({ data: d as any });
  });

  /** The udids a session with these capabilities may be given. */
  async function allocatable(caps: Record<string, unknown>): Promise<string[]> {
    const filter = getDeviceFiltersFromCapability(caps, DefaultPluginArgs);
    const found = await new PrismaDeviceStore().getDevices(filter);
    return found.map((d) => d.udid).sort();
  }

  it('iPhoneOnly gets iPhones: by model, by form factor, and by name for an old row', async () => {
    expect(await allocatable({ platformName: 'iOS', 'appium:iPhoneOnly': true })).to.deep.equal([
      'old-iphone',
      'real-iphone',
      'sim-iphone',
    ]);
  });

  it('iPadOnly gets iPads, including one named for an iPhone', async () => {
    expect(await allocatable({ platformName: 'iOS', 'appium:iPadOnly': true })).to.deep.equal([
      'old-ipad',
      'real-ipad-named-iphone',
      'sim-ipad',
    ]);
  });

  it('gives an iPad when both are asked for, as before', async () => {
    expect(
      await allocatable({
        platformName: 'iOS',
        'appium:iPhoneOnly': true,
        'appium:iPadOnly': true,
      }),
    ).to.deep.equal(['old-ipad', 'real-ipad-named-iphone', 'sim-ipad']);
  });

  it('never gives an Android phone, even when the platform is not named', async () => {
    const ids = await allocatable({ 'appium:iPadOnly': true });
    expect(ids).to.not.include.members(['pixel-tablet']);
    const phones = await allocatable({ 'appium:iPhoneOnly': true });
    expect(phones).to.not.include.members(['pixel']);
  });

  it('filters nothing without either capability', async () => {
    const all = await allocatable({ platformName: 'iOS' });
    expect(all).to.include.members(['sim-iphone', 'sim-ipad', 'real-iphone', 'old-unnamed']);
    expect(all).to.not.include.members(['pixel', 'pixel-tablet']);
  });
});
