import { expect } from 'chai';
import { parseClearBody } from '../../src/app/routers/recordingRequests';

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
