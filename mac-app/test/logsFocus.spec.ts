import { describe, expect, it } from 'vitest';
import { logsFocusAfter, type LogsFocus } from '../src/renderer/src/logsFocus';

// Where Home's "See what happened" sends Logs, and what ends it (R60, R67, minors 5 and 10).
describe('logsFocusAfter', () => {
  const at = (lineId: number | null): LogsFocus => ({ lineId });

  it('See what happened goes to the crash’s line, by its id', () => {
    expect(logsFocusAfter(null, { type: 'see-what-happened', crashLine: { id: 42, text: 'Error: boom' } })).toEqual(at(42));
  });

  it('See what happened with no line still says Logs was sent there, with no line to go to (minor 5)', () => {
    expect(logsFocusAfter(null, { type: 'see-what-happened', crashLine: null })).toEqual(at(null));
  });

  it('is a fresh object each time, so a second See what happened to the same line jumps again', () => {
    const first = logsFocusAfter(null, { type: 'see-what-happened', crashLine: { id: 42, text: 'x' } });
    const second = logsFocusAfter(first, { type: 'see-what-happened', crashLine: { id: 42, text: 'x' } });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('ends when the server starts again (minor 10)', () => {
    expect(logsFocusAfter(at(42), { type: 'status', status: 'starting' })).toBeNull();
    expect(logsFocusAfter(at(null), { type: 'status', status: 'starting' })).toBeNull();
  });

  it('lasts through every other status', () => {
    const focus = at(42);
    for (const status of ['running', 'stopping', 'stopped', 'crashed'] as const) {
      expect(logsFocusAfter(focus, { type: 'status', status }), status).toBe(focus);
    }
  });

  it('ends when the person leaves Logs, and lasts while Logs is open (R60)', () => {
    const focus = at(42);
    expect(logsFocusAfter(focus, { type: 'place', place: 'logs' })).toBe(focus);
    for (const place of ['home', 'setup', 'settings'] as const) {
      expect(logsFocusAfter(focus, { type: 'place', place }), place).toBeNull();
    }
  });

  it('ends when the person changes Show, searches or clears (R60)', () => {
    expect(logsFocusAfter(at(42), { type: 'end' })).toBeNull();
  });
});
