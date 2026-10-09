import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LastRunStore } from '../src/main/LastRunStore';

// electron-store needs Electron to find the userData folder. Its base class,
// conf, does the real reading and writing, so the store runs on that, in a
// throwaway folder, with the options LastRunStore passes.
const folder = vi.hoisted(() => ({ path: '' }));

vi.mock('electron-store', async () => {
  const { default: Conf } = await vi.importActual<{ default: new (options: object) => object }>('conf');
  return {
    default: class extends Conf {
      constructor(options: { name?: string }) {
        super({ ...options, configName: options.name, cwd: folder.path, projectVersion: '0.0.0' });
      }
    }
  };
});

describe('LastRunStore', () => {
  beforeEach(() => {
    folder.path = mkdtempSync(join(tmpdir(), 'xenon-lastruns-'));
  });

  afterEach(() => {
    rmSync(folder.path, { recursive: true, force: true });
  });

  const file = () => join(folder.path, 'last-runs.json');

  it('has no run for a profile that never ran', () => {
    expect(new LastRunStore().get('p1')).toBeNull();
  });

  it('saves a run and reads it back, also from a new store (the next launch)', () => {
    new LastRunStore().set('p1', { endedAt: 5, how: 'crashed', reason: 'Appium exited with code 1' });
    expect(new LastRunStore().get('p1')).toEqual({ endedAt: 5, how: 'crashed', reason: 'Appium exited with code 1' });
  });

  it('keeps one run per profile, the latest, and keeps profiles apart', () => {
    const store = new LastRunStore();
    store.set('p1', { endedAt: 1, how: 'crashed', reason: 'x' });
    store.set('p2', { endedAt: 2, how: 'stopped' });
    store.set('p1', { endedAt: 3, how: 'stopped' });
    expect(store.get('p1')).toEqual({ endedAt: 3, how: 'stopped' });
    expect(store.get('p2')).toEqual({ endedAt: 2, how: 'stopped' });
  });

  it('keys the file by profile id', () => {
    new LastRunStore().set('p1', { endedAt: 5, how: 'stopped' });
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ p1: { endedAt: 5, how: 'stopped' } });
  });

  it('holds an id with dots in it as one key', () => {
    const store = new LastRunStore();
    store.set('a.b.c', { endedAt: 5, how: 'stopped' });
    expect(store.get('a.b.c')).toEqual({ endedAt: 5, how: 'stopped' });
    expect(store.get('a')).toBeNull();
  });

  it('answers null for names every object has', () => {
    const store = new LastRunStore();
    store.set('p1', { endedAt: 5, how: 'stopped' });
    for (const id of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) expect(store.get(id)).toBeNull();
  });

  it('forgets a profile', () => {
    const store = new LastRunStore();
    store.set('p1', { endedAt: 1, how: 'stopped' });
    store.set('p2', { endedAt: 2, how: 'stopped' });
    store.forget('p1');
    expect(store.get('p1')).toBeNull();
    expect(store.get('p2')).toEqual({ endedAt: 2, how: 'stopped' });
    store.forget('never-there');
  });

  it('reads a damaged entry as no run, and keeps the good ones', () => {
    writeFileSync(
      file(),
      JSON.stringify({ bad: { endedAt: 'x', how: 'stopped' }, worse: 7, good: { endedAt: 4, how: 'stopped' } })
    );
    const store = new LastRunStore();
    expect(store.get('bad')).toBeNull();
    expect(store.get('worse')).toBeNull();
    expect(store.get('good')).toEqual({ endedAt: 4, how: 'stopped' });
    store.set('other', { endedAt: 6, how: 'stopped' });
    expect(store.get('good')).toEqual({ endedAt: 4, how: 'stopped' });
  });

  it('opens with a file that is not valid JSON, reading it as empty', () => {
    writeFileSync(file(), '{ not json');
    const store = new LastRunStore();
    expect(store.get('p1')).toBeNull();
    store.set('p1', { endedAt: 5, how: 'stopped' });
    expect(new LastRunStore().get('p1')).toEqual({ endedAt: 5, how: 'stopped' });
  });
});
