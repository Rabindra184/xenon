import { describe, expect, it } from 'vitest';
import { localLabel, shareAddresses } from '../src/main/shareAddresses';

const PORT = 4723;
const at = (basePath: string, hostname = 'lab-mac') => shareAddresses({ port: PORT, basePath }, hostname);

describe('shareAddresses: the base path', () => {
  it('adds nothing for an empty base path or a lone slash', () => {
    expect(at('').test).toBe('http://localhost:4723');
    expect(at('/').test).toBe('http://localhost:4723');
    expect(at('').colleagues).toBe('http://lab-mac.local:4723');
    expect(at('/').colleagues).toBe('http://lab-mac.local:4723');
  });

  it('keeps a base path that is already tidy', () => {
    expect(at('/wd/hub').test).toBe('http://localhost:4723/wd/hub');
  });

  it('drops a trailing slash', () => {
    expect(at('/wd/hub/').test).toBe('http://localhost:4723/wd/hub');
  });

  it('adds a missing leading slash', () => {
    expect(at('wd/hub').test).toBe('http://localhost:4723/wd/hub');
    expect(at('wd/hub/').test).toBe('http://localhost:4723/wd/hub');
  });

  it('reads a base path made only of slashes as none', () => {
    expect(at('//').test).toBe('http://localhost:4723');
  });

  it('uses the same base path for both addresses', () => {
    const { test, colleagues } = at('/wd/hub/');
    expect(test).toBe('http://localhost:4723/wd/hub');
    expect(colleagues).toBe('http://lab-mac.local:4723/wd/hub');
  });
});

describe('shareAddresses: the host', () => {
  const want = 'http://lab-mac.local:4723/wd/hub';

  it('lower-cases the name and does not double the .local', () => {
    expect(at('/wd/hub', 'Lab-Mac.local').colleagues).toBe(want);
  });

  it('adds .local to a bare name', () => {
    expect(at('/wd/hub', 'lab-mac').colleagues).toBe(want);
  });

  it('drops a trailing dot, then the .local before it', () => {
    expect(at('/wd/hub', 'lab-mac.local.').colleagues).toBe(want);
    expect(at('/wd/hub', 'Lab-Mac.LOCAL...').colleagues).toBe(want);
  });

  // R27: a .local name is one label. A DHCP or DNS host name has one only for its first label, so a
  // longer name is cut to it rather than given a .local nobody can reach.
  it('uses only the first label of a dotted name', () => {
    expect(at('/wd/hub', 'my.local.box').colleagues).toBe('http://my.local:4723/wd/hub');
    expect(at('/wd/hub', 'lab-mac.corp.example.com').colleagues).toBe(want);
    expect(at('/wd/hub', 'Lab-Mac.Corp.Example.COM.').colleagues).toBe(want);
  });

  it('never ends in .corp.example.com.local', () => {
    expect(at('/wd/hub', 'lab-mac.corp.example.com').colleagues).not.toContain('example.com.local');
  });

  it('gives no name before .local for a name that is empty or only dots', () => {
    expect(at('', '').colleagues).toBe('http://.local:4723');
    expect(at('', '...').colleagues).toBe('http://.local:4723');
    expect(at('', '.local').colleagues).toBe('http://.local:4723');
  });

  it('puts the port in both addresses', () => {
    const out = shareAddresses({ port: 4799, basePath: '' }, 'lab-mac');
    expect(out).toEqual({ test: 'http://localhost:4799', colleagues: 'http://lab-mac.local:4799' });
  });

  it('never touches the test address with the host name', () => {
    expect(at('/wd/hub', 'Whatever.local').test).toBe('http://localhost:4723/wd/hub');
  });
});

describe('localLabel', () => {
  it('is the first label, lower-cased, without trailing dots', () => {
    expect(localLabel('Rabindras-MacBook-Pro')).toBe('rabindras-macbook-pro');
    expect(localLabel('Rabindras-MacBook-Pro.local')).toBe('rabindras-macbook-pro');
    expect(localLabel('lab-mac.corp.example.com')).toBe('lab-mac');
    expect(localLabel('lab-mac.')).toBe('lab-mac');
  });

  it('trims spaces around it, as a command’s answer has', () => {
    expect(localLabel('  Lab-Mac\n')).toBe('lab-mac');
  });

  it('is empty for nothing', () => {
    expect(localLabel('')).toBe('');
    expect(localLabel('  ')).toBe('');
  });
});
