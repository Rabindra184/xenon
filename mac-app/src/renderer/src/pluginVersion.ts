import type { ServerStatus } from '@shared/types';

/**
 * What the installed plugin version is, as far as the footer knows.
 *
 * Three states, not two: `undefined` is "not read yet", `null` is "read, and
 * the plugin is not installed". Collapsing them is what lets a footer claim a
 * version for a machine that has none.
 */
export type PluginVersion = string | null | undefined;

/**
 * The text the footer shows after the word "plugin".
 *
 * A version that was never read is not the same as one that came back empty,
 * and neither is a licence to substitute a different number. The footer used
 * to fall back to the schema-sync `meta.pluginVersion`, which is baked into the
 * app bundle at build time and drifts from the installed plugin by design — on
 * an app built at 1.11.2 with nothing installed, it read `plugin 1.11.2`.
 */
export function pluginVersionLabel(version: PluginVersion): string {
  if (version === undefined) return '…';
  if (version === null) return 'not installed';
  return version;
}

/**
 * Whether reaching this server status means the plugin on disk may no longer
 * match what the footer last read.
 *
 * Only a start does. It is the one moment the launcher knows Appium just
 * loaded the plugin from disk, so it is also the moment the footer can be made
 * to agree with the version banner that launch printed — which is the whole
 * point of showing it. Stopping, crashing and the transitional states leave
 * `node_modules` exactly as it was; re-reading on those would be noise.
 *
 * This does not cover a plugin swapped from outside the app with the server
 * left alone. Window focus does — see the listener in App.tsx.
 */
export function statusInvalidatesPluginVersion(status: ServerStatus): boolean {
  return status === 'running';
}
