import express from 'express';
import type { PrismaClient } from '../../src/generated/client';
import DashboardRouter from '../../src/app/routers/dashboard';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export const TEAM = { a: 'sh-team-a', b: 'sh-team-b' };
export const USER = { priya: 'sh-u-priya', alex: 'sh-u-alex', gone: 'sh-u-gone' };
export const PHONE = { shared: 'sh-phone-shared', a: 'sh-phone-a', b: 'sh-phone-b' };
export const BUILD = { id: 'sh-build-1', name: 'nightly-2026-10-01' };

/** What each selector stands for is in seedSelectorHealth. */
export const SEL = {
  hot: '//android.widget.Button[@text="Confirm"]',
  warm: 'com.acme:id/cart_total',
  bOnly: '//team-b/only',
  pending: '//being/verified',
  fixed: '//fixed/recently',
  fixedOld: '//fixed/long/ago',
  muted: '//muted/by/priya',
  mutedB: '//muted/team-b',
  legacy: '//legacy/no-strategy',
  odd: '//*[@text=\'50% off & "free" #1? [x]\']',
};

export const FIX = {
  hot: '//android.widget.Button[@content-desc="Confirm order"]',
  hotLlm: 'confirm_order',
  warm: 'com.acme:id/cart_total_v2',
};

export const ADMIN = {
  kind: 'user',
  userId: 'sh-u-admin',
  role: 'SUPER_ADMIN',
  scopes: 'admin,devices,sessions,read',
  teamIds: undefined,
};
export const MEMBER_A = {
  kind: 'user',
  userId: USER.priya,
  role: 'MEMBER',
  scopes: 'devices,sessions,read',
  teamIds: [TEAM.a],
};
export const READ_ONLY_A = {
  kind: 'api-key',
  userId: USER.priya,
  role: 'MEMBER',
  scopes: 'read',
  teamIds: [TEAM.a],
};

/** The dashboard routes, with `auth` as the signed-in caller. */
export function selectorHealthApp(auth: Record<string, unknown>) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { auth: Record<string, unknown> }).auth = auth;
    next();
  });
  DashboardRouter.register(a as never);
  return a;
}

/**
 * Two teams, a shared phone and one phone each, four sessions, and heals:
 * - hot: 4 heals on the shared phone (3 Visual AI, 1 LLM), the latest an hour
 *   ago; it broke again twice after being fixed;
 * - warm: 2 heals on team A's phone, 3 days ago, the slowest (20 s each);
 * - bOnly: 3 heals on team B's iPhone only;
 * - pending: being verified (2 of 3 clean builds), marked fixed by Priya;
 * - fixed: verified 2 days ago, marked fixed by a user who has been deleted;
 * - fixedOld: verified 60 days ago;
 * - muted: muted by Priya, with a reason; mutedB: muted by Alex, team B only;
 * - legacy: a heal with no strategy; odd: a selector full of punctuation.
 */
export async function seedSelectorHealth(db: PrismaClient, now = Date.now()): Promise<void> {
  await db.team.create({ data: { id: TEAM.a, name: 'Team A' } });
  await db.team.create({ data: { id: TEAM.b, name: 'Team B' } });
  for (const [id, name] of [
    [USER.priya, 'Priya'],
    [USER.alex, 'Alex'],
  ]) {
    await db.user.create({
      data: { id, name, email: `${id}@xenon.local`, passwordHash: 'x', accessKey: `ak-${id}` },
    });
  }
  const phones: Array<[string, string, string, string | null]> = [
    [PHONE.shared, 'Shared Pixel', 'android', null],
    [PHONE.a, 'Team A Galaxy', 'android', TEAM.a],
    [PHONE.b, 'Team B iPhone', 'ios', TEAM.b],
  ];
  for (const [udid, name, platform, teamId] of phones) {
    await db.device.create({ data: { udid, host: 'localhost', name, platform, teamId } as never });
  }
  await db.build.create({ data: { id: BUILD.id, name: BUILD.name } });

  const session = (
    id: string,
    udid: string,
    name: string,
    platform: string,
    buildId: string | null,
  ) =>
    db.session.create({
      data: {
        id,
        device_udid: udid,
        device_name: name,
        device_platform: platform,
        build_id: buildId,
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'localhost',
        has_live_video: false,
        device_version: '14',
        status: 'passed',
      } as never,
    });
  await session('sh-s-shared-1', PHONE.shared, 'Shared Pixel', 'android', BUILD.id);
  await session('sh-s-shared-2', PHONE.shared, 'Shared Pixel', 'android', null);
  await session('sh-s-a-1', PHONE.a, 'Team A Galaxy', 'android', BUILD.id);
  await session('sh-s-b-1', PHONE.b, 'Team B iPhone', 'ios', null);

  const heal = (
    sessionId: string,
    selector: string,
    ageMs: number,
    over: Record<string, unknown> = {},
  ) =>
    db.sessionLog.create({
      data: {
        session_id: sessionId,
        url: '/element',
        method: 'POST',
        title: 'findElement',
        response: '{}',
        command_name: 'findElement',
        is_healed: true,
        original_strategy: 'xpath',
        original_selector: selector,
        healed_strategy: 'xpath',
        healed_selector: `${selector}-healed`,
        healing_tier: 'Fuzzy XML',
        healing_confidence: 0.8,
        duration: 1000,
        createdAt: new Date(now - ageMs),
        ...over,
      } as never,
    });

  for (const age of [1, 1.5, 3]) {
    await heal('sh-s-shared-1', SEL.hot, age * HOUR, {
      healed_selector: FIX.hot,
      healing_tier: 'Visual AI',
      healing_confidence: 0.9,
      duration: 3000,
    });
  }
  await heal('sh-s-shared-2', SEL.hot, 4 * HOUR, {
    healed_selector: FIX.hotLlm,
    healed_strategy: 'accessibility id',
    healing_tier: 'LLM',
    healing_confidence: 0.5,
    duration: 9000,
  });
  // A lookup of the same selector that needed no healing is never counted.
  await db.sessionLog.create({
    data: {
      session_id: 'sh-s-shared-1',
      url: '/element',
      method: 'POST',
      title: 'findElement',
      response: '{}',
      command_name: 'findElement',
      is_healed: false,
      original_strategy: 'xpath',
      original_selector: SEL.hot,
    } as never,
  });
  for (const age of [3, 3.1]) {
    await heal('sh-s-a-1', SEL.warm, age * DAY, {
      original_strategy: 'id',
      healed_strategy: 'id',
      healed_selector: FIX.warm,
      duration: 20000,
    });
  }
  for (const age of [1, 1.1, 1.2]) await heal('sh-s-b-1', SEL.bOnly, age * DAY);
  await heal('sh-s-shared-1', SEL.pending, 10 * DAY);
  await heal('sh-s-a-1', SEL.fixed, 20 * DAY);
  await heal('sh-s-shared-1', SEL.fixedOld, 89 * DAY);
  await heal('sh-s-a-1', SEL.muted, 1 * DAY);
  await heal('sh-s-b-1', SEL.mutedB, 1 * DAY);
  await heal('sh-s-shared-2', SEL.legacy, 5 * HOUR, { original_strategy: null });
  await heal('sh-s-shared-2', SEL.odd, 6 * HOUR);

  const state = (selector: string, data: Record<string, unknown>) =>
    db.selectorState.create({
      data: { original_strategy: 'xpath', original_selector: selector, ...data } as never,
    });
  await state(SEL.hot, { status: 'active', regression_count: 2 });
  await state(SEL.pending, {
    status: 'pending',
    fixed_at: new Date(now - 5 * DAY),
    clean_builds_count: 2,
  });
  await state(SEL.fixed, {
    status: 'resolved',
    fixed_at: new Date(now - 9 * DAY),
    resolved_at: new Date(now - 2 * DAY),
    clean_builds_count: 3,
  });
  await state(SEL.fixedOld, {
    status: 'resolved',
    fixed_at: new Date(now - 70 * DAY),
    resolved_at: new Date(now - 60 * DAY),
    clean_builds_count: 3,
  });
  await state(SEL.muted, { status: 'muted', muted_at: new Date(now - 1 * DAY) });
  await state(SEL.mutedB, { status: 'muted', muted_at: new Date(now - 2 * DAY) });

  const event = (
    selector: string,
    action: string,
    userId: string | null,
    ageMs: number,
    reason: string | null = null,
  ) =>
    db.selectorEvent.create({
      data: {
        original_strategy: 'xpath',
        original_selector: selector,
        action,
        user_id: userId,
        reason,
        createdAt: new Date(now - ageMs),
      },
    });
  await event(SEL.pending, 'marked_fixed', USER.priya, 5 * DAY);
  await event(SEL.fixed, 'marked_fixed', USER.gone, 9 * DAY);
  await event(SEL.fixed, 'verified', null, 2 * DAY);
  await event(SEL.muted, 'muted', USER.priya, 1 * DAY, 'Screen being redesigned');
  await event(SEL.mutedB, 'muted', USER.alex, 2 * DAY);
}
