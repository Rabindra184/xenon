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

  // synthetic records (Xenon-injected drop/end-of-stream markers) ALWAYS
  // match, checked first and unconditionally in `matches`. Reversed from an
  // earlier decision to filter them like any other record: the multiplexer
  // cannot know what level dropped lines were, so a `level:E` reader could
  // have the W-level "N lines dropped" marker hidden and believe every error
  // was captured while errors were silently discarded. Covers both marker
  // kinds against several filter types that would otherwise hide them.
  it('always matches a synthetic record, regardless of the active filter', () => {
    const dropped = rec({
      level: 'W',
      tag: 'xenon',
      message: '3 lines dropped (slow client)',
      pkg: undefined,
      synthetic: true,
    });
    const ended = rec({
      level: 'E',
      tag: 'xenon',
      message: 'log stream ended (reset)',
      pkg: undefined,
      synthetic: true,
    });

    expect(matches(dropped, parseQuery(''))).toBe(true);
    expect(matches(ended, parseQuery(''))).toBe(true);
    // A level:E filter would otherwise hide the W-level drop marker.
    expect(matches(dropped, parseQuery('level:E'))).toBe(true);
    // A tag/text filter unrelated to "xenon" would otherwise hide both.
    expect(matches(dropped, parseQuery('tag:wifi'))).toBe(true);
    expect(matches(ended, parseQuery('nonsense text'))).toBe(true);
  });

  // Guards `if (r.synthetic) return true` against a mutant that returns true
  // unconditionally: a real device record that merely happens to share the
  // marker's level/tag/message must still be filtered normally.
  it('does not bypass the filter for a non-synthetic record with the same level and tag', () => {
    const lookalike = rec({
      level: 'W',
      tag: 'xenon',
      message: '3 lines dropped (slow client)',
      pkg: undefined,
    });
    expect(matches(lookalike, parseQuery('level:E'))).toBe(false);
  });

  // Malformed-level guard (`want >= 0 && have >= 0`): a record whose own
  // level is unrecognized (index -1) must never be excluded by a valid
  // level:X filter. Deleting the `have >= 0 &&` half of the guard turns
  // `have < want` into `-1 < want`, true for any valid want, wrongly hiding
  // the record — exactly what the guard's own comment says never happens.
  it('does not filter out a record with an unrecognized level', () => {
    expect(matches(rec({ level: 'Z' }), parseQuery('level:W'))).toBe(true);
  });

  // parseQuery's three `value &&` guards: a `key:` typed with no value must
  // degrade to a bare-text term rather than vanishing, per the file's own
  // doc comment. One case per key, since each is a separate `value &&` check.
  it('treats a valueless level: term as bare text instead of dropping it', () => {
    const q = parseQuery('level:');
    expect(q.minLevel).toBeUndefined();
    expect(q.text).toBe('level:');
  });

  it('treats a valueless tag: term as bare text instead of dropping it', () => {
    const q = parseQuery('tag:');
    expect(q.tag).toBeUndefined();
    expect(q.text).toBe('tag:');
  });

  it('treats a valueless package: term as bare text instead of dropping it', () => {
    const q = parseQuery('package:');
    expect(q.pkg).toBeUndefined();
    expect(q.text).toBe('package:');
  });

  // tag:/package: key case-insensitivity — only level: casing was exercised
  // before this.
  it('parses the tag key case-insensitively', () => {
    expect(matches(rec(), parseQuery('TAG:wifi'))).toBe(true);
  });

  it('parses the package key case-insensitively', () => {
    expect(matches(rec(), parseQuery('PACKAGE:systemui'))).toBe(true);
  });

  // tag:/package: query-side *value* case-insensitivity — matches() lowercases
  // the record side, but parseQuery must also lowercase the query side, or an
  // uppercase query value never matches a lowercase record field.
  it('matches a tag: query value case-insensitively', () => {
    expect(matches(rec(), parseQuery('tag:WIFI'))).toBe(true);
  });

  it('matches a package: query value case-insensitively', () => {
    expect(matches(rec(), parseQuery('package:SYSTEMUI'))).toBe(true);
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

  // A bare `level` word (no colon, so no value) is text the user typed, not
  // a filter control — parseQuery treats it as bare text (its `value &&`
  // gate), so this must too. The buggy version stripped any token whose
  // pre-colon key was `level` regardless of whether a value followed it,
  // silently deleting the word whenever the level dropdown fired.
  it('leaves a bare "level" word untouched — only a level:value term is a level term', () => {
    expect(setLevelTerm('foo level bar', 'W')).toBe('level:W foo level bar');
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
