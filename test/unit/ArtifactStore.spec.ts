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

  it('refuses path traversal outside the root', () => {
    const store = new FsArtifactStore(root);
    expect(() => store.resolve('..', 'etc', 'passwd')).to.throw(/outside/);
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
