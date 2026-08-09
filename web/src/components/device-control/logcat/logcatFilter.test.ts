import { describe, expect, it } from 'vitest';
import { matches, parseQuery, setLevelTerm } from './logcatFilter';

const rec = (over: Partial<Parameters<typeof matches>[0]> = {}) => ({
  level: 'D',
  tag: 'Tile.WifiTile',
  message: 'handleUpdateState isTransient=false',
  pkg: 'com.android.systemui',
  ...over,
});

describe('logcat filter', () => {
  it('matches everything on an empty query', () => {
    expect(matches(rec(), parseQuery(''))).toBe(true);
    expect(matches(rec(), parseQuery('   '))).toBe(true);
  });

  // The fixture straddles the threshold on both sides (D below, W at, E
  // above) so this pins "minimum" rather than "equals": an `===` mutant
  // would flip the E case, an `<=`/"maximum" mutant would flip it too.
  it('filters by minimum level', () => {
    const q = parseQuery('level:W');
    expect(matches(rec({ level: 'E' }), q)).toBe(true);
    expect(matches(rec({ level: 'W' }), q)).toBe(true);
    expect(matches(rec({ level: 'D' }), q)).toBe(false);
  });

  // A second minimum, away from the ends of LEVEL_ORDER, so an off-by-one in
  // the index comparison can't hide behind V/F edge behavior.
  it('filters by minimum level at a different threshold', () => {
    const q = parseQuery('level:I');
    expect(matches(rec({ level: 'V' }), q)).toBe(false);
    expect(matches(rec({ level: 'D' }), q)).toBe(false);
    expect(matches(rec({ level: 'I' }), q)).toBe(true);
    expect(matches(rec({ level: 'W' }), q)).toBe(true);
  });

  it('parses the level value case-insensitively', () => {
    expect(matches(rec({ level: 'W' }), parseQuery('level:w'))).toBe(true);
    expect(matches(rec({ level: 'D' }), parseQuery('LEVEL:W'))).toBe(false);
  });

  it('filters by tag substring, case-insensitively', () => {
    expect(matches(rec(), parseQuery('tag:wifi'))).toBe(true);
    expect(matches(rec(), parseQuery('tag:bluetooth'))).toBe(false);
  });

  it('filters by package substring', () => {
    expect(matches(rec(), parseQuery('package:systemui'))).toBe(true);
    expect(matches(rec(), parseQuery('package:com.example'))).toBe(false);
  });

  // pkg is absent whenever the PID couldn't be resolved (short-lived
  // process, a failing `adb shell ps`) — decided this should never satisfy a
  // package: term rather than e.g. treating "unknown" as a wildcard match.
  it('treats a record with no package as not matching a package term', () => {
    expect(matches(rec({ pkg: undefined }), parseQuery('package:systemui'))).toBe(false);
  });

  it('matches bare text against the message', () => {
    expect(matches(rec(), parseQuery('isTransient'))).toBe(true);
    expect(matches(rec(), parseQuery('nonsense'))).toBe(false);
  });

  it('ANDs all terms together', () => {
    const q = parseQuery('level:D tag:wifi handleUpdate');
    expect(matches(rec(), q)).toBe(true);
    expect(matches(rec({ tag: 'Other' }), q)).toBe(false);
    expect(matches(rec({ message: 'something else' }), q)).toBe(false);
  });

  it('joins multiple bare words into one message term', () => {
    expect(matches(rec(), parseQuery('handleUpdateState isTransient'))).toBe(true);
  });

  // synthetic records (Xenon-injected drop/end-of-stream markers) are not
  // part of LogRecordLike and get no special-case bypass: they carry a real
  // level/tag and are expected to interact with the grammar exactly like any
  // other record, in both directions (hidden by a non-matching filter, kept
  // by a matching or empty one).
  it('filters a synthetic-shaped record the same as device output', () => {
    const dropped = rec({
      level: 'W',
      tag: 'xenon',
      message: '3 lines dropped (slow client)',
      pkg: undefined,
    });
    const ended = rec({
      level: 'E',
      tag: 'xenon',
      message: 'log stream ended (reset)',
      pkg: undefined,
    });

    expect(matches(dropped, parseQuery(''))).toBe(true);
    expect(matches(ended, parseQuery(''))).toBe(true);
    // A level:E filter hides the W-level drop marker just like it would hide
    // any other W-level line.
    expect(matches(dropped, parseQuery('level:E'))).toBe(false);
    expect(matches(ended, parseQuery('level:E'))).toBe(true);
    // A tag/text filter unrelated to "xenon" hides both, same as it would
    // hide any non-matching device line.
    expect(matches(dropped, parseQuery('tag:wifi'))).toBe(false);
  });
});

describe('setLevelTerm', () => {
  it('inserts a level: term into an empty query', () => {
    expect(setLevelTerm('', 'W')).toBe('level:W');
  });

  it('appends nothing extra when the query already has no level term', () => {
    expect(setLevelTerm('tag:wifi', 'W')).toBe('level:W tag:wifi');
  });

  it('uppercases the written level value', () => {
    expect(setLevelTerm('tag:wifi', 'w')).toBe('level:W tag:wifi');
  });

  it('replaces an existing level: term in place, wherever it sits', () => {
    expect(setLevelTerm('level:D tag:wifi', 'W')).toBe('level:W tag:wifi');
    expect(setLevelTerm('tag:wifi level:D', 'W')).toBe('level:W tag:wifi');
  });

  it('matches the level: key case-insensitively when replacing', () => {
    expect(setLevelTerm('LEVEL:d tag:wifi', 'W')).toBe('level:W tag:wifi');
  });

  it('removes the level: term for a falsy level, leaving the rest untouched', () => {
    expect(setLevelTerm('level:D tag:wifi', '')).toBe('tag:wifi');
  });

  it('collapses more than one level: term to the single new one', () => {
    // Guards against a user having typed their own level: term that would
    // otherwise silently out-vote the dropdown under last-token-wins parsing.
    expect(setLevelTerm('level:D tag:wifi level:E', 'W')).toBe('level:W tag:wifi');
  });

  it('round-trips through parseQuery so the control and the text box cannot disagree', () => {
    const next = setLevelTerm('tag:wifi handleUpdate', 'E');
    const q = parseQuery(next);
    expect(q.minLevel).toBe('E');
    expect(q.tag).toBe('wifi');
    expect(q.text).toBe('handleupdate');
  });
});
