import { execFile } from 'node:child_process';
import os from 'node:os';
import { localLabel } from './shareAddresses';

/** How long scutil may take before the host name is used instead. */
const SCUTIL_TIMEOUT_MS = 1_500;

export interface MacNameDeps {
  platform: NodeJS.Platform;
  /** What `scutil --get LocalHostName` prints; rejects when it has no answer. */
  localHostName(): Promise<string>;
  hostname(): string;
}

/**
 * This Mac's name on the local network, which colleagues reach as <name>.local
 * (R27). On a Mac it is the Bonjour name, the "Local hostname" in Sharing
 * settings, which `scutil --get LocalHostName` gives. Anywhere else, or when
 * scutil gives nothing, it is the first label of the host name, without .local,
 * lower-cased: a DHCP or DNS host name has a .local name only for that label.
 */
export async function readMacLocalName(deps: MacNameDeps): Promise<string> {
  if (deps.platform === 'darwin') {
    try {
      const bonjour = localLabel(await deps.localHostName());
      if (bonjour !== '') return bonjour;
    } catch {
      // No Bonjour name to read: the host name follows.
    }
  }
  return localLabel(deps.hostname());
}

/** readMacLocalName, read once and kept: the name changes only when someone renames the Mac. */
export function macLocalNameReader(deps: MacNameDeps): () => Promise<string> {
  let kept: Promise<string> | null = null;
  return () => {
    kept ??= readMacLocalName(deps);
    return kept;
  };
}

/** `scutil --get LocalHostName`, with a short timeout so an address is never held up for long. */
function scutilLocalHostName(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('/usr/sbin/scutil', ['--get', 'LocalHostName'], { timeout: SCUTIL_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

/** This Mac's name for the colleagues' address, read the first time it is asked for. */
export const macLocalName = macLocalNameReader({
  platform: process.platform,
  localHostName: scutilLocalHostName,
  hostname: () => os.hostname()
});
