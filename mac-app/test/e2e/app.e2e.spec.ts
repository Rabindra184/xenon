import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Drives the REAL built Electron app (out/) with an isolated user-data-dir, so
// these tests exercise the full renderer -> preload -> main -> stores/services
// stack without touching the developer's real profiles or Keychain.

const appDir = path.resolve(__dirname, '..', '..');
const shotsDir = path.join(appDir, 'test', 'e2e', 'screenshots');

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
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

test('boots with a seeded profile and window chrome', async () => {
  await expect(page.getByText('Xenon Control').first()).toBeVisible();
  await expect(page.getByText('Profiles')).toBeVisible();
  // First-run seed profile.
  await expect(page.getByTestId('profile-name')).toHaveValue('Local server');
  await page.screenshot({ path: path.join(shotsDir, '01-boot.png') });
});

test('renders the schema-driven settings form with grouped sections', async () => {
  await openTab('Settings');
  await expect(page.getByText('Platform & Discovery')).toBeVisible();
  await expect(page.getByText('Session Control')).toBeVisible();
  await expect(page.getByText('AI & Self-Healing')).toBeVisible();
  // A representative field auto-generated from schema.json (required → has a * marker).
  await expect(page.getByText('Max Sessions')).toBeVisible();
  // Secret-bearing settings are deferred to the Secrets panel, not shown as inputs
  // (all three AI keys render this notice).
  await expect(page.getByText(/is a secret — set it in the/).first()).toBeVisible();
  await expect(page.getByText(/is a secret — set it in the/)).toHaveCount(3);
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

test('creates, renames, and deletes a profile', async () => {
  await page.getByTestId('new-profile').click();
  await expect(page.getByTestId('profile-name')).toHaveValue('New profile');

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

test('deleting a profile requires an inline confirmation', async () => {
  await page.getByTestId('new-profile').click();
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
  const jsonField = page.getByPlaceholder('JSON').first(); // Simulators editor
  await jsonField.fill('[{"name": }]');
  await jsonField.blur();
  await expect(page.getByText(/Invalid JSON/).first()).toBeVisible();
  // The draft is preserved so the user can fix it rather than losing their input.
  await expect(jsonField).toHaveValue('[{"name": }]');
  await jsonField.fill('');
  await jsonField.blur();
  await expect(page.getByText(/Invalid JSON/)).not.toBeVisible();
});

test('Escape closes the launch preview modal', async () => {
  await page.getByTestId('preview-button').click();
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Launch preview — dry run')).not.toBeVisible();
});

test('sidebar shows brand, platform badge and status card', async () => {
  await expect(page.getByTestId('sidebar-brand')).toBeVisible();
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');
  await expect(page.getByTestId('sidebar-status')).toContainText('plugin');
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
});

test('launch preview shows the resolved config with required defaults', async () => {
  await page.getByTestId('preview-button').click();
  await expect(page.getByText('Launch preview — dry run')).toBeVisible();
  // The generated config carries required-key defaults (proves the merge fix).
  const configBlock = page.locator('pre');
  await expect(configBlock).toContainText('enableJsonLogging');
  await expect(configBlock).toContainText('use-plugins');
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
  // Runs BEFORE any Start attempt, so preflight state is still clean and Start's
  // enabled/disabled transition is driven purely by validation.
  await openTab('Settings');
  const portInput = page.locator('input[type="number"]').first();
  await portInput.fill('70000'); // out of 1..65535 range
  await expect(page.getByText(/validation issue/i).first()).toBeVisible();
  await expect(page.getByTestId('start-button')).toBeDisabled();
  await page.screenshot({ path: path.join(shotsDir, '08-validation.png'), fullPage: true });
  await portInput.fill('4723'); // restore
  await expect(page.getByTestId('start-button')).toBeEnabled();
});

test('health tab runs toolchain checks', async () => {
  await openTab('Health');
  await expect(page.getByText('Node.js')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Appium', { exact: true })).toBeVisible();
  await expect(page.getByText(/First-run setup/)).toBeVisible();
  await page.screenshot({ path: path.join(shotsDir, '05-health.png'), fullPage: true });
});

test('preflight blocks Start and surfaces blockers when the plugin is not installed', async () => {
  // Fresh user-data-dir => plugin not installed in the app-managed APPIUM_HOME,
  // so preflight must block and route the user to Health with a clear reason.
  await page.getByTestId('start-button').click();
  await expect(page.getByText('Cannot start yet:')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/xenon plugin is not installed|Port .* in use|Appium/i).first()).toBeVisible();
  await page.screenshot({ path: path.join(shotsDir, '06-preflight-block.png'), fullPage: true });
});
