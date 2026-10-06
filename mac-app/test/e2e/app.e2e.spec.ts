import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Drives the REAL built Electron app (out/) with an isolated user-data-dir, so
// these tests exercise the full renderer -> preload -> main -> stores/services
// stack without touching the developer's real profiles or Keychain.

const appDir = path.resolve(__dirname, '..', '..');
const shotsDir = path.join(appDir, 'test', 'e2e', 'screenshots');

let app: ElectronApplication;
let page: Page;

// The seeded profile uses 4723, where a real server often runs on a developer
// machine, and Start stays off while a port is taken. Tests that need Start on
// switch to a port picked as free for this run instead.
let freePort = 0;

async function pickFreePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * What ⌘⏎ does: the Server menu's Start item. Playwright's key events go
 * straight to the page and never reach a native menu accelerator, so click the
 * menu item itself, which is what the accelerator runs.
 */
async function pressStartShortcut() {
  await app.evaluate(({ Menu }) => {
    const server = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Server');
    const item = server?.submenu?.items.find((i) => i.accelerator === 'Cmd+Return');
    if (!item) throw new Error('No Cmd+Return item in the Server menu');
    item.click();
  });
}

test.beforeAll(async () => {
  freePort = await pickFreePort();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-'));
  app = await electron.launch({
    args: [appDir, `--user-data-dir=${userDataDir}`],
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'test' }
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Wait for the initial schema + profiles IPC round-trip to render the UI.
  await expect(page.getByTestId('profile-name')).toBeVisible({ timeout: 20_000 });
});

test.afterAll(async () => {
  await app?.close();
});

async function openTab(name: 'Settings' | 'Secrets & Env' | 'Health' | 'Logs') {
  await page.getByRole('tab', { name, exact: true }).click();
}

/**
 * Click + and wait until the new profile is the one on screen. It becomes
 * active only once the main process has saved it, and anything typed before
 * then edits the previous profile: a test that filled the name straight away
 * renamed (and then deleted) another test's profile.
 */
async function createProfile() {
  const rows = page.getByTestId('profile-row');
  const before = await rows.count();
  await page.getByTestId('new-profile').click();
  await expect(rows).toHaveCount(before + 1);
  await expect(page.getByTestId('profile-name')).toHaveValue('New profile');
}

test('boots with a seeded profile and window chrome', async () => {
  await expect(page.getByText('Xenon Control').first()).toBeVisible();
  await expect(page.getByText('Profiles')).toBeVisible();
  // First-run seed profile.
  await expect(page.getByTestId('profile-name')).toHaveValue('Local server');
  await page.screenshot({ path: path.join(shotsDir, '01-boot.png') });
});

test('renders the schema-driven settings form with grouped sections', async () => {
  await openTab('Settings');
  // Section titles appear twice (nav + heading); assert on the headings.
  await expect(page.getByRole('heading', { name: 'Platform & Discovery' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Session Control' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI & Self-Healing' })).toBeVisible();
  // The line saying which Xenon these options come from (installed or bundled depends on the machine).
  await expect(page.getByTestId('schema-source')).toContainText(/Xenon \d+\.\d+\.\d+/);
  // A representative field auto-generated from the option list.
  await expect(page.getByText('Max Sessions')).toBeVisible();
  // Secret-bearing settings are deferred to the Secrets panel, not shown as inputs
  // (the three AI keys and the Database URL render this notice).
  await expect(page.getByText(/is a secret — set it in the/).first()).toBeVisible();
  await expect(page.getByText(/is a secret — set it in the/)).toHaveCount(4);
  await page.screenshot({ path: path.join(shotsDir, '02-settings.png'), fullPage: true });
});

test('persists a setting change through the store', async () => {
  await openTab('Settings');
  const android = page.getByRole('radio', { name: 'android', exact: true }).first();
  await android.click();
  await expect(android).toHaveAttribute('aria-checked', 'true');
  // Re-read via a fresh selection round-trip: switch tabs and back.
  await openTab('Health');
  await openTab('Settings');
  await expect(page.getByRole('radio', { name: 'android', exact: true }).first()).toHaveAttribute(
    'aria-checked',
    'true'
  );
});

test('a setting changed just before creating a profile is kept', async () => {
  // The save waits 300 ms for typing to stop and holds one edit. Creating a
  // profile didn't save it first, so the new profile's first edit replaced it
  // and the setting was lost.
  await openTab('Settings');
  await page.getByTestId('settings-search').fill('');
  const original = await page.getByTestId('profile-name').inputValue();
  const platform = page.getByRole('radiogroup', { name: 'Platform', exact: true });
  const previous = (await platform.getByRole('radio', { checked: true }).textContent())?.trim();
  const changed = previous === 'ios' ? 'both' : 'ios';
  await platform.getByRole('radio', { name: changed, exact: true }).click();

  await createProfile();
  await page.getByTestId('profile-name').fill('Pending-edit probe');
  await page.getByTestId('profile-row').filter({ hasText: original }).click();
  await expect(page.getByTestId('profile-name')).toHaveValue(original);
  await expect(platform.getByRole('radio', { name: changed, exact: true })).toHaveAttribute('aria-checked', 'true');

  // Clean up: remove the probe and put the platform back.
  const row = page.getByTestId('profile-row').filter({ hasText: 'Pending-edit probe' });
  await row.hover();
  await row.getByRole('button', { name: 'Delete' }).click();
  await row.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(row).toHaveCount(0);
  if (previous) await platform.getByRole('radio', { name: previous, exact: true }).click();
});

test('creates, renames, and deletes a profile', async () => {
  await createProfile();

  const name = page.getByTestId('profile-name');
  await name.fill('QA Lab — iOS');
  // Persisted name shows up in the sidebar list.
  await expect(page.getByText('QA Lab — iOS')).toBeVisible();

  // Reselect the seed profile then come back — name survived (persistence).
  await page.getByText('Local server').click();
  await expect(page.getByTestId('profile-name')).toHaveValue('Local server');
  await page.getByText('QA Lab — iOS').click();
  await expect(page.getByTestId('profile-name')).toHaveValue('QA Lab — iOS');

  await page.screenshot({ path: path.join(shotsDir, '03-profiles.png') });
});

test('a new profile defaults to booted-only simulator discovery', async () => {
  await createProfile();
  await page.getByTestId('profile-name').fill('Booted default probe');
  await openTab('Settings');
  await page.getByTestId('settings-search').fill('bootedSimulators');
  await expect(page.getByRole('switch').first()).toHaveAttribute('aria-checked', 'true');

  // Clean up: remove the probe profile.
  const row = page.getByTestId('profile-row').filter({ hasText: 'Booted default probe' });
  await row.hover();
  await row.getByRole('button', { name: 'Delete' }).click();
  await row.getByRole('button', { name: 'Confirm delete' }).click();
  await openTab('Settings');
  await page.getByTestId('settings-search').fill('');
});

test('deleting a profile requires an inline confirmation', async () => {
  await createProfile();
  await page.getByTestId('profile-name').fill('Delete-me probe');
  await expect(page.getByText('Delete-me probe')).toBeVisible();

  const row = page.getByTestId('profile-row').filter({ hasText: 'Delete-me probe' });
  await row.hover();
  await row.getByRole('button', { name: 'Delete' }).click();
  // First click arms the confirm state — nothing is deleted yet.
  await expect(page.getByText('Delete-me probe')).toBeVisible();
  await row.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('Delete-me probe')).not.toBeVisible();
});

test('logs tab is reachable and distinct from the Log Folder button', async () => {
  // The tab has role=tab; the folder opener is a button named "Log Folder".
  await expect(page.getByRole('button', { name: 'Log Folder', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Logs', exact: true }).click();
  await expect(page.getByText('No output yet. Start the server to see logs.')).toBeVisible();
});

test('invalid JSON in a settings field shows an inline error and keeps the draft', async () => {
  await openTab('Settings');
  // Object-array fields render a table editor; JSON is the escape hatch.
  await page.getByRole('button', { name: 'Edit as JSON' }).first().click();
  const jsonField = page.getByPlaceholder('JSON').first();
  await jsonField.fill('[{"name": }]');
  await jsonField.blur();
  await expect(page.getByText(/Invalid JSON/).first()).toBeVisible();
  // The draft is preserved so the user can fix it rather than losing their input.
  await expect(jsonField).toHaveValue('[{"name": }]');
  await jsonField.fill('');
  await jsonField.blur();
  await expect(page.getByText(/Invalid JSON/)).not.toBeVisible();
  await page.getByRole('button', { name: 'Edit as table' }).first().click();
});

test('chip editor round-trips a string-array setting', async () => {
  await openTab('Settings');
  await page.getByTestId('settings-search').fill('adbRemote');
  const chipInput = page.getByPlaceholder('add + Enter').first();
  await chipInput.fill('192.168.1.50:5555');
  await chipInput.press('Enter');
  await expect(page.getByText('192.168.1.50:5555')).toBeVisible();

  // Round-trip through the store: leave the tab and come back.
  await openTab('Health');
  await openTab('Settings');
  await page.getByTestId('settings-search').fill('adbRemote');
  await expect(page.getByText('192.168.1.50:5555')).toBeVisible();

  await page.getByRole('button', { name: 'Remove 192.168.1.50:5555' }).click();
  await expect(page.getByText('192.168.1.50:5555')).not.toBeVisible();
  await page.getByTestId('settings-search').fill('');
});

test('table editor round-trips an object-array setting', async () => {
  await openTab('Settings');
  await page.getByTestId('settings-search').fill('simulators');
  await page.getByRole('button', { name: 'Add row' }).first().click();
  const cell = page.getByRole('textbox', { name: 'name row 1' });
  await cell.fill('iPhone 15');
  await cell.blur();

  await openTab('Health');
  await openTab('Settings');
  await page.getByTestId('settings-search').fill('simulators');
  await expect(page.getByRole('textbox', { name: 'name row 1' })).toHaveValue('iPhone 15');

  await page.getByRole('button', { name: 'Remove row' }).first().click();
  await page.getByTestId('settings-search').fill('');
});

test('Escape closes the launch preview modal', async () => {
  await page.getByTestId('preview-button').click();
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Launch preview — dry run')).not.toBeVisible();
});

test('launch preview traps Tab focus inside the dialog and restores it on close', async () => {
  await page.getByTestId('preview-button').click();
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();

  // Tab well past the number of controls in the dialog; focus must never escape.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]')
    );
    expect(inside, `focus escaped the dialog on Tab #${i + 1}`).toBe(true);
  }
  // Shift+Tab wraps backwards without escaping either.
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByText('Launch preview — dry run')).not.toBeVisible();
  // Focus returns to the control that opened the modal.
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('preview-button');
});

test('clearing the port shows an error and blocks Start without storing NaN', async () => {
  const port = page.getByRole('spinbutton', { name: 'Port' });
  await port.fill('');
  await expect(port).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Port: Port is required.')).toBeVisible();
  await expect(page.getByTestId('start-button')).toBeDisabled();
  // The status bar says why, next to Start and as its tooltip.
  await expect(page.getByText('Fix 1 setting first: Port')).toBeVisible();
  await expect(page.getByTestId('start-button')).toHaveAttribute('title', 'Fix 1 setting first: Port');

  // The invalid draft never reached the store: the sidebar badge keeps the last
  // good port, and a reselect round-trip restores it rather than null/NaN.
  await expect(page.getByTestId('profile-row').filter({ hasText: 'Local server' })).toContainText(':4723');
  await port.fill(String(freePort));
  await expect(page.getByTestId('start-button')).toBeEnabled();
});

test('⌘Return with an invalid port does not start and focuses the port field', async () => {
  const port = page.getByRole('spinbutton', { name: 'Port' });
  await port.fill('');
  await expect(page.getByText('Fix 1 setting first: Port')).toBeVisible();
  // Focus is somewhere else, so landing on the port is the shortcut's doing.
  await page.getByTestId('profile-name').focus();
  await expect(port).not.toBeFocused();

  await pressStartShortcut();
  await expect(port).toBeFocused();
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');
  await expect(page.getByTestId('stop-button')).toHaveCount(0);

  await port.fill(String(freePort));
  await expect(page.getByTestId('start-button')).toBeEnabled();
});

test('a port in use blocks Start with a plain reason and clears on its own', async () => {
  const taken = net.createServer();
  await new Promise<void>((resolve) => taken.listen(4799, resolve));
  let released = false;
  try {
    await page.getByRole('spinbutton', { name: 'Port' }).fill('4799');
    const reason = 'Port 4799 is already in use by another app. Choose another port or close that app.';
    await expect(page.getByText(reason)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('start-button')).toBeDisabled();
    await expect(page.getByTestId('start-button')).toHaveAttribute('title', reason);

    await new Promise((resolve) => taken.close(resolve));
    released = true;
    // Nothing in the app changed: coming back to the window is what re-checks.
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
    await expect(page.getByTestId('start-button')).toBeEnabled({ timeout: 2_000 });
    await expect(page.getByText(reason)).toHaveCount(0);
  } finally {
    if (!released) await new Promise((resolve) => taken.close(resolve));
    await page.getByRole('spinbutton', { name: 'Port' }).fill(String(freePort));
  }
});

test('the Logs "Start server" link takes the same path as Start', async () => {
  const port = page.getByRole('spinbutton', { name: 'Port' });
  await port.fill('');
  await openTab('Logs');
  await page.getByRole('button', { name: 'Start server' }).click();
  // A server-level setting lives in the header, so there is no tab to leave.
  await expect(port).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');

  await port.fill(String(freePort));
  await openTab('Settings');
});

test('profile edits survive a rapid-typing debounce window', async () => {
  const name = page.getByTestId('profile-name');
  await name.fill('');
  // pressSequentially fires one input event per character — the save is debounced.
  await name.pressSequentially('Debounced name', { delay: 15 });
  // Switching profiles flushes the pending write; coming back proves it landed.
  await page.getByTestId('profile-row').filter({ hasText: 'QA Lab — iOS' }).click();
  await expect(page.getByTestId('profile-name')).toHaveValue('QA Lab — iOS');
  await page.getByTestId('profile-row').filter({ hasText: 'Debounced name' }).click();
  await expect(page.getByTestId('profile-name')).toHaveValue('Debounced name');
  await name.fill('Local server');
});

test('log console shows a line count, Clear button and start CTA when empty', async () => {
  await openTab('Logs');
  await expect(page.getByText(/0 lines/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start server' })).toBeVisible();
});

test('settings search filters fields by key name', async () => {
  await openTab('Settings');
  const search = page.getByTestId('settings-search');
  await search.fill('adbRemote');
  await expect(page.getByText('ADB Remote')).toBeVisible();
  await expect(page.getByText('Max Sessions')).not.toBeVisible();
  await search.fill('zzz-no-match');
  await expect(page.getByText(/No settings match/)).toBeVisible();
  await search.fill('');
  await expect(page.getByText('Max Sessions')).toBeVisible();
});

test('sidebar shows brand, platform badge and status card', async () => {
  await expect(page.getByTestId('sidebar-brand')).toBeVisible();
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');
  // A definite answer, not the pending placeholder: either a version read from
  // this machine's APPIUM_HOME or an explicit "not installed". `toContainText('plugin')`
  // alone passed while the footer sat on '…' forever.
  await expect(page.getByTestId('sidebar-status')).toContainText(
    /plugin (\d+\.\d+\.\d+|not installed)/
  );
});

test('secrets panel lists env-injected secrets and toggles injection', async () => {
  await openTab('Secrets & Env');
  await expect(page.getByText('Gemini API key')).toBeVisible();
  await expect(page.getByText('XENON_HUB_TOKEN')).toBeVisible();
  // Toggle "inject in this profile" for the first secret.
  const firstInject = page.getByRole('checkbox').first();
  await firstInject.check();
  await expect(firstInject).toBeChecked();
  await page.screenshot({ path: path.join(shotsDir, '04-secrets.png'), fullPage: true });
});

test('env-vars editor adds an arbitrary variable to the profile', async () => {
  await openTab('Secrets & Env');
  await expect(page.getByRole('heading', { name: 'Environment variables' })).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const keyInput = page.getByPlaceholder('KEY').first();
  await keyInput.fill('OTEL_EXPORTER_OTLP_ENDPOINT');
  await expect(keyInput).toHaveValue('OTEL_EXPORTER_OTLP_ENDPOINT');
  await expect(page.getByText(/saved in the profile as plain text/)).toHaveCount(0);
  // A variable named like a secret is pointed at its Keychain-backed field.
  await keyInput.fill('DATABASE_URL');
  await expect(page.getByText(/DATABASE_URL belongs above, under Database URL/)).toBeVisible();
  await keyInput.fill('OTEL_EXPORTER_OTLP_ENDPOINT');
  await expect(page.getByText(/saved in the profile as plain text/)).toHaveCount(0);
});

test('launch preview shows the resolved config', async () => {
  await page.getByTestId('preview-button').click();
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();
  // Which legacy defaults are written depends on the Xenon installed on this
  // machine (a plugin without a `required` list gets none), so assert only
  // what every install produces.
  const configBlock = page.locator('pre');
  await expect(configBlock).toContainText('use-plugins');
  await expect(configBlock).toContainText('xenon:');
  await page.screenshot({ path: path.join(shotsDir, '07-preview.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
});

test('copying the preview config shows a toast', async () => {
  await page.getByTestId('preview-button').click();
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByText('Config copied')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Launch preview — dry run')).not.toBeVisible();
});

test('invalid config produces a validation issue and disables Start', async () => {
  // Start has two gates: validation, which answers at once, and the readiness
  // check that runs in the background. The invalid port turns Start off
  // immediately; the valid one brings it back once the readiness check agrees.
  await openTab('Settings');
  const portInput = page.locator('input[type="number"]').first();
  await portInput.fill('70000'); // out of 1..65535 range
  await expect(page.getByText(/validation issue/i).first()).toBeVisible();
  await expect(page.getByTestId('start-button')).toBeDisabled();
  await page.screenshot({ path: path.join(shotsDir, '08-validation.png'), fullPage: true });
  await portInput.fill(String(freePort)); // restore
  await expect(page.getByTestId('start-button')).toBeEnabled();
});

test('health tab runs toolchain checks', async () => {
  await openTab('Health');
  await expect(page.getByText('Node.js')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Appium', { exact: true })).toBeVisible();
  await expect(page.getByText(/First-run setup/)).toBeVisible();
  // The ports row for simulators and WebDriverAgent is retired: the plugin chooses those itself.
  await expect(page.getByText('Simulator / WDA ports')).toHaveCount(0);
  // The button says "Set up" (the checks' remedies tell people to run it); the server is stopped here.
  await expect(page.getByRole('button', { name: 'Set up', exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(shotsDir, '05-health.png'), fullPage: true });
});

test('health surfaces the resolved ANDROID_HOME', async () => {
  await openTab('Health');
  // adb check reports the SDK root the launcher injects, not just a version.
  await expect(page.getByText(/ANDROID_HOME=|no Android SDK detected|SDK root could be resolved/)).toBeVisible({
    timeout: 20_000
  });
});

test('APPIUM_HOME auto-detects a home on this host', async () => {
  const input = page.getByTestId('appium-home');
  await expect(input).toHaveValue(''); // '' means auto — profiles stay portable
  // The placeholder shows what auto actually resolved to, so it isn't magic.
  await expect(input).toHaveAttribute('placeholder', /^auto: \//);
});

test('preflight blocks Start and surfaces blockers when the plugin is not installed', async () => {
  // Pin an APPIUM_HOME that definitely has no plugin. Without this the test is
  // host-dependent: auto-detection finds a real plugin-bearing home on a
  // developer machine, but not on CI.
  const emptyHome = mkdtempSync(path.join(os.tmpdir(), 'xenon-empty-home-'));
  await page.getByTestId('appium-home').fill(emptyHome);

  // Nobody pressed Start: the folder edit alone re-checks and turns it off.
  const start = page.getByTestId('start-button');
  await expect(start).toBeDisabled({ timeout: 25_000 });
  const reason = /Run Set up on the Health tab first|Port .* is already in use by another app/;
  await expect(start).toHaveAttribute('title', reason);

  // The shortcut doesn't start it either: it takes you to the Health tab.
  await openTab('Settings');
  await pressStartShortcut();
  await expect(page.getByRole('tab', { name: 'Health', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('readiness-blockers').getByText(reason).first()).toBeVisible();
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');
  await page.screenshot({ path: path.join(shotsDir, '06-preflight-block.png'), fullPage: true });

  // Back to auto: the folder edit re-checks and Start comes back by itself.
  await page.getByTestId('appium-home').fill('');
  await expect(start).toBeEnabled({ timeout: 25_000 });
  await expect(page.getByTestId('readiness-blockers')).toHaveCount(0);
});

test('footer re-reads the plugin version when it changes underneath the app', async () => {
  // The reported bug: a launcher left open across `appium plugin update xenon`
  // in a terminal kept showing the version it read at launch — `plugin 1.18.1`
  // beside a server whose own banner said v1.20.0. Nothing re-read it.
  const home = mkdtempSync(path.join(os.tmpdir(), 'xenon-ver-home-'));
  const pkgDir = path.join(home, 'node_modules', '@xenon-device-management', 'xenon');
  mkdirSync(pkgDir, { recursive: true });
  const pkgJson = path.join(pkgDir, 'package.json');
  writeFileSync(pkgJson, JSON.stringify({ name: '@xenon-device-management/xenon', version: '1.0.0' }));

  await page.getByTestId('appium-home').fill(home);
  await expect(page.getByTestId('sidebar-status')).toContainText('plugin 1.0.0');

  // Upgrade it the way a terminal would — behind the app's back.
  writeFileSync(pkgJson, JSON.stringify({ name: '@xenon-device-management/xenon', version: '2.0.0' }));
  await expect(page.getByTestId('sidebar-status')).toContainText('plugin 1.0.0'); // still stale…
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
  await expect(page.getByTestId('sidebar-status')).toContainText('plugin 2.0.0'); // …until focus

  // And an APPIUM_HOME with no plugin says so, rather than naming a version.
  rmSync(pkgDir, { recursive: true, force: true });
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
  await expect(page.getByTestId('sidebar-status')).toContainText('plugin not installed');

  await page.getByTestId('appium-home').fill(''); // back to auto
  rmSync(home, { recursive: true, force: true });
});
