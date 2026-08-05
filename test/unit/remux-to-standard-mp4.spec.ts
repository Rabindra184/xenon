import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { remuxToStandardMp4 } from '../../src/services/VideoPipelineService';

describe('remuxToStandardMp4', () => {
  it('no-ops when the file is missing', async () => {
    await remuxToStandardMp4(path.join(os.tmpdir(), `missing-${Date.now()}.mp4`));
  });

  it('no-ops when the file is tinier than a playable mp4', async () => {
    const p = path.join(os.tmpdir(), `tiny-rec-${Date.now()}.mp4`);
    fs.writeFileSync(p, Buffer.alloc(64));
    await remuxToStandardMp4(p);
    expect(fs.statSync(p).size).to.equal(64);
    fs.unlinkSync(p);
  });
});
