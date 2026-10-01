import { describe, it, expect } from 'vitest';
import {
  commandStats,
  healedCommands,
  commandErrorMessage,
  timelineLayout,
  screenshotsOf,
  formatCommandDuration,
  isFailedCommand,
} from './commands';

// Rows as GET /session/:id/session_log returns them: newest first.
const at = (s: number) => new Date(Date.UTC(2026, 8, 30, 20, 41, s)).toISOString();
const log = (over: Record<string, unknown>) => ({
  id: String(over.id ?? Math.random()),
  command_name: 'findElement',
  title: 'Find Element',
  is_success: true,
  is_error: false,
  is_healed: false,
  duration: 100,
  screenshot: null,
  createdAt: at(0),
  ...over,
});

describe('isFailedCommand', () => {
  it('is a command whose response was an error', () => {
    expect(isFailedCommand(log({ is_success: false }))).toBe(true);
    expect(isFailedCommand(log({ is_error: true }))).toBe(true);
    expect(isFailedCommand(log({}))).toBe(false);
  });
});

describe('commandStats', () => {
  const logs = [
    log({
      id: 'c',
      command_name: 'click',
      duration: 320,
      is_healed: true,
      healing_tier: 'OCR',
      screenshot: 's/screenshots/c.png',
      createdAt: at(3),
    }),
    log({
      id: 'b',
      command_name: 'findElement',
      duration: 8400,
      is_success: false,
      is_error: true,
      createdAt: at(2),
    }),
    log({
      id: 'a',
      command_name: 'getPageSource',
      duration: 1100,
      is_healed: true,
      healing_tier: 'Fuzzy XML',
      createdAt: at(1),
    }),
  ];

  it('counts commands, failures and heals, and finds the slowest', () => {
    expect(commandStats(logs)).toEqual({
      total: 3,
      failed: 1,
      healed: 2,
      // In the order they happened: the oldest row is last in the list.
      healedTiers: ['Fuzzy XML', 'OCR'],
      slowest: { name: 'findElement', ms: 8400 },
      screenshots: 1,
    });
  });

  it('has no slowest command without durations', () => {
    expect(commandStats([log({ duration: null })]).slowest).toBe(null);
    expect(commandStats([])).toEqual({
      total: 0,
      failed: 0,
      healed: 0,
      healedTiers: [],
      slowest: null,
      screenshots: 0,
    });
  });
});

describe('healedCommands', () => {
  it('lists each heal, oldest first, with what it healed to', () => {
    const logs = [
      log({
        id: 'late',
        command_name: 'findElement',
        is_healed: true,
        original_strategy: 'id',
        original_selector: 'checkout_confirm',
        healed_strategy: 'xpath',
        healed_selector: '//Button[@text="Confirm"]',
        healing_tier: 'Fuzzy XML',
        healing_confidence: 0.874,
        createdAt: at(30),
      }),
      log({ id: 'plain', createdAt: at(20) }),
      log({
        id: 'early',
        is_healed: true,
        original_selector: 'pay',
        healed_selector: 'pay_button',
        healing_tier: null,
        healing_confidence: null,
        createdAt: at(10),
      }),
    ];
    expect(healedCommands(logs)).toEqual([
      {
        id: 'early',
        command: 'findElement',
        original: 'pay',
        healed: 'pay_button',
        tier: null,
        confidence: null,
        at: at(10),
      },
      {
        id: 'late',
        command: 'findElement',
        original: 'id=checkout_confirm',
        healed: 'xpath=//Button[@text="Confirm"]',
        tier: 'Fuzzy XML',
        confidence: 87,
        at: at(30),
      },
    ]);
  });
});

describe('commandErrorMessage', () => {
  it("reads a W3C error's message from the response", () => {
    const response = JSON.stringify({
      value: {
        error: 'no such element',
        message: 'An element could not be located',
        stacktrace: 'x',
      },
    });
    expect(commandErrorMessage(log({ response }))).toBe('An element could not be located');
  });
  it('falls back to the error name', () => {
    expect(
      commandErrorMessage(log({ response: '{"value":{"error":"stale element reference"}}' })),
    ).toBe('stale element reference');
  });
  it('is null for a success, or a response that is not JSON', () => {
    expect(commandErrorMessage(log({ response: '{"value":{"x":1}}' }))).toBe(null);
    expect(commandErrorMessage(log({ response: 'oops' }))).toBe(null);
    expect(commandErrorMessage(log({}))).toBe(null);
  });
});

describe('timelineLayout', () => {
  it('places each command from its start, oldest first', () => {
    // A row is written when its command ends: it started `duration` earlier.
    const logs = [
      log({ id: 'b', command_name: 'click', duration: 2000, createdAt: at(10) }),
      log({
        id: 'a',
        command_name: 'findElement',
        duration: 1000,
        createdAt: at(2),
        is_error: true,
        is_success: false,
      }),
    ];
    expect(timelineLayout(logs)).toEqual({
      spanMs: 9000,
      bars: [
        {
          id: 'a',
          label: 'findElement',
          startMs: 0,
          durationMs: 1000,
          failed: true,
          healed: false,
        },
        { id: 'b', label: 'click', startMs: 7000, durationMs: 2000, failed: false, healed: false },
      ],
    });
  });

  it('gives a command with no duration a point in time', () => {
    const out = timelineLayout([log({ id: 'a', duration: null, createdAt: at(5) })]);
    expect(out.bars[0]).toMatchObject({ startMs: 0, durationMs: 0 });
    expect(out.spanMs).toBe(1);
  });

  it('is empty with no commands', () => {
    expect(timelineLayout([])).toEqual({ spanMs: 0, bars: [] });
  });
});

describe('screenshotsOf', () => {
  it('lists the commands that kept a screenshot, oldest first', () => {
    const logs = [
      log({ id: 'b', command_name: 'click', screenshot: 's1/screenshots/b.png', createdAt: at(9) }),
      log({ id: 'x', screenshot: null }),
      log({
        id: 'a',
        command_name: 'setValue',
        screenshot: 's1/screenshots/a.png',
        createdAt: at(3),
      }),
    ];
    expect(screenshotsOf(logs)).toEqual([
      { id: 'a', path: 's1/screenshots/a.png', command: 'setValue', at: at(3), failed: false },
      { id: 'b', path: 's1/screenshots/b.png', command: 'click', at: at(9), failed: false },
    ]);
  });
});

describe('formatCommandDuration', () => {
  it('reads as people say it', () => {
    expect(formatCommandDuration(320)).toBe('320ms');
    expect(formatCommandDuration(8400)).toBe('8.4s');
    expect(formatCommandDuration(72_000)).toBe('1m 12s');
  });
  it('is a dash for nothing', () => {
    expect(formatCommandDuration(null)).toBe('—');
    expect(formatCommandDuration(undefined)).toBe('—');
  });
});
