import os from 'os';
import ip from 'ip';

function isPrivateLan(address: string): boolean {
  if (address.startsWith('192.168.')) return true;
  if (address.startsWith('10.')) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

function isLinkLocal(address: string): boolean {
  return address.startsWith('169.254.');
}

function isIpv4(iface: os.NetworkInterfaceInfo): boolean {
  return iface.family === 'IPv4' || String(iface.family) === '4';
}

/** All non-internal IPv4 addresses on this host (Appium-style enumeration). */
export function listIpv4Addresses(): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (!isIpv4(iface) || iface.internal) continue;
      if (seen.has(iface.address)) continue;
      seen.add(iface.address);
      addresses.push(iface.address);
    }
  }
  return addresses;
}

/** Pick the best LAN-reachable IPv4 for URLs shown to remote clients. */
export function pickAdvertisedLanIp(): string {
  const addresses = listIpv4Addresses();
  const privateLan = addresses.filter(isPrivateLan);
  if (privateLan.length > 0) return privateLan[0];

  const routable = addresses.filter((addr) => !isLinkLocal(addr));
  if (routable.length > 0) return routable[0];

  if (addresses.length > 0) return addresses[0];

  try {
    const detected = ip.address();
    if (detected && detected !== '127.0.0.1') return detected;
  } catch {
    // fall through
  }
  return '127.0.0.1';
}

/** Values that mean "pick the best reachable LAN address automatically". */
export function shouldAutoResolveBindHost(value: string | undefined): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  const normalized = trimmed.toLowerCase();
  return (
    normalized === '0.0.0.0' ||
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === 'auto'
  );
}

export function resolveAdvertisedBindHost(configured?: string): string {
  if (!shouldAutoResolveBindHost(configured)) {
    return configured!.trim();
  }
  return pickAdvertisedLanIp();
}

export function listReachableBaseUrls(port: number, basePath = '/xenon'): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (host: string) => {
    const url = `http://${host}:${port}${basePath}`;
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  add('127.0.0.1');
  for (const addr of listIpv4Addresses()) {
    add(addr);
  }
  return urls;
}

const MAC_ADDRESS_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** True for dotted-decimal IPv4; rejects MAC addresses and other non-IP strings. */
export function isDeviceNetworkIp(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || MAC_ADDRESS_RE.test(trimmed)) return false;
  if (!IPV4_RE.test(trimmed)) return false;
  return trimmed.split('.').every((octet) => {
    const n = Number(octet);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export function sanitizeDeviceNetworkIp(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  return isDeviceNetworkIp(trimmed) ? trimmed : '';
}
