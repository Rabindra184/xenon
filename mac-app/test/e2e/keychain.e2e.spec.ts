import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDefaultProfile } from '../../src/shared/profileDefaults';
import type { Profile } from '../../src/shared/types';
import { clickMenuItem, launchApp, openPlace, pickFreePort, profileSwitcher, seedProfiles, setTechnical } from './helpers';

// The cloud key and the proxy password in the window (Task 14, fix round 1): the
// draft lets go of a value main moved to the Keychain (R40), the cloud key is
// never typed into a box (R39), and the preview shows the launch that will run
// (I4). The app runs on its own throwaway folder, and its Keychain is a stand-in
// (safeStorage replaced in the main process before any secret is stored), so
// nothing here reaches the Mac's real Keychain. The values are fake. No server
// is started.

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

const STAND_IN = 'stand-in:';

/** What the stand-in Keychain holds, read from the secrets file. */
function keychain(): Record<string, string> {
  const file = path.join(userDataDir, 'secrets.json');
  if (!existsSync(file)) return {};
  const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  return Object.fromEntries(
    Object.entries(stored).map(([key, cipher]) => [key, Buffer.from(cipher, 'base64').toString('utf8').slice(STAND_IN.length)])
  );
}

/** The profiles file as written. */
const profilesFile = () => readFileSync(path.join(userDataDir, 'profiles.json'), 'utf8');

/** The open profile as stored. */
const stored = () => page.evaluate(async () => (await window.xenon.profiles.list())[0]);

async function openSettingsTab(name: 'All settings' | 'Keys & accounts') {
  await openPlace('Settings', page);
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The proxy setting's JSON box. */
const proxyBox = (): Locator => page.locator('[data-setting-key="proxy"] textarea');

/** Types the proxy settings and leaves the box, which commits them. */
async function setProxy(value: unknown) {
  await openSettingsTab('All settings');
  await proxyBox().fill(JSON.stringify(value));
  await proxyBox().blur();
}

/**
 * An edit to another setting, as a person makes one later: the save sends the
 * whole draft, proxy and all. Waits until it is stored.
 */
async function editMaxSessions(n: number) {
  await openSettingsTab('All settings');
  await page.locator('#setting-maxSessions').fill(String(n));
  await expect.poll(async () => (await stored()).settings.maxSessions).toBe(n);
}

/** The proxy password's row in Keys & accounts. */
const proxyPasswordRow = (): Locator =>
  page.getByTestId('secrets-list').locator('div.rounded-lg', { has: page.getByText('PROXY_PASSWORD', { exact: true }) });

test.beforeAll(async () => {
  const port = await pickFreePort();
  userDataDir = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-keychain-'));
  const base = makeDefaultProfile({ id: randomUUID(), now: Date.now(), name: 'Keychain probe' });
  const profile: Profile = {
    ...base,
    settings: { ...base.settings, platform: 'android', androidDeviceType: 'simulated' },
    server: { ...base.server, port }
  };
  seedProfiles(userDataDir, [profile]);
  ({ app, page } = await launchApp({ userDataDir }));
  // A stand-in for the Keychain: reversible, and never the Mac's own.
  await app.evaluate(({ safeStorage }, prefix) => {
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = (text: string) => Buffer.from(prefix + text, 'utf8');
    safeStorage.decryptString = (cipher: Buffer) => cipher.toString('utf8').slice(prefix.length);
  }, STAND_IN);
});

test.afterAll(async () => {
  await app?.close();
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test('a proxy password typed in the proxy settings moves to the Keychain, and the window lets go of it (R40)', async () => {
  await setProxy({ host: 'squid.lab', port: 3128, auth: { username: 'qa', password: 'p-test-old' } });
  await expect.poll(async () => (await stored()).secretRefs).toContain('PROXY_PASSWORD');
  expect(keychain().PROXY_PASSWORD).toBe('p-test-old');
  expect(profilesFile()).not.toContain('p-test-old');
  // The window took the profile as stored: the box shows the proxy without the password.
  await expect(proxyBox()).not.toHaveValue(/p-test-old/);
  await expect(proxyBox()).toHaveValue(/squid\.lab/);
  // Keys & accounts shows the password as used by this profile.
  await openSettingsTab('Keys & accounts');
  await expect(proxyPasswordRow().getByRole('checkbox')).toBeChecked();
});

test('a cleared proxy password stays cleared after the next edit', async () => {
  await openSettingsTab('Keys & accounts');
  await proxyPasswordRow().getByTitle('Clear secret').click();
  await expect(proxyPasswordRow().getByText('not set')).toBeVisible();
  expect(keychain().PROXY_PASSWORD).toBeUndefined();
  // Another edit, which a draft still holding the old password would store again.
  await editMaxSessions(3);
  expect(keychain().PROXY_PASSWORD).toBeUndefined();
  expect(profilesFile()).not.toContain('p-test-old');
});

test('a password replaced in Keys & accounts is not put back by the next edit', async () => {
  await openSettingsTab('Keys & accounts');
  await proxyPasswordRow().locator('input[type="password"]').fill('p-test-new');
  await proxyPasswordRow().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(proxyPasswordRow().getByText('stored')).toBeVisible();
  // Another edit, which a draft still holding the old password would store over the new one.
  await editMaxSessions(4);
  expect(keychain().PROXY_PASSWORD).toBe('p-test-new');
  expect(profilesFile()).not.toMatch(/p-test-old|p-test-new/);
  await openSettingsTab('Keys & accounts');
  await expect(proxyPasswordRow().getByRole('checkbox')).toBeChecked();
});

test('the preview shows the launch that will run: the proxy in the environment, by name only (I4)', async () => {
  const spec = await page.evaluate(async () => window.xenon.server.launchPreview((await window.xenon.profiles.list())[0]));
  expect(spec.envKeys).toEqual(expect.arrayContaining(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']));
  expect(spec.configYaml).not.toContain('squid.lab');
  expect(JSON.stringify(spec)).not.toMatch(/p-test-new|p-test-old/);
});

test('the cloud key has no box in the settings: it points to Keys & accounts (R39)', async () => {
  await openSettingsTab('All settings');
  const apiKey = page.locator('[data-setting-key="cloud.apiKey"]');
  await expect(apiKey).toContainText('Cloud access key is a secret — set it in Keys & accounts');
  await expect(apiKey.locator('input, textarea')).toHaveCount(0);
  // The rest of the cloud settings stay editable.
  await expect(page.locator('[data-setting-key="cloud.cloudName"] input')).toHaveCount(1);
});

test('typing on into the next table cell while a save is answered keeps every letter (R40 with R17)', async () => {
  // Tab commits a row and its save goes out 300 ms later; the answer comes back while the next cell is
  // being typed in. Taking the answer used to put the table's rows back and drop what the cell held.
  await openSettingsTab('All settings');
  const table = page.locator('[data-setting-key="simulators"]');
  await table.getByRole('button', { name: 'Add row', exact: true }).click();
  const name = table.getByLabel('name row 1', { exact: true });
  const sdk = table.getByLabel('sdk row 1', { exact: true });
  await name.fill('iPhone 15');
  await name.press('Tab');
  await expect(sdk).toBeFocused();
  await page.keyboard.type('17.0.');
  // The row's save has been answered (a list read after it is answered after it).
  await expect.poll(async () => (await stored()).settings.simulators).toEqual([{ name: 'iPhone 15', sdk: '' }]);
  await page.waitForTimeout(100); // the answer has been rendered
  await page.keyboard.type('1-beta');
  await expect(sdk).toHaveValue('17.0.1-beta');
  await sdk.press('Tab');
  await expect.poll(async () => (await stored()).settings.simulators).toEqual([{ name: 'iPhone 15', sdk: '17.0.1-beta' }]);
});

/** File > New Profile, which (unlike the switcher) leaves focus where it is, and waits until the new profile is open. */
async function newProfileFromMenu() {
  await clickMenuItem(app, 'File', { label: 'New Profile' });
  await expect(profileSwitcher(page)).toHaveText('New profile');
}

/** Focus leaves whatever holds it, as when the person moves on, and any save has gone out. */
async function leaveFocus() {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(500); // past the save's 300 ms
}

/** The profiles as stored, the new one and the one it was made from. */
async function profilesAfter(fromId: string) {
  const all = await page.evaluate(() => window.xenon.profiles.list());
  return { created: all.find((p) => p.name === 'New profile')!, from: all.find((p) => p.id === fromId)! };
}

/** Back to the probe profile, and the new one deleted, so each test starts from the same place. */
async function dropNewProfile() {
  await page.evaluate(async () => {
    for (const p of await window.xenon.profiles.list()) if (p.name === 'New profile') await window.xenon.profiles.delete(p.id);
  });
  await page.reload();
  await expect(profileSwitcher(page)).toHaveText('Keychain probe');
}

test('File > New Profile with a table cell still focused writes nothing of it into either profile', async () => {
  await openSettingsTab('All settings');
  const table = page.locator('[data-setting-key="simulators"]');
  // The probe profile has a simulator row (the test before this one leaves one; alone, it adds one).
  if ((await table.getByLabel('name row 1', { exact: true }).count()) === 0) {
    await table.getByRole('button', { name: 'Add row', exact: true }).click();
    await table.getByLabel('name row 1', { exact: true }).fill('A-sim');
    await table.getByLabel('sdk row 1', { exact: true }).fill('1');
    await table.getByLabel('sdk row 1', { exact: true }).blur();
    await expect.poll(async () => (await stored()).settings.simulators).toEqual([{ name: 'A-sim', sdk: '1' }]);
  }
  const before = await stored();
  await table.getByLabel('name row 1', { exact: true }).click();
  await page.keyboard.type('X');
  await newProfileFromMenu();
  await leaveFocus();
  const { created, from } = await profilesAfter(before.id);
  expect(created.settings.simulators, 'the new profile took the old one’s rows').toEqual(
    makeDefaultProfile({ id: 'x', now: 0 }).settings.simulators
  );
  expect(from.settings.simulators).toEqual(before.settings.simulators);
  // The table on screen is the new profile's, which has no simulators.
  await expect(table.getByLabel('name row 1', { exact: true })).toHaveCount(0);
  await dropNewProfile();
});

test('File > New Profile with a number being typed keeps each profile’s own value', async () => {
  await setTechnical(page, true);
  await openSettingsTab('All settings');
  const before = await stored();
  const keepAlive = page.getByRole('spinbutton', { name: 'Keep-alive timeout' });
  await keepAlive.click();
  await keepAlive.fill('4242');
  await newProfileFromMenu();
  await leaveFocus();
  const { created, from } = await profilesAfter(before.id);
  expect(created.server.keepAliveTimeout).toBe(makeDefaultProfile({ id: 'x', now: 0 }).server.keepAliveTimeout);
  expect(from.server.keepAliveTimeout).toBe(before.server.keepAliveTimeout);
  await setTechnical(page, false);
  await dropNewProfile();
});
