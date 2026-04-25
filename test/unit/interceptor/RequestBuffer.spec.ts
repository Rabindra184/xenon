import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RequestBuffer } from '../../../src/services/interceptor/RequestBuffer';
import { CapturedRequest } from '../../../src/services/interceptor/types';

const sample = (overrides: Partial<CapturedRequest> = {}): CapturedRequest => ({
  id: 'r1',
  sessionId: 's1',
  ts: Date.now(),
  method: 'GET',
  url: 'https://api.example.com/x',
  host: 'api.example.com',
  path: '/x',
  reqHeaders: {},
  resStatus: 200,
  resHeaders: {},
  resBody: 'ok',
  durationMs: 1,
  mocked: false,
  modified: false,
  ...overrides,
});

describe('RequestBuffer', () => {
  let spillDir: string;
  beforeEach(() => {
    spillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-buffer-'));
  });
  afterEach(() => {
    try {
      fs.rmSync(spillDir, { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  });

  it('returns empty list when nothing has been pushed', () => {
    const buf = new RequestBuffer({ capacity: 10, bodySpillThreshold: 1024, spillDir });
    expect(buf.list()).to.have.length(0);
  });

  it('stores entries up to capacity', () => {
    const buf = new RequestBuffer({ capacity: 3, bodySpillThreshold: 1024, spillDir });
    buf.push(sample({ id: 'a' }));
    buf.push(sample({ id: 'b' }));
    buf.push(sample({ id: 'c' }));
    const all = buf.list();
    expect(all.map((e: CapturedRequest) => e.id)).to.deep.equal(['a', 'b', 'c']);
  });

  it('evicts the oldest entry when capacity is exceeded', () => {
    const buf = new RequestBuffer({ capacity: 2, bodySpillThreshold: 1024, spillDir });
    buf.push(sample({ id: 'a' }));
    buf.push(sample({ id: 'b' }));
    buf.push(sample({ id: 'c' }));
    expect(buf.list().map((e: CapturedRequest) => e.id)).to.deep.equal(['b', 'c']);
  });

  it('keeps small bodies inline (below spill threshold)', () => {
    const buf = new RequestBuffer({ capacity: 10, bodySpillThreshold: 100, spillDir });
    buf.push(sample({ id: 'a', resBody: 'short' }));
    const entry = buf.list()[0];
    expect(entry.resBody).to.equal('short');
    expect(entry.bodyPath).to.equal(undefined);
  });

  it('spills bodies above threshold to disk and clears resBody', () => {
    const buf = new RequestBuffer({ capacity: 10, bodySpillThreshold: 10, spillDir });
    const big = 'x'.repeat(50);
    buf.push(sample({ id: 'a', resBody: big }));
    const entry = buf.list()[0];
    expect(entry.resBody).to.equal(null);
    expect(entry.bodyPath).to.be.a('string');
    const written = fs.readFileSync(entry.bodyPath!, 'utf8');
    expect(written).to.equal(big);
  });

  it('finds a single entry by id', () => {
    const buf = new RequestBuffer({ capacity: 10, bodySpillThreshold: 1024, spillDir });
    buf.push(sample({ id: 'a' }));
    buf.push(sample({ id: 'b' }));
    const found = buf.get('b');
    expect(found?.id).to.equal('b');
    expect(buf.get('missing')).to.equal(undefined);
  });

  it('clears spill files when buffer is cleared', () => {
    const buf = new RequestBuffer({ capacity: 10, bodySpillThreshold: 4, spillDir });
    buf.push(sample({ id: 'a', resBody: 'longer-than-threshold' }));
    const spill = buf.list()[0].bodyPath!;
    expect(fs.existsSync(spill)).to.equal(true);
    buf.clear();
    expect(fs.existsSync(spill)).to.equal(false);
    expect(buf.list()).to.have.length(0);
  });

  it('removes spill file when entry is evicted by capacity', () => {
    const buf = new RequestBuffer({ capacity: 1, bodySpillThreshold: 4, spillDir });
    buf.push(sample({ id: 'a', resBody: 'longer-than-threshold' }));
    const spill = buf.list()[0].bodyPath!;
    expect(fs.existsSync(spill)).to.equal(true);
    buf.push(sample({ id: 'b', resBody: 'short' }));
    expect(fs.existsSync(spill)).to.equal(false);
  });
});
