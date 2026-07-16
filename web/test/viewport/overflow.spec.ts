import { test, expect } from '@playwright/test';

// COVERAGE BOUNDARY: only `/xenon/devices/MOCK-ANDROID-01/control` is hermetically
// guarded — its device is fully mocked below and a dedicated test asserts the
// 11-button toolbar rendered, so it cannot pass vacuously. The other routes mock
// only the device list; their data tables render whatever the target server holds.
// The per-route shell check (aside:has(nav)) catches a blank/crashed page but NOT
// an empty-data one — a zero-row table has nothing to overflow. So for the
// non-control routes this guard is only meaningful against a populated server.
// Mocking those routes' data endpoints for full hermeticity is a tracked follow-up.

// Real Android device JSON shape, per .superpowers/sdd/task-2-brief.md. Only the
// fields the control page actually reads matter, but we keep the full shape so
// the mock can't silently drift from what a live /xenon/api/device response looks
// like.
const MOCK_ANDROID_DEVICE = {
  udid: 'MOCK-ANDROID-01',
  host: 'http://127.0.0.1:4723',
  name: 'Pixel 8 Pro - Bangalore Lab Rack 4 Slot 12',
  state: 'device',
  sdk: '14',
  platform: 'android',
  deviceType: 'real',
  busy: false,
  userBlocked: false,
  realDevice: true,
  session_id: null,
  offline: false,
  systemPort: 10100,
  mjpegServerPort: 9101,
  adbPort: 5037,
  screenWidth: '1080',
  screenHeight: '2340',
  totalUtilizationTimeMilliSec: 0,
  sessionStartTime: 0,
  total_session_count: 0,
  healthStatus: 'Healthy',
  batteryLevel: 100,
  storageFree: '97G',
  thermalStatus: 'Normal',
  sessionProgress: '',
  totalHealedCount: 0,
  ip: '192.168.0.112',
  cpuArchitecture: 'arm64-v8a',
  reservedBy: null,
  reservedUntil: null,
  reservationReason: null,
  owningSessionId: null,
  lockedAt: null,
  teamId: null,
  createdAt: '2026-07-16T06:53:02.793Z',
  updatedAt: '2026-07-16T07:29:10.635Z',
};

// Supported range is 1280-1440. Widths include BOTH SIDES of every breakpoint
// boundary — that is the mechanism that catches a breakpoint set below a
// layout's intrinsic minimum, which is the bug class this guard exists for.
// (Selector Health shipped a max-width:1024 override 121px below its own 1146px
// floor, leaving a dead zone at 1025-1145 invisible from either end.)
const WIDTHS = [1280, 1281, 1399, 1400, 1440];

const ROUTES = [
  '/xenon/overview',
  '/xenon/devices',
  '/xenon/builds',
  '/xenon/apps',
  '/xenon/selector-health',
  '/xenon/settings',
  '/xenon/teams',
  '/xenon/users',
  '/xenon/api-keys',
  '/xenon/maintenance',
  '/xenon/notifications',
  '/xenon/ai-settings',
  '/xenon/devices/MOCK-ANDROID-01/control',
];

test.beforeEach(async ({ page }) => {
  // Route-mocked device list: the real device manager reaps any Device row for
  // hardware that isn't attached (removeStaleDevices, src/device-utils.ts:511),
  // so a mocked HTTP response is the only hermetic way to get a stable device
  // onto the page. The glob must match the cache-busting `?t=` query param the
  // client appends to every /xenon/api/device call.
  await page.route('**/xenon/api/device*', (route) =>
    route.fulfill({ json: [MOCK_ANDROID_DEVICE] }),
  );
  // MJPEG is an endless multipart/x-mixed-replace response; letting it through
  // means networkidle never fires and every control-page test times out.
  await page.route('**/xenon/api/control/*/stream*', (route) => route.abort());
  // useSocket.ts (web/src/hooks/useSocket.ts) connects socket.io-client with no
  // transport override and path:'/socket.io' against window.location.origin —
  // i.e. the HTTP endpoint is always `/socket.io/*`, never namespaced under the
  // `/xenon` app base path. With no transport pinned, socket.io can fall back to
  // continuous HTTP long-polling, which — exactly like the MJPEG stream above —
  // can prevent networkidle from ever settling. It didn't manifest in the last
  // run, but it's latent fragility in a guard whose whole value is reliability,
  // so abort it the same way. 4 of the 13 routes use useSocket; aborting is safe
  // because this guard tests layout, not realtime updates.
  await page.route('**/socket.io/**', (route) => route.abort());
});

for (const width of WIDTHS) {
  for (const route of ROUTES) {
    test(`no overflow at ${width}px on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // Guard against a vacuous pass: an overflow check over `body *` passes
      // trivially on a blank or error-state render (uncaught JS exception,
      // unmocked dependency) because there's simply nothing left to overflow.
      // Every authenticated route mounts the app shell exactly once (see
      // web/src/App.tsx — <Sidebar/> wraps <Outlet/>), so "the nav sidebar
      // rendered its buttons" is a route-agnostic signal that this route
      // actually painted real content, not an empty div. `aside:has(nav)`
      // disambiguates the nav sidebar from other <aside> elements some routes
      // render (e.g. the control page's `.device-footer-actions` toolbar,
      // which has no <nav> inside it). The real sidebar renders 13 nav buttons
      // (web/src/components/sidebar/sidebar.tsx) plus a 14th "API Docs"
      // button; 5 is comfortably below that "shell mounted" floor while being
      // nowhere close to the near-empty button counts (0-2) a broken page
      // would exhibit, so it won't flake if role-based nav items change.
      const shellNav = page.locator('aside').filter({ has: page.locator('nav') });
      await expect(shellNav).toBeVisible();
      expect(await shellNav.locator('button').count()).toBeGreaterThanOrEqual(5);

      // body{overflow:hidden} (index.css:32) forces scrollWidth === innerWidth,
      // so document scroll CANNOT detect this. Measure element rects instead.
      //
      // A centered flex row (justify-content: center) that's too wide overflows
      // BOTH edges roughly symmetrically, not just the right — a right-only check
      // would miss the left clip entirely, and body{overflow:hidden} means it
      // never shows up in a screenshot either. Same +1/-1 px tolerance on both
      // edges so sub-pixel layout rounding doesn't cause flakes.
      const offenders = await page.evaluate(() => {
        const vw = window.innerWidth;
        return Array.from(document.querySelectorAll('body *'))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter((x) => x.r.width > 0 && (x.r.right > vw + 1 || x.r.left < -1))
          .map((x) => ({
            el: x.el,
            rightOverflowPx: x.r.right > vw + 1 ? Math.round(x.r.right - vw) : 0,
            leftOverflowPx: x.r.left < -1 ? Math.round(-x.r.left) : 0,
          }))
          .sort(
            (a, b) =>
              Math.max(b.rightOverflowPx, b.leftOverflowPx) -
              Math.max(a.rightOverflowPx, a.leftOverflowPx),
          )
          .slice(0, 5)
          .map((x) => ({
            tag: (x.el as HTMLElement).tagName,
            cls: ((x.el as HTMLElement).className || '').toString().slice(0, 60),
            rightOverflowPx: x.rightOverflowPx,
            leftOverflowPx: x.leftOverflowPx,
          }));
      });

      expect(
        offenders,
        `Elements escape the viewport at ${width}px on ${route}:\n` +
          offenders
            .map((o) => {
              const edges: string[] = [];
              if (o.rightOverflowPx > 0) edges.push(`right edge by ${o.rightOverflowPx}px`);
              if (o.leftOverflowPx > 0) edges.push(`left edge by ${o.leftOverflowPx}px`);
              return `  ${o.tag}.${o.cls} escapes ${edges.join(' and ')}`;
            })
            .join('\n'),
      ).toEqual([]);
    });
  }
}

// Landscape is pure client state (setIsPortrait(false)); no device command is
// sent, so it runs against the mock. The portrait canvas is narrow and never
// overflowed — the clip only appears in landscape, which the matrix above never
// enters. Cover both ends of the supported range (before the fix: 113px LEFT clip
// @1280, 33px LEFT clip @1440).
for (const width of [1280, 1440]) {
  test(`no overflow in LANDSCAPE at ${width}px on the control page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/xenon/devices/MOCK-ANDROID-01/control');
    await page.waitForLoadState('networkidle');

    // Enter landscape via the footer toggle (pure UI state, no backend call). The
    // PORTRAIT button also exists; hasText 'LANDSCAPE' selects only the landscape one.
    await page.locator('.footer-action-btn', { hasText: 'LANDSCAPE' }).click();

    // Non-vacuous gate: prove landscape engaged AND the WIDE canvas painted, else the
    // rect scan could pass on a still-portrait (narrow) or zero-size canvas — the exact
    // false negative this guard must prevent.
    const canvas = page.locator('.device-stream-canvas.landscape');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'landscape canvas must have a measurable box').not.toBeNull();
    // A landscape phone is wider than tall; width <= height means the toggle didn't take.
    expect(box!.width).toBeGreaterThan(box!.height);

    // Same both-edges rect scan as the matrix (body{overflow:hidden} makes
    // scrollWidth === innerWidth, so document scroll can't detect this).
    const offenders = await page.evaluate(() => {
      const vw = window.innerWidth;
      return Array.from(document.querySelectorAll('body *'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.right > vw + 1 || x.r.left < -1))
        .map((x) => ({
          tag: (x.el as HTMLElement).tagName,
          cls: ((x.el as HTMLElement).className || '').toString().slice(0, 60),
          rightOverflowPx: x.r.right > vw + 1 ? Math.round(x.r.right - vw) : 0,
          leftOverflowPx: x.r.left < -1 ? Math.round(-x.r.left) : 0,
        }));
    });

    expect(
      offenders,
      `Landscape elements escape the viewport at ${width}px:\n` +
        offenders
          .map((o) => `  ${o.tag}.${o.cls} rightOverflow=${o.rightOverflowPx}px leftOverflow=${o.leftOverflowPx}px`)
          .join('\n'),
    ).toEqual([]);
  });
}

test('control page renders the Android toolbar (guards against a vacuous pass)', async ({
  page,
}) => {
  // The seeding approach in the original plan failed silently: the control page
  // fell back to a non-toolbar view, .device-footer-actions never mounted, and
  // the overflow assertion above found nothing to complain about — a false
  // negative on the exact bug this guard exists to catch. This test fails loudly
  // if that happens again, instead of letting the suite go green for the wrong
  // reason.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/xenon/devices/MOCK-ANDROID-01/control');
  await page.waitForLoadState('networkidle');
  const toolbar = page.locator('.device-footer-actions');
  await expect(toolbar).toBeVisible();
  // Android renders 11 buttons; that count is what drives the 829px toolbar
  // width that causes the overflow. If this drops to 9 the mock is rendering as
  // iOS and the rest of this suite is not exercising the bug it claims to guard.
  await expect(toolbar.locator('> *')).toHaveCount(11);
});
