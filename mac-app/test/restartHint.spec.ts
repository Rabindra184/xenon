import { describe, expect, it } from 'vitest';
import { restartNeeded, serverRunsFor } from '../src/renderer/src/restartHint';
import { SETTINGS } from '../src/renderer/src/copy/settings';
import { makeDefaultProfile } from '../src/shared/profileDefaults';
import type { Profile, ServerState, ServerStatus } from '../src/shared/types';

// What a running server was started with stays until the next start: base path,
// port and Appium folder edited since apply then, and Settings says so.

const profile = (server: Partial<Profile['server']> = {}, id = 'a'): Profile => {
  const base = makeDefaultProfile({ id, now: 0 });
  return { ...base, server: { ...base.server, ...server } };
};

const launchedWith = (status: ServerStatus, over: Partial<ServerState> = {}): ServerState => ({
  status,
  profileId: 'a',
  pid: 1,
  port: 4723,
  basePath: '/wd/hub',
  appiumHome: '',
  dashboardUrl: null,
  startedAt: 0,
  logFile: null,
  exitCode: null,
  exitSignal: null,
  lastError: null,
  ...over
});

describe('restartNeeded', () => {
  it('is empty while the running server has the profile’s values', () => {
    expect(restartNeeded(launchedWith('running'), profile())).toEqual([]);
    expect(restartNeeded(launchedWith('starting'), profile())).toEqual([]);
  });

  it('names each of base path, port and Appium folder edited since the start', () => {
    expect(restartNeeded(launchedWith('running'), profile({ port: 4799 }))).toEqual(['server.port']);
    expect(restartNeeded(launchedWith('running'), profile({ basePath: '/' }))).toEqual(['server.basePath']);
    expect(restartNeeded(launchedWith('running'), profile({ appiumHome: '/tmp/home' }))).toEqual(['server.appiumHome']);
    expect(
      restartNeeded(launchedWith('starting'), profile({ port: 4799, basePath: '/', appiumHome: '/tmp/home' }))
    ).toEqual(['server.basePath', 'server.port', 'server.appiumHome']);
  });

  it('goes again when the value is put back as it was started', () => {
    expect(restartNeeded(launchedWith('running', { port: 4799 }), profile({ port: 4799 }))).toEqual([]);
  });

  it('is empty when the server is not running or starting', () => {
    for (const status of ['stopped', 'stopping', 'crashed'] as const) {
      expect(restartNeeded(launchedWith(status), profile({ port: 4799, basePath: '/' })), status).toEqual([]);
    }
  });

  it('is empty when the running server is another profile’s', () => {
    expect(restartNeeded(launchedWith('running', { profileId: 'b' }), profile({ port: 4799 }))).toEqual([]);
  });

  it('says nothing about a value the server did not report', () => {
    expect(
      restartNeeded(launchedWith('running', { port: null, basePath: null, appiumHome: null }), profile({ port: 4799, basePath: '/', appiumHome: '/x' }))
    ).toEqual([]);
  });
});

describe('serverRunsFor (the Settings-level restart line)', () => {
  const profile = { id: 'p1', server: { port: 4799, basePath: '/wd/hub', appiumHome: '' } } as unknown as Profile;
  const state = (status: ServerState['status'], profileId: string | null = 'p1') =>
    ({ status, profileId, port: 4799, basePath: '/wd/hub', appiumHome: '' }) as unknown as ServerState;

  it('is true while this profile’s server starts or runs', () => {
    expect(serverRunsFor(state('starting'), profile)).toBe(true);
    expect(serverRunsFor(state('running'), profile)).toBe(true);
  });

  it('is false for a stopped, stopping or crashed server, and for another profile’s', () => {
    for (const status of ['stopped', 'stopping', 'crashed'] as const) expect(serverRunsFor(state(status), profile)).toBe(false);
    expect(serverRunsFor(state('running', 'p2'), profile)).toBe(false);
    expect(serverRunsFor(state('running', null), profile)).toBe(false);
  });
});

describe('the Settings-level restart line', () => {
  it('says so in the ruling’s words', () => {
    expect(SETTINGS.screen.serverRunning).toBe('The server is running. Restart it to use changes.');
  });
});

