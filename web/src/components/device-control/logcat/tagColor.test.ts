import { describe, it, expect } from 'vitest';
import { tagColor, TAG_COLORS } from './tagColor';

describe('tagColor', () => {
  // The whole point. A tag whose colour changes between renders or reloads is
  // worse than no colouring, because the reader has learned to trust it.
  it('is stable for the same tag', () => {
    const tags = ['WifiService', 'ActivityManager', 'QSClockBellTower', 'a'];
    for (const t of tags) {
      expect(tagColor(t)).to.equal(tagColor(t));
    }
  });

  it('only ever returns a palette entry', () => {
    for (const t of ['Wifi', 'dalvikvm', 'NetworkController', 'X', '日本語']) {
      expect(TAG_COLORS).to.include(tagColor(t));
    }
  });

  // An absent tag must not be coloured as if it were a real one.
  it('returns the muted token for an empty tag, not a palette entry', () => {
    expect(tagColor('')).to.equal('var(--text-muted)');
    expect(TAG_COLORS).to.not.include(tagColor(''));
  });

  it('is case- and character-sensitive: different tags are different keys', () => {
    expect(tagColor('Wifi')).to.not.equal(tagColor('wifi'));
  });

  /**
   * The reason FNV-1a is used rather than `h * 31 + c`.
   *
   * Real logcat tags share long prefixes, and prefix-siblings are precisely
   * the tags a reader most needs to tell apart. A weak mixer hands them
   * adjacent buckets. This pins the property that actually matters — good
   * spread over realistic input — rather than the hash function's identity,
   * so it stays meaningful if the implementation is ever swapped.
   */
  it('spreads realistic prefix-sharing tags across most of the palette', () => {
    const realistic = [
      'Wifi',
      'WifiService',
      'WifiP2pService',
      'WifiHAL',
      'WifiMWips',
      'NetworkController',
      'NetworkControllerImpl',
      'NetworkPolicy',
      'ActivityManager',
      'ActivityThread',
      'ActivityTaskManager',
      'QSClock',
      'QSClockBellTower',
      'QSContainerImpl',
      'KeyguardUpdateMonitor',
      'SecStatusBarWifiView',
      'Gralloc3',
      'gralloc',
      'hwservicemanager',
      'EDMNativeHelperService',
    ];
    const used = new Set(realistic.map(tagColor));
    // 20 tags over a 12-colour palette: collisions are inevitable and fine,
    // clustering into a corner is not. Two-thirds coverage would be poor luck
    // for a well-mixed hash and impossible for a badly clustered one.
    expect(used.size).to.be.greaterThanOrEqual(8);
  });

  it('gives the closest prefix-siblings different colours', () => {
    // The pair most likely to collide under a weak mixer: same prefix, one
    // extra character.
    expect(tagColor('Wifi')).to.not.equal(tagColor('Wifi2'));
    expect(tagColor('QSClock')).to.not.equal(tagColor('QSClocks'));
  });

  it('does not reuse the level colours, so a tag cannot read as a severity', () => {
    // amber = W, red = E/F, green = I (see logcat.css)
    const levelColors = ['#fbbf24', '#f87171', '#4ade80'];
    for (const c of TAG_COLORS) {
      expect(levelColors).to.not.include(c.toLowerCase());
    }
  });

  it('handles a long tag without throwing or drifting out of range', () => {
    const long = 'A'.repeat(5000);
    expect(TAG_COLORS).to.include(tagColor(long));
  });
});
