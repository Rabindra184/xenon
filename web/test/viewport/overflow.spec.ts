import { test, expect } from '@playwright/test';

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
});

for (const width of WIDTHS) {
  for (const route of ROUTES) {
    test(`no overflow at ${width}px on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await page.waitForLoadState('networkidle');

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
