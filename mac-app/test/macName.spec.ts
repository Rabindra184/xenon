import { describe, expect, it, vi } from 'vitest';
import { macLocalNameReader, readMacLocalName, type MacNameDeps } from '../src/main/macName';

// R27: colleagues reach this Mac at its Bonjour name (`scutil --get LocalHostName`) with .local
// added. os.hostname() can be a DHCP or DNS name, whose .local form nobody can reach.

const deps = (over: Partial<MacNameDeps> = {}): MacNameDeps => ({
  platform: 'darwin',
  localHostName: vi.fn(async () => 'Lab-Mac'),
  hostname: () => 'lab-mac-dhcp.corp.example.com',
  ...over
});

describe('readMacLocalName', () => {
  it('is the Bonjour name on a Mac, lower-cased', async () => {
    await expect(readMacLocalName(deps())).resolves.toBe('lab-mac');
  });

  it('trims what scutil prints', async () => {
    await expect(readMacLocalName(deps({ localHostName: async () => 'Lab-Mac\n' }))).resolves.toBe('lab-mac');
  });

  it('falls back to the host name’s first label when scutil fails', async () => {
    const d = deps({
      localHostName: async () => {
        throw new Error('scutil: timed out');
      }
    });
    await expect(readMacLocalName(d)).resolves.toBe('lab-mac-dhcp');
  });

  it('falls back to the host name’s first label when scutil has no name', async () => {
    await expect(readMacLocalName(deps({ localHostName: async () => '  \n' }))).resolves.toBe('lab-mac-dhcp');
  });

  it('drops .local from the host name, and lower-cases it', async () => {
    const d = deps({
      localHostName: async () => {
        throw new Error('no name');
      },
      hostname: () => 'Lab-Mac.local'
    });
    await expect(readMacLocalName(d)).resolves.toBe('lab-mac');
  });

  it('does not ask scutil anywhere but a Mac', async () => {
    const localHostName = vi.fn(async () => 'Lab-Mac');
    await expect(readMacLocalName(deps({ platform: 'linux', localHostName, hostname: () => 'Box.lan' }))).resolves.toBe(
      'box'
    );
    expect(localHostName).not.toHaveBeenCalled();
  });
});

describe('macLocalNameReader', () => {
  it('asks scutil once and keeps the answer', async () => {
    const localHostName = vi.fn(async () => 'Lab-Mac');
    const read = macLocalNameReader(deps({ localHostName }));
    await expect(read()).resolves.toBe('lab-mac');
    await expect(read()).resolves.toBe('lab-mac');
    expect(localHostName).toHaveBeenCalledTimes(1);
  });

  it('keeps the fallback too, rather than asking again for every address', async () => {
    const localHostName = vi.fn(async () => {
      throw new Error('scutil: timed out');
    });
    const read = macLocalNameReader(deps({ localHostName }));
    await Promise.all([read(), read()]);
    await expect(read()).resolves.toBe('lab-mac-dhcp');
    expect(localHostName).toHaveBeenCalledTimes(1);
  });
});
