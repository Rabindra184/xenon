import { describe, expect, it } from 'vitest';
import { shareAddresses } from '../src/main/shareAddresses';

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

  it('removes only a final .local', () => {
    expect(at('/wd/hub', 'my.local.box').colleagues).toBe('http://my.local.box.local:4723/wd/hub');
  });

  it('puts the port in both addresses', () => {
    const out = shareAddresses({ port: 4799, basePath: '' }, 'lab-mac');
    expect(out).toEqual({ test: 'http://localhost:4799', colleagues: 'http://lab-mac.local:4799' });
  });

  it('never touches the test address with the host name', () => {
    expect(at('/wd/hub', 'Whatever.local').test).toBe('http://localhost:4723/wd/hub');
  });
});
