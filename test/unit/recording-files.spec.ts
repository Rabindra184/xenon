import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recordingDirOf, removeRecordingFiles } from '../../src/services/recording/recordingFiles';

describe('recording file removal', () => {
  let base: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-files-'));
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  const make = (...parts: string[]) => {
    const p = path.join(base, ...parts);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
    return p;
  };

  it('finds a recording’s directory from its video path', () => {
    expect(recordingDirOf(path.join(base, 'abc', 'video', 'abc.mp4'))).to.equal(
      path.join(base, 'abc'),
    );
  });

  it('removes each phone’s directory and the group’s composite directory', () => {
    const v1 = make('r1', 'video', 'r1.mp4');
    make('r1', 'annotations', 'a.png');
    make('r1', 'timing.json');
    const v2 = make('r2', 'video', 'r2.mp4');
    make('_groups', 'g1', 'composite.mp4');
    const keep = make('r3', 'video', 'r3.mp4');
    const removed = removeRecordingFiles([v1, v2], path.join(base, '_groups', 'g1'), base);
    expect(removed.sort()).to.deep.equal(
      [path.join(base, 'r1'), path.join(base, 'r2'), path.join(base, '_groups', 'g1')].sort(),
    );
    expect(fs.existsSync(path.join(base, 'r1'))).to.equal(false);
    expect(fs.existsSync(path.join(base, '_groups', 'g1'))).to.equal(false);
    expect(fs.existsSync(keep)).to.equal(true);
    expect(fs.existsSync(path.join(base, '_groups'))).to.equal(true);
  });

  it('leaves the composite directory alone without a group directory', () => {
    const v1 = make('r1', 'video', 'r1.mp4');
    const composite = make('_groups', 'g1', 'composite.mp4');
    const removed = removeRecordingFiles([v1], null, base);
    expect(removed).to.deep.equal([path.join(base, 'r1')]);
    expect(fs.existsSync(composite)).to.equal(true);
  });

  it('refuses anything outside the recordings tree, the tree itself and _groups itself', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-outside-'));
    try {
      make('_groups', 'other', 'composite.mp4');
      const removed = removeRecordingFiles(
        ['/tmp/r.mp4', path.join(outside, 'video', 'x.mp4'), path.join(base, 'video', 'y.mp4')],
        path.join(base, '_groups'),
        base,
      );
      expect(removed).to.deep.equal([]);
      expect(fs.existsSync(outside)).to.equal(true);
      expect(fs.existsSync(path.join(base, '_groups', 'other'))).to.equal(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('skips directories that are already gone', () => {
    expect(
      removeRecordingFiles(
        [path.join(base, 'nope', 'video', 'n.mp4')],
        path.join(base, '_groups', 'g9'),
        base,
      ),
    ).to.deep.equal([]);
  });
});
