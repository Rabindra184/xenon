import { IDevice } from '../../../interfaces/IDevice';
import { serverLabel } from '../../../lib/phone';

const MAC_ADDRESS_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isDeviceNetworkIp(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || MAC_ADDRESS_RE.test(trimmed)) return false;
  if (!IPV4_RE.test(trimmed)) return false;
  return trimmed.split('.').every((octet) => {
    const n = Number(octet);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '0.0.0.0';
}

/** The device's own IPv4 address, or null (never a MAC address or junk). */
export function deviceNetworkIp(device: Pick<IDevice, 'ip'>): string | null {
  return device.ip && isDeviceNetworkIp(device.ip) ? device.ip.trim() : null;
}

/** Prefer the device network IP; never show MAC addresses or loopback Xenon URLs. */
export function formatDeviceNetworkAddress(device: Pick<IDevice, 'ip' | 'host'>): string {
  if (device.ip && isDeviceNetworkIp(device.ip)) return device.ip;

  if (!device.host) return '—';
  const fromHost = serverLabel(device.host);

  const hostname = fromHost.split(':')[0];
  if (isLoopbackHost(hostname)) return '—';

  return fromHost;
}
