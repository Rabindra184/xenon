import { describe, expect, it } from 'vitest';
import { shownColleaguesAddress, testAddressSource } from '../src/renderer/src/addresses';
import { makeDefaultProfile } from '../src/shared/profileDefaults';
import type { Profile, ServerState, ServerStatus } from '../src/shared/types';

const profile = (id: string, port: number, basePath = '/wd/hub'): Profile => {
  const p = makeDefaultProfile({ id, now: 0 });
  return { ...p, server: { ...p.server, port, basePath } };
};

const A = profile('a', 4799, '/wd/hub');
const B = profile('b', 4800, '');
const profiles = [A, B];

const server = (
  status: ServerStatus,
  over: Partial<Pick<ServerState, 'profileId' | 'port' | 'basePath'>> = {}
): Pick<ServerState, 'status' | 'profileId' | 'port' | 'basePath'> => ({
  status,
  profileId: null,
  port: null,
  basePath: null,
  ...over
});

describe('testAddressSource', () => {
  it('is the open profile’s port and base path while nothing runs', () => {
    for (const status of ['stopped', 'crashed'] as const) {
      expect(testAddressSource(server(status), B, profiles)).toEqual({ port: 4800, basePath: '' });
    }
  });

  it('is the open profile’s even when another profile’s server stopped unexpectedly', () => {
    expect(testAddressSource(server('crashed', { profileId: 'a', port: 4799 }), B, profiles)).toEqual({
      port: 4800,
      basePath: ''
    });
  });

  // Review Focus 1: another profile's server is the one tests can connect to.
  it.each(['starting', 'running', 'stopping'] as const)('is the active profile’s while its server is %s', (status) => {
    expect(testAddressSource(server(status, { profileId: 'a', port: 4799 }), B, profiles)).toEqual({
      port: 4799,
      basePath: '/wd/hub'
    });
  });

  it('uses the port the server runs on, which may not be the profile’s port any more', () => {
    const edited = profile('a', 4801, '/wd/hub');
    expect(testAddressSource(server('running', { profileId: 'a', port: 4799 }), edited, [edited, B])).toEqual({
      port: 4799,
      basePath: '/wd/hub'
    });
  });

  // The open profile's base path is being edited while its server runs: the server still serves
  // the one it was started with, and that is where tests must connect.
  it('uses the base path the server was started with, not the one being edited', () => {
    const edited = profile('a', 4799, '/edited');
    expect(
      testAddressSource(server('running', { profileId: 'a', port: 4799, basePath: '/wd/hub' }), edited, [edited, B])
    ).toEqual({ port: 4799, basePath: '/wd/hub' });
    // An empty base path at launch is a base path too: the root.
    expect(
      testAddressSource(server('running', { profileId: 'a', port: 4799, basePath: '' }), edited, [edited, B])
    ).toEqual({ port: 4799, basePath: '' });
  });

  it('uses the profile’s base path while the server has not said its own', () => {
    expect(testAddressSource(server('running', { profileId: 'a', port: 4799, basePath: null }), A, profiles)).toEqual({
      port: 4799,
      basePath: '/wd/hub'
    });
  });

  it('uses the profile’s port while the server has not said its own', () => {
    expect(testAddressSource(server('starting', { profileId: 'a', port: null }), A, profiles)).toEqual({
      port: 4799,
      basePath: '/wd/hub'
    });
  });

  // The server says the port and base path it was started with, so a removed profile's server
  // still has its address.
  it('is the server’s own port and base path when its profile was removed', () => {
    expect(
      testAddressSource(server('running', { profileId: 'gone', port: 4799, basePath: '/wd/hub' }), A, profiles)
    ).toEqual({ port: 4799, basePath: '/wd/hub' });
    expect(
      testAddressSource(server('running', { profileId: null, port: 4801, basePath: '' }), A, profiles)
    ).toEqual({ port: 4801, basePath: '' });
  });

  it('is nothing for a removed profile’s server that has not said its port and base path', () => {
    expect(testAddressSource(server('running', { profileId: 'gone', port: 4799 }), A, profiles)).toBeNull();
    expect(testAddressSource(server('running', { profileId: null, basePath: '/wd/hub' }), A, profiles)).toBeNull();
  });

  it('is nothing with no profile open and nothing running', () => {
    expect(testAddressSource(server('stopped'), null, [])).toBeNull();
  });
});

describe('shownColleaguesAddress', () => {
  it('is the address when the Mac has a name on the network', () => {
    expect(shownColleaguesAddress('http://lab-mac.local:4723/wd/hub')).toBe('http://lab-mac.local:4723/wd/hub');
    expect(shownColleaguesAddress('http://lab-mac.local:4723')).toBe('http://lab-mac.local:4723');
  });

  // The Mac's name resolved to nothing: ".local" alone names no Mac.
  it('is null when the name before .local is empty', () => {
    expect(shownColleaguesAddress('http://.local:4723/wd/hub')).toBeNull();
    expect(shownColleaguesAddress('http://.local:4723')).toBeNull();
  });

  it('is null for something that is not an address', () => {
    expect(shownColleaguesAddress('')).toBeNull();
    expect(shownColleaguesAddress('http:// .local:4723')).toBeNull();
  });
});
