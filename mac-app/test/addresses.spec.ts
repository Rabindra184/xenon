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
  over: Partial<Pick<ServerState, 'profileId' | 'port'>> = {}
): Pick<ServerState, 'status' | 'profileId' | 'port'> => ({ status, profileId: null, port: null, ...over });

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

  it('uses the profile’s port while the server has not said its own', () => {
    expect(testAddressSource(server('starting', { profileId: 'a', port: null }), A, profiles)).toEqual({
      port: 4799,
      basePath: '/wd/hub'
    });
  });

  it('is nothing for a server whose profile was removed: its base path is gone with it', () => {
    expect(testAddressSource(server('running', { profileId: 'gone', port: 4799 }), A, profiles)).toBeNull();
    expect(testAddressSource(server('running', { profileId: null, port: 4799 }), A, profiles)).toBeNull();
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
