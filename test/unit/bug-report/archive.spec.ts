import { expect } from 'chai';
import { PassThrough } from 'stream';
import * as unzipper from 'unzipper';
import { streamBundleToZip } from '../../../src/services/bug-report/archive';
import { BundleEntry } from '../../../src/services/bug-report/BugReportService';

describe('streamBundleToZip', () => {
  it('writes all entries into a valid zip', async () => {
    const entries: BundleEntry[] = [
      { name: 'a.txt', source: { kind: 'buffer', data: Buffer.from('hello') } },
      { name: 'b.json', source: { kind: 'buffer', data: Buffer.from('{"ok":true}') } },
    ];
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (c) => chunks.push(c));
    const sinkClosed = new Promise<void>((resolve) => sink.on('end', () => resolve()));

    await streamBundleToZip(entries, sink);
    sink.end();
    await sinkClosed;
    const buf = Buffer.concat(chunks);

    const dir = await unzipper.Open.buffer(buf);
    const names = dir.files.map((f) => f.path).sort();
    expect(names).to.deep.equal(['a.txt', 'b.json']);
  });
});
