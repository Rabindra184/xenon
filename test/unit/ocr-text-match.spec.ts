import { expect } from 'chai';
import { OcrWordBox, findText, wordRuns } from '../../src/services/omni-vision/ocrTextMatch';

describe('ocrTextMatch', () => {
  const word = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90) =>
    ({ text, x0, y0, x1, y1, confidence }) as OcrWordBox;

  it('groups words into lines and runs, in reading order, despite a slightly uneven baseline', () => {
    const runs = wordRuns([
      word('Done', 900, 40, 980, 70),
      word('in', 158, 202, 180, 226),
      word('Cancel', 20, 42, 120, 70),
      word('Sign', 100, 200, 150, 224),
    ]);
    expect(runs.map((r) => r.map((w) => w.text))).to.deep.equal([
      ['Cancel'],
      ['Done'],
      ['Sign', 'in'],
    ]);
  });

  it('finds every occurrence, once per set of words, with the lowest confidence of the words', () => {
    const words = [
      word('Add', 10, 10, 50, 30, 95),
      word('to', 56, 10, 70, 30, 70),
      word('cart', 76, 10, 120, 30, 88),
      word('Add', 10, 100, 50, 120),
      word('to', 56, 100, 70, 120),
      word('cart', 76, 100, 120, 120),
    ];
    const found = findText(words, '  add   TO cart ');
    expect(found.map((m) => [m.text, m.y0, m.confidence])).to.deep.equal([
      ['Add to cart', 10, 70],
      ['Add to cart', 100, 90],
    ]);
    expect(found[0]).to.include({ x0: 10, x1: 120, y1: 30 });
  });

  it('matches a one-word text inside a word once, however often it appears there', () => {
    expect(findText([word('banana', 0, 0, 60, 20)], 'an').map((m) => m.text)).to.deep.equal([
      'banana',
    ]);
  });

  it('matches nothing for an empty text', () => {
    expect(findText([word('Sign', 0, 0, 40, 20)], '   ')).to.deep.equal([]);
  });
});
