import { describe, expect, it } from 'vitest';
import { schemaSourceLine } from '../src/renderer/src/schemaSource';

describe('schemaSourceLine', () => {
  it("names the installed Xenon when the list comes from the profile's Appium folder", () => {
    expect(schemaSourceLine({ source: 'installed', pluginVersion: '2.17.0', installedVersion: '2.17.0' })).toBe(
      "Showing the options of Xenon 2.17.0, installed in this profile's Appium folder."
    );
  });

  it("says Xenon isn't installed yet when nothing is installed", () => {
    expect(schemaSourceLine({ source: 'bundled', pluginVersion: '2.17.0', installedVersion: null })).toBe(
      "Xenon isn't installed yet. Showing the options of Xenon 2.17.0 until Set up installs it."
    );
  });

  it("owns up to the stand-in list when the installed Xenon didn't provide one", () => {
    expect(schemaSourceLine({ source: 'bundled', pluginVersion: '2.17.0', installedVersion: '2.9.4' })).toBe(
      "Showing the options that came with this app (Xenon 2.17.0). Your installed Xenon 2.9.4 didn't provide its own list, so a few may not apply."
    );
  });
});
