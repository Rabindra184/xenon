import { describe, expect, it } from 'vitest';
import { parseQuery } from './logcatFilter';
import { chosenLevel, countLevels, levelChoices, levelName, type LevelCounts } from './levelCounts';

const line = (level: string, tag = 'Tag', synthetic = false) => ({
  level,
  tag,
  message: 'm',
  synthetic,
});
const zero: LevelCounts = { V: 0, D: 0, I: 0, W: 0, E: 0, F: 0 };

describe('countLevels', () => {
  it('counts the lines of each level', () => {
    expect(countLevels([line('D'), line('D'), line('W'), line('E')], {})).toEqual({
      ...zero,
      D: 2,
      W: 1,
      E: 1,
    });
  });

  it('follows the filter, but not its level term', () => {
    const records = [line('D', 'Wifi'), line('E', 'Wifi'), line('E', 'Bluetooth')];
    expect(countLevels(records, parseQuery('level:E tag:wifi'))).toEqual({ ...zero, D: 1, E: 1 });
  });

  it("leaves Xenon's own records and unknown letters out", () => {
    expect(countLevels([line('W', 'xenon', true), line('X')], {})).toEqual(zero);
  });
});

describe('levelChoices', () => {
  it('offers the Android levels, and Fatal only when there is one', () => {
    expect(levelChoices('android', zero, undefined).map((c) => c.name)).toEqual([
      'Verbose',
      'Debug',
      'Info',
      'Warning',
      'Error',
    ]);
    expect(levelChoices('android', { ...zero, F: 1 }, undefined).map((c) => c.level)).toContain(
      'F',
    );
    expect(levelChoices('android', zero, 'F').map((c) => c.name)).toContain('Fatal');
  });

  it('offers the iOS levels', () => {
    expect(levelChoices('ios', zero, undefined).map((c) => c.name)).toEqual([
      'Debug',
      'Info',
      'Error',
      'Fault',
    ]);
  });
});

describe('chosenLevel', () => {
  const android = levelChoices('android', zero, undefined);
  const ios = levelChoices('ios', zero, undefined);

  it('is the level asked for when it is offered', () => {
    expect(chosenLevel(android, 'W')).toBe('W');
    expect(chosenLevel(android, 'V')).toBe('V');
  });

  // iOS has no Warning or Verbose: the button pressed is the one whose
  // lines the list actually shows.
  it('is the lowest offered level above one the platform has no button for', () => {
    expect(chosenLevel(ios, 'W')).toBe('E');
    expect(chosenLevel(ios, 'V')).toBe('D');
  });

  it('is none for no level or a typo', () => {
    expect(chosenLevel(android, undefined)).toBeNull();
    expect(chosenLevel(android, 'X')).toBeNull();
  });
});

describe('levelName', () => {
  it('names each level, F by platform', () => {
    expect(levelName('W', 'android')).toBe('Warning');
    expect(levelName('F', 'android')).toBe('Fatal');
    expect(levelName('F', 'ios')).toBe('Fault');
    expect(levelName('Q', 'android')).toBe('Q');
  });
});
