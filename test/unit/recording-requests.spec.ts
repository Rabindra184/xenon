import { expect } from 'chai';
import { parseClearBody, parseLibraryQuery } from '../../src/app/routers/recordingRequests';

describe('parseClearBody', () => {
  it('accepts a finite, non-negative timecode', () => {
    expect(parseClearBody({ timecodeMs: 1234 })).to.deep.equal({ ok: true, timecodeMs: 1234 });
    expect(parseClearBody({ timecodeMs: 0 })).to.deep.equal({ ok: true, timecodeMs: 0 });
  });

  it('rounds a fractional timecode to whole ms (the column is INTEGER)', () => {
    expect(parseClearBody({ timecodeMs: 12.6 })).to.deep.equal({ ok: true, timecodeMs: 13 });
  });

  const bad: unknown[] = [
    undefined,
    null,
    {},
    { timecodeMs: '5' },
    { timecodeMs: -1 },
    { timecodeMs: Infinity },
    { timecodeMs: NaN },
  ];
  for (const body of bad) {
    it(`rejects ${String(JSON.stringify(body))}`, () => {
      expect(parseClearBody(body).ok).to.equal(false);
    });
  }
});

describe('parseLibraryQuery', () => {
  it('reads the filters and a bounded limit', () => {
    const out = parseLibraryQuery({
      limit: '10',
      cursor: 'c',
      udid: 'U1',
      startedBy: 'unknown',
      since: '2026-09-20T00:00:00Z',
      q: ' pay ',
    });
    expect(out).to.deep.equal({
      ok: true,
      limit: 10,
      cursor: 'c',
      filter: {
        udid: 'U1',
        startedBy: 'unknown',
        since: Date.parse('2026-09-20T00:00:00Z'),
        q: 'pay',
      },
    });
    expect((parseLibraryQuery({}) as any).limit).to.equal(50);
    expect((parseLibraryQuery({ limit: '999' }) as any).limit).to.equal(200);
  });

  it('refuses a bad limit or time', () => {
    expect(parseLibraryQuery({ limit: '0' })).to.deep.equal({
      ok: false,
      error: 'limit must be a whole number from 1',
    });
    expect(parseLibraryQuery({ limit: 'x' })).to.deep.equal({
      ok: false,
      error: 'limit must be a whole number from 1',
    });
    expect(parseLibraryQuery({ since: 'yesterday' })).to.deep.equal({
      ok: false,
      error: 'since must be an ISO time',
    });
  });
});
