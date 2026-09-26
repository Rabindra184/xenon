import { describe, expect, it } from 'vitest';
import { pointerToDevice } from './tileInput';

// Measured live 2026-09-26: a Galaxy S9+ (1080x2220) tile in the 3x2 layout.
// The tap layer is 157.7x415, but the 704x1440 picture inside it is only
// 322.5 tall, starting 46 px down. Mapping against the layer sent a tap at the
// picture's top 5% to y=334 instead of y=111, and the bottom 5% to 1886 not 2109.
const rect = { left: 354, top: 128, width: 157.7, height: 415 };
const aspect = 704 / 1440;
const picTop = rect.top + (rect.height - rect.width / aspect) / 2;
const picH = rect.width / aspect;
const at = (fy: number) => picTop + fy * picH;

describe('pointerToDevice', () => {
  it('maps against the video picture, not the letterboxed tile', () => {
    const x = rect.left + rect.width / 2;
    expect(pointerToDevice(x, at(0.05), rect, 1080, 2220, aspect)).toEqual({ x: 540, y: 111 });
    expect(pointerToDevice(x, at(0.5), rect, 1080, 2220, aspect)).toEqual({ x: 540, y: 1110 });
    expect(pointerToDevice(x, at(0.95), rect, 1080, 2220, aspect)).toEqual({ x: 540, y: 2109 });
  });

  it('ignores a press on the black bars around the picture', () => {
    const x = rect.left + rect.width / 2;
    expect(pointerToDevice(x, rect.top + 10, rect, 1080, 2220, aspect)).toBe(null);
    expect(pointerToDevice(x, rect.top + rect.height - 10, rect, 1080, 2220, aspect)).toBe(null);
  });

  it('clamps to the screen edge when asked (the end of a swipe)', () => {
    const x = rect.left + rect.width / 2;
    expect(pointerToDevice(x, rect.top + 10, rect, 1080, 2220, aspect, true)).toEqual({
      x: 540,
      y: 0,
    });
  });

  it('uses the whole tile when the picture shape is not known yet', () => {
    expect(
      pointerToDevice(rect.left + rect.width / 2, rect.top + rect.height / 4, rect, 1080, 2220),
    ).toEqual({ x: 540, y: 555 });
  });
});
