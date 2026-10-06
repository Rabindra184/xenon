import type { EffectiveSchemaInfo } from '@shared/types';

/**
 * The muted line above the settings search box: which Xenon the options on
 * screen describe, so a form that doesn't match the installed plugin says so
 * instead of silently showing a different set of options.
 */
export function schemaSourceLine(info: EffectiveSchemaInfo): string {
  if (info.source === 'installed') {
    return `Showing the options of Xenon ${info.pluginVersion}, installed in this profile's Appium folder.`;
  }
  if (info.installedVersion === null) {
    return `Xenon isn't installed yet. Showing the options of Xenon ${info.pluginVersion} until Set up installs it.`;
  }
  return (
    `Showing the options that came with this app (Xenon ${info.pluginVersion}). ` +
    `Your installed Xenon ${info.installedVersion} didn't provide its own list, so a few may not apply.`
  );
}
