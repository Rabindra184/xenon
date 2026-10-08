import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

// Each launch writes its profile's Appium config (<profile id>.yaml) to the
// launch-configs folder and Appium reads it once, at start. Files an older
// version wrote can hold a proxy password or a cloud key in plain text, so they
// are deleted when the app starts, before any launch writes a new one, and a
// profile's file goes with the profile.

/**
 * Deletes every config file (`*.yaml`) in `dir`, and nothing else. A folder
 * that isn't there yet holds none. Each file that can't be deleted, and a
 * folder that can't be read, is reported to `onError`; the rest still go.
 */
export function clearLaunchConfigs(dir: string, onError: (err: unknown) => void): void {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
      .map((entry) => entry.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') onError(err);
    return;
  }
  for (const name of names) {
    try {
      rmSync(path.join(dir, name), { force: true });
    } catch (err) {
      onError(err);
    }
  }
}

/**
 * Deletes the config file of the profile with this id, if it launched. Only a
 * file directly in `dir` is ever deleted, whatever the id holds. A failure is
 * reported to `onError`.
 */
export function removeLaunchConfig(dir: string, profileId: string, onError: (err: unknown) => void): void {
  const name = `${profileId}.yaml`;
  if (path.basename(name) !== name || profileId === '' || profileId === '.' || profileId === '..') return;
  try {
    rmSync(path.join(dir, name), { force: true });
  } catch (err) {
    onError(err);
  }
}
