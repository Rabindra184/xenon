/**
 * Dev-only seed data. Populates realistic, deliberately hostile content so the
 * layouts have something to clip on — empty tables cannot clip, so a guard run
 * against an unseeded database passes vacuously.
 *
 * Never runs on boot. Requires an explicit DATABASE_URL so it can never be
 * pointed at a real ~/.cache/xenon/xenon.db by accident.
 */
import { PrismaClient } from '../generated/client';

export interface SeedDevice {
  udid: string;
  /** Required: Device's primary key is @@id([udid, host]). */
  host: string;
  name: string;
  platform: string;
  /** Device has no `osVersion` column — the OS version lives in `sdk`. */
  sdk: string;
  deviceType: string;
}

const HOST = '127.0.0.1';

export function buildSeedDevices(): SeedDevice[] {
  return [
    { udid: 'SEED-DEVICE-01', host: HOST, name: 'Pixel 8 Pro — Bangalore Lab Rack 4 Slot 12', platform: 'android', sdk: '14', deviceType: 'real' },
    { udid: 'SEED-DEVICE-02', host: HOST, name: 'Samsung Galaxy S24 Ultra — Munich Lab Rack 2', platform: 'android', sdk: '14', deviceType: 'real' },
    { udid: '00008110-00084CE80E51401E', host: HOST, name: 'iPhone 15 Pro Max — Regression Pool Primary', platform: 'ios', sdk: '26.5.2', deviceType: 'real' },
    // Legacy 40-char UDID format (pre-iOS 7 style) — still shows up on older lab
    // hardware and is the real width stressor for UDID columns; the modern
    // 25-char "8-4-16" format above does not exercise the same overflow case.
    { udid: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', host: HOST, name: 'iPad Pro 12.9 — Tablet Matrix Coverage Device', platform: 'ios', sdk: '17.4', deviceType: 'real' },
    { udid: 'SEED-DEVICE-05', host: HOST, name: 'OnePlus 12 — Performance Benchmarking Handset', platform: 'android', sdk: '14', deviceType: 'real' },
    { udid: 'SEED-DEVICE-06', host: HOST, name: 'Xiaomi 14 Ultra — Localisation Test Device APAC', platform: 'android', sdk: '14', deviceType: 'real' },
  ];
}

export async function seed(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'seed-dev-data: refusing to run without an explicit DATABASE_URL. ' +
        'This script writes test rows and must never touch a real database by default. ' +
        'Example: DATABASE_URL="file:/tmp/xenon-seed.db" npm run db:seed',
    );
  }
  const prisma = new PrismaClient();
  try {
    for (const d of buildSeedDevices()) {
      await prisma.device.upsert({
        // Composite key: @@id([udid, host]) -> the compound selector is udid_host.
        where: { udid_host: { udid: d.udid, host: d.host } },
        update: { name: d.name, platform: d.platform, sdk: d.sdk },
        create: {
          udid: d.udid,
          host: d.host,
          name: d.name,
          platform: d.platform,
          sdk: d.sdk,
          deviceType: d.deviceType,
          state: 'available',
          busy: false,
          offline: false,
        },
      });
    }
    console.log(`[seed] devices: ${buildSeedDevices().length}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  seed().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
