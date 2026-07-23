import { describe, it, expect } from 'vitest';
import { pickStreamPlayer } from './pickStreamPlayer';

describe('pickStreamPlayer', () => {
  it('uses h264 only for Android + backend h264 + WebCodecs present', () => {
    expect(pickStreamPlayer('android', 'h264', true)).toBe('h264');
    expect(pickStreamPlayer('androidtv', 'h264', true)).toBe('h264');
  });
  it('falls back to mjpeg without WebCodecs', () => {
    expect(pickStreamPlayer('android', 'h264', false)).toBe('mjpeg');
  });
  it('falls back to mjpeg when the backend advertises mjpeg or nothing', () => {
    expect(pickStreamPlayer('android', 'mjpeg', true)).toBe('mjpeg');
    expect(pickStreamPlayer('android', undefined, true)).toBe('mjpeg');
  });
  it('iOS always uses mjpeg', () => {
    expect(pickStreamPlayer('ios', 'h264', true)).toBe('mjpeg');
    expect(pickStreamPlayer('tvos', 'h264', true)).toBe('mjpeg');
  });
});
