import 'reflect-metadata';
import { expect } from 'chai';
import { useScratchDatabase } from '../helpers/scratch-database';
import { SEL, TEAM, USER, seedSelectorHealth } from '../helpers/selector-health-fixture';
import {
  SELECTOR_VISIBILITY_TTL_MS,
  SelectorViewer,
  SelectorVisibilityResolver,
} from '../../src/services/selector-health/SelectorVisibilityResolver';
import type { SelectorKey } from '../../src/services/selector-health/selectorKeys';

const KEY: SelectorKey = { strategy: 'xpath', selector: '//x' };
const MEMBER_A: SelectorViewer = { userId: 'u-a', teamIds: ['team-a'] };

describe('SelectorVisibilityResolver: who may see a selector, for its live events', () => {
  describe('caching', () => {
    let clock: number;
    let scopes: string[];
    let checks: string[];
    let visible: boolean;

    function resolver(
      over: Partial<ConstructorParameters<typeof SelectorVisibilityResolver>[0]> = {},
    ) {
      return new SelectorVisibilityResolver({
        sessionScope: async (viewer) => {
          scopes.push(viewer.userId ?? '');
          return { OR: [{ device_udid: { in: viewer.teamIds } }] };
        },
        healedIn: async (key) => {
          checks.push(key.selector);
          return visible;
        },
        now: () => clock,
        ...over,
      });
    }

    beforeEach(() => {
      clock = 1_000_000;
      scopes = [];
      checks = [];
      visible = true;
    });

    it('asks once per viewer and selector while the answer is fresh, then again', async () => {
      const r = resolver();
      expect(await r.canSee(KEY, MEMBER_A)).to.equal(true);
      visible = false;
      expect(await r.canSee(KEY, MEMBER_A), 'still the cached answer').to.equal(true);
      expect(checks).to.have.length(1);
      clock += SELECTOR_VISIBILITY_TTL_MS;
      expect(await r.canSee(KEY, MEMBER_A), 'asked again after the TTL').to.equal(false);
      expect(checks).to.have.length(2);
    });

    it('concurrent questions share one lookup', async () => {
      const r = resolver();
      const answers = await Promise.all([
        r.canSee(KEY, MEMBER_A),
        r.canSee(KEY, { userId: 'u-a', teamIds: ['team-a'] }),
        r.canSee(KEY, MEMBER_A),
      ]);
      expect(answers).to.deep.equal([true, true, true]);
      expect(checks).to.have.length(1);
      expect(scopes).to.have.length(1);
    });

    it("a viewer's sessions are read once for all their selectors", async () => {
      const r = resolver();
      await r.canSee(KEY, MEMBER_A);
      await r.canSee({ strategy: 'id', selector: 'other' }, MEMBER_A);
      expect(scopes).to.deep.equal(['u-a']);
      expect(checks).to.deep.equal(['//x', 'other']);
    });

    it('the same teams in another order are the same viewer; another user or team is not', async () => {
      const r = resolver();
      await r.canSee(KEY, { userId: 'u-a', teamIds: ['team-a', 'team-b'] });
      await r.canSee(KEY, { userId: 'u-a', teamIds: ['team-b', 'team-a'] });
      expect(checks, 'team order').to.have.length(1);
      await r.canSee(KEY, { userId: 'u-b', teamIds: ['team-a', 'team-b'] });
      await r.canSee(KEY, { userId: 'u-a', teamIds: ['team-a'] });
      expect(checks, 'another user, other teams').to.have.length(3);
    });

    it('a selector with no strategy is its own selector, not one with the same text', async () => {
      const r = resolver();
      await r.canSee({ strategy: '', selector: '//x' }, MEMBER_A);
      await r.canSee({ strategy: 'xpath', selector: '//x' }, MEMBER_A);
      expect(checks).to.have.length(2);
    });

    it('a lookup that fails answers no, and is asked again next time', async () => {
      let fail = true;
      const r = resolver({
        healedIn: async (key) => {
          checks.push(key.selector);
          if (fail) throw new Error('database gone');
          return true;
        },
      });
      expect(await r.canSee(KEY, MEMBER_A)).to.equal(false);
      fail = false;
      expect(await r.canSee(KEY, MEMBER_A)).to.equal(true);
      expect(checks).to.have.length(2);
    });

    it("a viewer's sessions that can't be read answer no, and are read again next time", async () => {
      let fail = true;
      const r = resolver({
        sessionScope: async (viewer) => {
          scopes.push(viewer.userId ?? '');
          if (fail) throw new Error('database gone');
          return undefined;
        },
      });
      expect(await r.canSee(KEY, MEMBER_A)).to.equal(false);
      fail = false;
      expect(await r.canSee(KEY, MEMBER_A)).to.equal(true);
      expect(scopes).to.have.length(2);
    });

    it('a lookup that hangs answers no after the timeout, and is asked again next time', async () => {
      let hang = true;
      const r = resolver({
        healedIn: (key) => {
          checks.push(key.selector);
          return hang ? new Promise<boolean>(() => undefined) : Promise.resolve(true);
        },
        lookupTimeoutMs: 20,
      });
      expect(await r.canSee(KEY, MEMBER_A)).to.equal(false);
      hang = false;
      expect(await r.canSee(KEY, MEMBER_A)).to.equal(true);
      expect(checks).to.have.length(2);
    });
  });

  describe("REST's rule, on a real database (Selector Health's own fixture)", () => {
    const scratch = useScratchDatabase({ wholeSuite: true });
    const UNPLUGGED = 'sh-phone-unplugged';

    before(async () => {
      await seedSelectorHealth(scratch.db);
      // Priya's session on a phone that has since gone: no Device row.
      await scratch.db.session.create({
        data: {
          id: 'sh-s-unplugged',
          device_udid: UNPLUGGED,
          device_name: 'Gone',
          device_platform: 'android',
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'localhost',
          has_live_video: false,
          device_version: '14',
          status: 'passed',
          user_id: USER.priya,
        } as never,
      });
      await scratch.db.sessionLog.create({
        data: {
          session_id: 'sh-s-unplugged',
          url: '/element',
          method: 'POST',
          title: 'findElement',
          response: '{}',
          command_name: 'findElement',
          is_healed: true,
          original_strategy: 'xpath',
          original_selector: '//unplugged/only',
        } as never,
      });
    });

    const xpath = (selector: string): SelectorKey => ({ strategy: 'xpath', selector });
    const teamA: SelectorViewer = { userId: USER.priya, teamIds: [TEAM.a] };
    const teamB: SelectorViewer = { userId: USER.alex, teamIds: [TEAM.b] };
    const noTeam: SelectorViewer = { userId: 'sh-u-nobody', teamIds: [] };

    it("a team's member sees the selectors healed on their team's phone or a shared one, not another team's", async () => {
      const r = new SelectorVisibilityResolver();
      expect(
        await r.canSee({ strategy: 'id', selector: SEL.warm }, teamA),
        'team A phone',
      ).to.equal(true);
      expect(await r.canSee(xpath(SEL.hot), teamA), 'shared phone').to.equal(true);
      expect(await r.canSee(xpath(SEL.bOnly), teamA), "team B's phone").to.equal(false);
      expect(await r.canSee(xpath(SEL.bOnly), teamB)).to.equal(true);
      expect(await r.canSee({ strategy: 'id', selector: SEL.warm }, teamB)).to.equal(false);
    });

    it('a member of no team sees only what healed on a shared phone', async () => {
      const r = new SelectorVisibilityResolver();
      expect(await r.canSee(xpath(SEL.hot), noTeam)).to.equal(true);
      expect(await r.canSee(xpath(SEL.muted), noTeam)).to.equal(false);
      expect(await r.canSee(xpath(SEL.mutedB), noTeam)).to.equal(false);
    });

    it('a heal recorded with no strategy is strategy ""', async () => {
      const r = new SelectorVisibilityResolver();
      expect(await r.canSee({ strategy: '', selector: SEL.legacy }, noTeam)).to.equal(true);
    });

    it("a phone that has gone leaves its sessions' selectors to their owner", async () => {
      const r = new SelectorVisibilityResolver();
      expect(await r.canSee(xpath('//unplugged/only'), teamA), 'Priya owns it').to.equal(true);
      expect(await r.canSee(xpath('//unplugged/only'), teamB)).to.equal(false);
    });

    it('an unknown selector is seen by no one', async () => {
      const r = new SelectorVisibilityResolver();
      expect(await r.canSee(xpath('//never/healed'), teamA)).to.equal(false);
    });
  });
});
