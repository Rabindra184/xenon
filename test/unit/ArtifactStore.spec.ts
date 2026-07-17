import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FsArtifactStore } from '../../src/services/artifacts/ArtifactStore';

describe('FsArtifactStore', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-art-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('resolve() is byte-identical to legacy path concatenation', () => {
    const store = new FsArtifactStore(root);
    const legacy = path.join(root, '_groups', 'g1', 'composite.mp4');
    expect(store.resolve('_groups', 'g1', 'composite.mp4')).to.equal(legacy);
  });

  it('resolve() stays byte-identical (relative, NOT absolutized) under a relative root', () => {
    // config.recordingsAssetsPath is overridable via XENON_RECORDINGS_ASSETS_PATH
    // with no absolute-path validation. Legacy code was path.join, which keeps a
    // relative root relative; path.resolve would silently absolutize it and flip
    // every persisted filePath relative→absolute. Byte-identical means path.join.
    const store = new FsArtifactStore('rel/root');
    const legacy = path.join('rel/root', '_groups', 'g1', 'composite.mp4');
    expect(store.resolve('_groups', 'g1', 'composite.mp4')).to.equal(legacy);
  });

  it('resolve() with no segments returns the root and does not throw', () => {
    const store = new FsArtifactStore(root);
    expect(store.resolve()).to.equal(root);
  });

  it('refuses path traversal outside the root', () => {
    const store = new FsArtifactStore(root);
    expect(() => store.resolve('..', 'etc', 'passwd')).to.throw(/escapes store root/);
  });

  it('ensureDir creates nested directories and returns the absolute path', async () => {
    const store = new FsArtifactStore(root);
    const dir = await store.ensureDir('_groups', 'g2');
    expect(fs.statSync(dir).isDirectory()).to.equal(true);
  });

  it('exists() reflects the filesystem', async () => {
    const store = new FsArtifactStore(root);
    expect(await store.exists('nope.mp4')).to.equal(false);
    fs.writeFileSync(path.join(root, 'yes.mp4'), 'x');
    expect(await store.exists('yes.mp4')).to.equal(true);
  });
});
