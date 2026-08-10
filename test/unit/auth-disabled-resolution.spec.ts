import { expect } from 'chai';
import { resolveAuthDisabled } from '../../src/config';

/**
 * `authDisabled` is declared in schema.json, so Appium accepts
 * `--plugin-xenon-auth-disabled` — but every consumer reads
 * `config.authDisabled`, which src/config.ts sources from XENON_AUTH_DISABLED.
 * Nothing bridged the two, so the documented flag silently did nothing and only
 * the env var worked. Cost a real debugging detour setting up a local server.
 *
 * This pins the bridge's precedence. It guards a switch that turns off
 * authentication for the entire /xenon/api surface, so the negative cases below
 * matter more than the positive one.
 */
describe('resolveAuthDisabled', () => {
  it('leaves auth ON when neither source asks for it', () => {
    expect(resolveAuthDisabled(undefined, false)).to.equal(false);
  });

  it('honours the CLI flag — the case that was silently broken', () => {
    expect(resolveAuthDisabled(true, false)).to.equal(true);
  });

  it('still honours the env var on its own', () => {
    expect(resolveAuthDisabled(undefined, true)).to.equal(true);
  });

  it('accepts both together', () => {
    expect(resolveAuthDisabled(true, true)).to.equal(true);
  });

  // The env var is the operator's setting. A plugin arg must never be able to
  // re-enable auth against it either, but the dangerous direction is a plugin
  // arg silently switching auth off, so both directions are pinned.
  it('does not let an explicit `false` plugin arg re-enable auth over the env var', () => {
    expect(resolveAuthDisabled(false, true)).to.equal(true);
  });

  // The schema types this boolean. A loose truthy check would let any of these
  // disable authentication for the whole server — including the string
  // "false", which is exactly what a mis-parsed CLI value looks like.
  it('ignores truthy non-boolean values rather than disabling auth', () => {
    for (const v of ['true', 'false', '1', 1, {}, [], 'yes']) {
      expect(resolveAuthDisabled(v, false), `value ${JSON.stringify(v)}`).to.equal(false);
    }
  });

  it('ignores falsy non-boolean values too', () => {
    for (const v of [null, 0, '', NaN]) {
      expect(resolveAuthDisabled(v, false), `value ${JSON.stringify(v)}`).to.equal(false);
    }
  });
});
