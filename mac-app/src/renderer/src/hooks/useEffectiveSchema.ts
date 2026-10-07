import { useCallback, useEffect, useRef, useState } from 'react';
import type { EffectiveSchemaInfo, Profile, ServerStatus, XenonSchema } from '@shared/types';
import { statusInvalidatesPluginVersion, type PluginVersion } from '../pluginVersion';

export interface EffectiveSchemaApi {
  schema: XenonSchema | null;
  /** The id of the profile `schema` was last read for; null before the first answer. Settings are checked against it only once it is the open profile's. */
  schemaFor: string | null;
  /** Where `schema` came from (the installed Xenon or the bundled snapshot), for the line above the settings search box. */
  schemaInfo: EffectiveSchemaInfo | null;
  /**
   * Live plugin version read from the profile's APPIUM_HOME. `undefined` until
   * the first read lands, `null` when the plugin isn't installed there — see
   * pluginVersionLabel for why those are not the same thing.
   */
  installedPluginVersion: PluginVersion;
  /** Read the installed Xenon again: its version and its option list, together. Resolves when both are in. */
  refresh(): Promise<void>;
}

/**
 * What the installed Xenon says about itself, for the profile on screen: the
 * option list the settings form shows and the version Setup shows. Both
 * follow the profile's Appium folder, and are read again when it changes, when
 * a server starts, and when `refresh` is called (after a Set up, and on window
 * focus).
 */
export function useEffectiveSchema(draft: Profile | null, status: ServerStatus): EffectiveSchemaApi {
  const [schema, setSchema] = useState<XenonSchema | null>(null);
  const [schemaFor, setSchemaFor] = useState<string | null>(null);
  const [schemaInfo, setSchemaInfo] = useState<EffectiveSchemaInfo | null>(null);
  const [installedPluginVersion, setInstalledPluginVersion] = useState<PluginVersion>(undefined);

  // What a read depends on is which profile it is and where its Appium folder
  // is. `draft` is a new object on every keystroke in any field, which is not
  // a reason to look at the disk again, so the reads follow this key and ask
  // for the newest draft when they run.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const profileKey = draft ? JSON.stringify([draft.id, draft.server.appiumHome]) : null;

  // Read the live installed plugin version for the profile's APPIUM_HOME so the
  // version Setup shows is what's actually installed (re-read on profile change;
  // `refresh` is also called after an install/update).
  const refreshPluginVersion = useCallback(async () => {
    const profile = draftRef.current;
    if (!profile) {
      setInstalledPluginVersion(null);
      return;
    }
    setInstalledPluginVersion(await window.xenon.server.installedPluginVersion(profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey]);

  // The option list the form shows follows the same folder: the installed
  // Xenon's own list when it has one, else the bundled snapshot. Keyed on the
  // answer's provenance so a refresh that finds nothing new leaves the form
  // alone (its scroll position and search text), and a slow answer for a
  // profile the user has already left can't overwrite the current one.
  const schemaKey = useRef('');
  const schemaFetch = useRef(0);
  const refreshSchema = useCallback(async () => {
    const profile = draftRef.current;
    // Without a profile there is no form to show.
    if (!profile) return;
    const seq = ++schemaFetch.current;
    const s = await window.xenon.getSchema(profile);
    if (seq !== schemaFetch.current) return;
    setSchemaFor(profile.id);
    const key = JSON.stringify(s.info);
    if (key === schemaKey.current) return;
    schemaKey.current = key;
    setSchema(s.schema);
    setSchemaInfo(s.info);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey]);

  // Everything that reads the installed Xenon, together, so Setup's version and
  // the form can't disagree about which version is there.
  const refresh = useCallback(async () => {
    await Promise.all([refreshPluginVersion(), refreshSchema()]);
  }, [refreshPluginVersion, refreshSchema]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The read above happens on mount and on profile change, which is not when
  // the answer changes. A launcher left open across a plugin upgrade kept
  // showing the version it read at launch — measured, `plugin 1.18.1` beside a
  // server whose own banner said v1.20.0. Two more triggers, for the two ways
  // the plugin gets replaced:
  //
  //   - a start, because that is when Appium loads the plugin from disk and
  //     therefore when Setup's version is supposed to agree with the banner;
  //   - regaining focus, because an upgrade run in a terminal changes nothing
  //     this window can observe until the user comes back to it. The caller
  //     listens for that, since focus also bumps the readiness check.
  useEffect(() => {
    if (statusInvalidatesPluginVersion(status)) void refresh();
  }, [status, refresh]);

  return { schema, schemaFor, schemaInfo, installedPluginVersion, refresh };
}
