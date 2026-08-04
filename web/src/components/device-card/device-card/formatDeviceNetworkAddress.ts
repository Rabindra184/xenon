import { IDevice } from '../../../interfaces/IDevice';

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '0.0.0.0';
}

function formatHostUrl(raw?: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return raw;
  }
}

/** Prefer the device network IP; never show the local Xenon/Appium endpoint as a fallback. */
export function formatDeviceNetworkAddress(device: Pick<IDevice, 'ip' | 'host'>): string {
  if (device.ip) return device.ip;

  const fromHost = formatHostUrl(device.host);
  if (!fromHost) return '—';

  const hostname = fromHost.split(':')[0];
  if (isLoopbackHost(hostname)) return '—';

  return fromHost;
}
