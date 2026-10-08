import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLaunchConfigs, removeLaunchConfig } from '../src/main/launchConfigs';

// Config files an older version wrote can hold a proxy password or a cloud key (fake ones here).
let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xenon-launch-configs-'));
  dir = join(root, 'launch-configs');
  mkdirSync(dir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('clearLaunchConfigs', () => {
  it('deletes every config file, and nothing else', () => {
    writeFileSync(join(dir, 'a.yaml'), 'proxy: { auth: { password: p-test-1 } }');
    writeFileSync(join(dir, 'b.yaml'), 'cloud: { apiKey: k-test-123 }');
    writeFileSync(join(dir, 'notes.txt'), 'kept');
    mkdirSync(join(dir, 'sub'));
    const onError = vi.fn();
    clearLaunchConfigs(dir, onError);
    expect(readdirSync(dir).sort()).toEqual(['notes.txt', 'sub']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('says nothing when the folder is not there yet', () => {
    const onError = vi.fn();
    clearLaunchConfigs(join(root, 'missing'), onError);
    expect(onError).not.toHaveBeenCalled();
  });

  it('leaves a folder named like a config file', () => {
    mkdirSync(join(dir, 'odd.yaml'));
    const onError = vi.fn();
    clearLaunchConfigs(dir, onError);
    expect(existsSync(join(dir, 'odd.yaml'))).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports each file it cannot delete, and carries on', () => {
    writeFileSync(join(dir, 'a.yaml'), 'x');
    writeFileSync(join(dir, 'b.yaml'), 'x');
    chmodSync(dir, 0o500); // the folder's entries can't be removed
    const onError = vi.fn();
    try {
      clearLaunchConfigs(dir, onError);
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('reports a folder it cannot read', () => {
    writeFileSync(join(root, 'file-not-folder'), 'x');
    const onError = vi.fn();
    clearLaunchConfigs(join(root, 'file-not-folder'), onError);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('removeLaunchConfig', () => {
  it('deletes the profile’s config file and no other', () => {
    writeFileSync(join(dir, 'p1.yaml'), 'x');
    writeFileSync(join(dir, 'p2.yaml'), 'x');
    const onError = vi.fn();
    removeLaunchConfig(dir, 'p1', onError);
    expect(readdirSync(dir)).toEqual(['p2.yaml']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('says nothing when the profile never launched', () => {
    const onError = vi.fn();
    removeLaunchConfig(dir, 'never', onError);
    expect(onError).not.toHaveBeenCalled();
  });

  it('deletes nothing outside the folder, whatever the id', () => {
    writeFileSync(join(root, 'outside.yaml'), 'x');
    const onError = vi.fn();
    removeLaunchConfig(dir, '../outside', onError);
    expect(existsSync(join(root, 'outside.yaml'))).toBe(true);
  });

  it('reports a file it cannot delete', () => {
    writeFileSync(join(dir, 'p3.yaml'), 'x');
    chmodSync(dir, 0o500);
    const onError = vi.fn();
    try {
      removeLaunchConfig(dir, 'p3', onError);
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
