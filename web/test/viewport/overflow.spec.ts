import { test, expect, Page } from '@playwright/test';

// COVERAGE BOUNDARY: every route below is now hermetic. The 11 data routes
// (overview, devices, builds, builds/:buildId, apps, selector-health,
// selector-health/detail, teams, users, api-keys, notifications) have their
// data endpoints route-mocked with deliberately WIDE/hostile payloads via
// ROUTE_DATA_MOCKS, and a per-route ROUTE_CONTENT_CHECKS assertion proves the
// route's canonical wide content actually mounted (not an empty-state div) —
// so the overflow scan below can no longer pass vacuously on a zero-row table.
// The control route keeps its own dedicated device mock + 11-button toolbar
// test (unchanged). The 3 static-form routes (maintenance, settings,
// ai-settings) render a fixed layout independent of any list data — the
// existing shell-nav check is already non-vacuous for them, so they have no
// entry in either map and are covered by the shell check alone.

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

// Reused across the /xenon/builds/:buildId mock AND the ROUTES entry AND every
// mocked session's build_id — a mismatch leaves selectedBuild null and the
// session table silently never mounts (see use-builds-data.ts:
// `data.builds.find((b) => b.id === data.selectedBuildId)`).
const BUILD_ID = 'build-9f3c2a71-8e4d-4b6a-a1c2-0d5e6f7a8b9c-nightly-regression';
// selector-health/detail returns early (renders nothing) with no ?value= param
// (selector-detail-page.tsx: `const value = params.get('value') ?? ''`).
const SELECTOR_DETAIL_VALUE = 'onboarding_carousel_primary_cta';

const ROUTES = [
  '/xenon/overview',
  '/xenon/devices',
  '/xenon/builds',
  `/xenon/builds/${BUILD_ID}`,
  '/xenon/apps',
  '/xenon/selector-health',
  `/xenon/selector-health/detail?value=${SELECTOR_DETAIL_VALUE}`,
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

  // Shared safety-net defaults for the data routes below: benign empty shapes
  // so ancillary fetches resolve cleanly against a running-but-empty server
  // instead of racing the live DB. Registered AFTER the mocks above (and
  // therefore losing precedence to them, and to any later per-route
  // `page.route()` call in a test body — Playwright matches most-recently-
  // registered-first) so the control-route device* mock keeps winning here,
  // and /xenon/overview, /xenon/devices, /xenon/api-keys, /xenon/teams can
  // still swap in hostile, populated payloads for the same globs.
  await page.route('**/xenon/api/session*', (route) => route.fulfill({ json: [] }));
  await page.route('**/xenon/api/queue/length*', (route) => route.fulfill({ json: 0 }));
  await page.route('**/xenon/api/queue/summary*', (route) =>
    route.fulfill({ json: { total: 0, byPlatform: {} } }),
  );
  await page.route('**/xenon/api/teams', (route) => route.fulfill({ json: [] }));
  await page.route('**/xenon/api/healing/events*', (route) =>
    route.fulfill({ json: { events: [], todayCount: 0 } }),
  );
});

// Per-route data mocks (applied BEFORE goto) and content assertions (applied
// AFTER the shell-nav + overflow checks). Keyed by the exact ROUTES string.
// Routes with no entry (the control route, and the 3 static-form routes) are
// untouched — `?.()` below no-ops for them, so the existing shell-nav +
// overflow assertions remain the whole test. Purely additive: nothing about
// the existing control-route flow changes.
type Setup = (page: Page) => Promise<void>;

const ROUTE_DATA_MOCKS: Record<string, Setup> = {
  '/xenon/overview': async (page) => {
    const now = Date.now();
    // Overrides the shared control-route device* mock for THIS page only
    // (fresh page + beforeEach re-registration per test, so it never leaks
    // into the control tests). Two hostile devices so FleetStatus has real
    // rows to render.
    await page.route('**/xenon/api/device*', (route) =>
      route.fulfill({
        json: [
          {
            udid: '00008110-00084CE80E51401E',
            name: "Rabindra's iPhone 15 Pro Max (Engineering Lab, Desk 14, Rack B)",
            platform: 'ios',
            sdk: '26.5.2',
            state: 'Booted',
            busy: false,
            offline: false,
            userBlocked: false,
            session_id: null,
            host: 'http://127.0.0.1:4723',
            screenWidth: '428',
            screenHeight: '926',
          },
          {
            udid: 'emulator-5554-google-pixel-tablet-longname',
            name: 'Pixel Tablet 11-inch — Android 14 QA Farm Node 7',
            platform: 'android',
            sdk: '14',
            state: 'device',
            busy: true,
            offline: false,
            userBlocked: false,
            session_id: 'manual_x',
            host: 'http://10.0.0.42:4723',
            screenWidth: '1600',
            screenHeight: '2560',
          },
        ],
      }),
    );
    // Sessions feed Active sessions KPI + Recent activity.
    await page.route('**/xenon/api/session*', (route) =>
      route.fulfill({
        json: [
          {
            id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
            status: 'running',
            startTime: new Date(now - 1800e3).toISOString(),
            endTime: null,
            failure_reason: null,
            device_udid: '00008110-00084CE80E51401E',
            device_platform: 'ios',
            device_version: '26.5.2',
            device_name: "Rabindra's iPhone 15 Pro Max",
            node_id: '9d7f3570-fe26-4cbf-8c42-69881b4c2377',
            desired_capabilities: '{}',
            session_capabilities: '{}',
            has_live_video: false,
            createdAt: new Date(now - 1800e3).toISOString(),
            updatedAt: new Date(now - 1800e3).toISOString(),
          },
          {
            id: 'f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4',
            status: 'failed',
            startTime: new Date(now - 7200e3).toISOString(),
            endTime: new Date(now - 7200e3).toISOString(),
            failure_reason: 'NoSuchElementError: selector not found',
            device_udid: 'emulator-5554-google-pixel-tablet-longname',
            device_platform: 'android',
            device_version: '14',
            device_name: 'Pixel Tablet 11-inch',
            node_id: '9d7f3570-fe26-4cbf-8c42-69881b4c2377',
            desired_capabilities: '{}',
            session_capabilities: '{}',
            has_live_video: false,
            createdAt: new Date(now - 7200e3).toISOString(),
            updatedAt: new Date(now - 7200e3).toISOString(),
          },
        ],
      }),
    );
    await page.route('**/xenon/api/healing/events*', (route) =>
      route.fulfill({
        json: {
          events: [
            {
              id: 'heal_01HZY9K3M4N5P6Q7R8S9T0V1W2',
              sessionId: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
              deviceUdid: '00008110-00084CE80E51401E',
              deviceName: "Rabindra's iPhone 15 Pro Max (Engineering Lab, Desk 14)",
              devicePlatform: 'ios',
              commandName: 'findElement',
              originalSelector:
                "//XCUIElementTypeButton[@name='checkout-submit-button-primary-cta']",
              healedSelector: "//XCUIElementTypeButton[@label='Checkout']",
              confidence: 0.94,
              tier: 'visual',
              isSuccess: true,
              createdAt: new Date(now - 600e3).toISOString(),
            },
          ],
          todayCount: 7,
        },
      }),
    );
  },

  '/xenon/devices': async (page) => {
    // Overrides device* for this page only; long names + a full 40-char iOS
    // UDID + a long android emulator udid + 3 tags stress the card grid.
    await page.route('**/xenon/api/device*', (route) =>
      route.fulfill({
        json: [
          {
            udid: '00008110-00084CE80E51401E',
            name: "Rabindra's iPhone 15 Pro Max (Engineering Lab, Desk 14, Rack B)",
            platform: 'ios',
            sdk: '26.5.2',
            state: 'Booted',
            busy: false,
            offline: false,
            userBlocked: false,
            teamId: null,
            tags: ['regression', 'nightly', 'golden-path'],
            session_id: null,
            host: 'http://127.0.0.1:4723',
            screenWidth: '428',
            screenHeight: '926',
          },
          {
            udid: 'emulator-5554-google-pixel-tablet-very-long-udid-string',
            name: 'Pixel Tablet 11-inch — Android 14 QA Farm Node 7 (Shared)',
            platform: 'android',
            sdk: '14',
            state: 'device',
            busy: true,
            offline: false,
            userBlocked: false,
            teamId: null,
            tags: ['perf'],
            session_id: 'manual_alice_emulator-5554',
            host: 'http://10.0.0.42:4723',
            screenWidth: '1600',
            screenHeight: '2560',
          },
        ],
      }),
    );
  },

  '/xenon/builds': async (page) => {
    // Bare array, no query string (getBuilds() has no cache-bust param).
    await page.route('**/xenon/api/build', (route) =>
      route.fulfill({
        json: [
          {
            id: 'build-9f3c2a71-8e4d-4b6a-a1c2-0d5e6f7a8b9c-nightly-regression',
            name: 'nightly-regression-suite-android-emulator-api34-2026-07-16T23:59:59Z-shard-07-of-12',
            createdAt: '2026-07-16T23:59:59.000Z',
            updatedAt: '2026-07-16T23:59:59.000Z',
            sessionCount: 9999,
            passedCount: 9312,
            failedCount: 642,
            runningCount: 45,
            _count: { sessions: 9999 },
          },
          {
            id: 'build-2b7e',
            name: 'smoke',
            createdAt: '2026-07-15T08:00:00.000Z',
            updatedAt: '2026-07-15T08:05:00.000Z',
            sessionCount: 0,
            passedCount: 0,
            failedCount: 0,
            runningCount: 0,
            _count: { sessions: 0 },
          },
        ],
      }),
    );
  },

  [`/xenon/builds/${BUILD_ID}`]: async (page) => {
    // The :buildId in the goto URL must byte-equal a build.id here, else
    // selectedBuild is null and the session table never mounts.
    await page.route('**/xenon/api/build', (route) =>
      route.fulfill({
        json: [
          {
            id: BUILD_ID,
            name: 'nightly-regression-suite-android-emulator-api34-shard-07-of-12',
            createdAt: '2026-07-16T23:59:59.000Z',
            updatedAt: '2026-07-16T23:59:59.000Z',
            sessionCount: 2,
            passedCount: 0,
            failedCount: 1,
            runningCount: 1,
            _count: { sessions: 2 },
          },
        ],
      }),
    );
    await page.route('**/xenon/api/session*', (route) =>
      route.fulfill({
        json: [
          {
            id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
            build_id: BUILD_ID,
            name: 'com.example.app.tests.checkout.LongRunningCheckoutFlowWithCouponAndGiftCardEdgeCaseTest#shouldApplyStackedDiscounts',
            status: 'failed',
            desired_capabilities: '{}',
            session_capabilities: '{}',
            // Real node_id is always a uuidv4() (src/services/ServerManager.ts:
            // `const nodeId = uuidv4()`), never an arbitrary-length operator
            // string — a realistic-but-still-nontrivial UUID, not an
            // artificially inflated one, is the representative stressor here.
            node_id: '9d7f3570-fe26-4cbf-8c42-69881b4c2377',
            has_live_video: false,
            startTime: '2026-07-16T23:40:11.000Z',
            endTime: '2026-07-16T23:52:47.000Z',
            failure_reason:
              "NoSuchElementException: An element could not be located on the page using the given search parameters (//android.widget.Button[@resource-id='com.example:id/checkout_confirm']) after 6-tier self-healing escalation exhausted",
            failure_category: 'selector_not_found',
            device_udid: 'emulator-5554-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
            device_platform: 'android',
            device_version: '14.0',
            device_name: 'Google Pixel 8 Pro (Android 14, API 34, arm64) - Lab Rack B Slot 12',
            createdAt: '2026-07-16T23:40:11.000Z',
            updatedAt: '2026-07-16T23:52:47.000Z',
          },
          {
            id: 'f9e8d7c6-b5a4-4938-2716-0f5e4d3c2b1a',
            build_id: BUILD_ID,
            name: 'com.example.app.tests.login.SmokeTest#loginHappyPath',
            status: 'running',
            desired_capabilities: '{}',
            session_capabilities: '{}',
            node_id: 'node-02',
            has_live_video: true,
            startTime: '2026-07-16T23:58:00.000Z',
            endTime: null,
            device_udid: '00008120-000A1B2C3D4E5F26',
            device_platform: 'ios',
            device_version: '17.5.1',
            device_name: 'iPhone 15 Pro Max (iOS 17.5.1) - Lab Rack A',
            createdAt: '2026-07-16T23:58:00.000Z',
            updatedAt: '2026-07-16T23:58:00.000Z',
          },
        ],
      }),
    );
  },

  '/xenon/apps': async (page) => {
    // Bare array. device* stays shared — the deploy flyout <select> reads it
    // but rows don't gate on it.
    await page.route('**/xenon/api/apps', (route) =>
      route.fulfill({
        json: [
          {
            id: '824b897d-6fad-4fb5-9c3a-47a261529c6c',
            name: 'com.acme.enterprise.superlongbundlename.qa.regression.build-2026.07.16-nightly.apk',
            filename: 'app.apk',
            filepath: '/x',
            mimetype: 'application/octet-stream',
            size: 734003200,
            packageName: 'com.acme.enterprise.superlongbundlename.internal.qa.staging.candidate',
            version: '12.34.5678-rc.9',
            platform: 'android',
            md5: 'b12cade945f99bd4af8714ce6e629d94',
            createdAt: '2026-07-16T08:31:37.013Z',
            updatedAt: '2026-07-16T08:31:37.013Z',
          },
          {
            id: 'aa11',
            name: 'wda-signed.ipa',
            filename: 'wda-signed.ipa',
            filepath: '/y',
            mimetype: 'application/octet-stream',
            size: 6605137,
            packageName: null,
            version: null,
            platform: 'ios',
            md5: 'c0ffee',
            createdAt: '2026-07-16T08:31:37.013Z',
            updatedAt: '2026-07-16T08:31:37.013Z',
          },
        ],
      }),
    );
  },

  '/xenon/selector-health': async (page) => {
    // Both are OBJECT envelopes; the wide 9-col grid iterates .hotspots.
    // state:null keeps rows in the 'active' bucket (default tab — no ?tab
    // param means tab='active', selector-health-page.tsx:245).
    await page.route('**/xenon/api/healing/hotspots*', (route) =>
      route.fulfill({
        json: {
          windowDays: 30,
          totalScanned: 42,
          filters: { tier: null, platform: null, status: 'active' },
          hotspots: [
            {
              originalStrategy: '-android uiautomator',
              originalSelector:
                'new UiSelector().resourceId("com.acme.enterprise.superapp:id/onboarding_carousel_primary_cta_button_container").childSelector(new UiSelector().className("android.widget.TextView"))',
              healCount: 137,
              sessionCount: 48,
              topTier: 'Visual AI',
              suggestedRewrite:
                "//android.widget.Button[@content-desc='Get Started Now — Continue To Account Setup Wizard Step One']",
              suggestedStrategy: 'xpath',
              suggestedRewriteShare: 0.82,
              averageConfidence: 0.9137,
              firstHealedAt: '2026-06-20T10:15:00.000Z',
              lastHealedAt: '2026-07-16T09:42:11.000Z',
              state: null,
            },
            {
              originalStrategy: 'accessibility id',
              originalSelector:
                'login_screen_username_text_field_with_an_extremely_long_accessibility_identifier_that_stresses_the_selector_column',
              healCount: 3,
              sessionCount: 2,
              topTier: 'LLM',
              suggestedRewrite: '~username',
              suggestedStrategy: 'accessibility id',
              suggestedRewriteShare: 0.5,
              averageConfidence: 0.42,
              firstHealedAt: '2026-07-10T00:00:00.000Z',
              lastHealedAt: '2026-07-15T23:59:00.000Z',
              state: null,
            },
          ],
        },
      }),
    );
    await page.route('**/xenon/api/healing/summary*', (route) =>
      route.fulfill({
        json: {
          windowDays: 30,
          current: {
            totalHeals: 140,
            distinctSelectors: 57,
            sessionsTouched: 48,
            byTier: { 'Visual AI': 90, LLM: 20, OCR: 30 },
            estCostUsd: 12.44,
          },
          prior: {
            totalHeals: 100,
            distinctSelectors: 40,
            sessionsTouched: 30,
            byTier: { LLM: 10 },
            estCostUsd: 6.1,
          },
          resolvedCount: 4,
          pendingCount: 2,
        },
      }),
    );
  },

  [`/xenon/selector-health/detail?value=${SELECTOR_DETAIL_VALUE}`]: async (page) => {
    // Flat object; the 7-col timeline grid iterates .timeline.
    await page.route('**/xenon/api/healing/selector*', (route) =>
      route.fulfill({
        json: {
          originalSelector:
            'new UiSelector().resourceId("com.acme.enterprise.superapp:id/onboarding_carousel_primary_cta_button_container")',
          windowDays: 30,
          healCount: 2,
          sessionCount: 2,
          estCostUsd: 0.44,
          byTier: { 'Visual AI': 1, LLM: 1 },
          byPlatform: { android: 2 },
          byBuild: [{ buildId: 'ci-nightly-regression-suite-2026-07-16-build-8842', count: 2 }],
          alternates: [
            {
              healedSelector: "//android.widget.Button[@content-desc='Get Started Now']",
              count: 2,
              share: 1,
              averageConfidence: 0.91,
              tiers: ['Visual AI'],
            },
          ],
          timeline: [
            {
              id: 'log_01HZY9X8Q7K3M2N4P5R6S7T8U9',
              sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              buildId: 'ci-nightly-regression-suite-2026-07-16-build-8842',
              deviceUdid: 'emulator-5554-pixel7pro-android14-arm64-node03',
              deviceName: 'Pixel 7 Pro (Android 14) — CI Farm Node 03 Slot A',
              devicePlatform: 'android',
              commandName: 'findElement',
              healedSelector:
                "//android.widget.Button[@content-desc='Get Started Now — Continue To Account Setup Wizard Step One Of Five']",
              confidence: 0.9137,
              tier: 'Visual AI',
              isSuccess: true,
              createdAt: '2026-07-16T09:42:11.000Z',
            },
            {
              id: 'log_01HZY9X8Q7K3M2N4P5R6S7T8V0',
              sessionId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
              buildId: 'ci-nightly-regression-suite-2026-07-15-build-8790',
              deviceUdid: '00008120-000A1B2C3D4E5F6G',
              deviceName: 'iPhone 15 Pro Max — Lab Rack 2',
              devicePlatform: 'ios',
              commandName: 'findElement',
              healedSelector: '**/XCUIElementTypeButton[`label == "Get Started"`]',
              confidence: 0.42,
              tier: 'LLM',
              isSuccess: true,
              createdAt: '2026-07-15T18:03:00.000Z',
            },
          ],
        },
      }),
    );
  },

  '/xenon/teams': async (page) => {
    // Overrides the shared empty teams* mock with a populated bare array.
    await page.route('**/xenon/api/teams', (route) =>
      route.fulfill({
        json: [
          {
            id: '11111111-2222-3333-4444-555555555555',
            name: 'android-regression-fleet-emea-staging-longteamname',
            createdAt: '2026-07-16T06:46:13.234Z',
            deviceCount: 42,
            memberCount: 13,
          },
          {
            id: '66666666-7777-8888-9999-000000000000',
            name: 'ios-ci',
            createdAt: '2026-07-15T00:00:00.000Z',
            deviceCount: 0,
            memberCount: 1,
          },
        ],
      }),
    );
  },

  '/xenon/users': async (page) => {
    // Fetched as '/xenon/api/users/' (trailing slash — listUsers does fetch(`${BASE}/`)).
    // The glob MUST include the slash before the star: Playwright compiles a single `*`
    // to `[^/]*`, so `users*` cannot consume the trailing `/` and never matches, which
    // would silently fall back to ambient server data — the exact vacuous-pass this guard
    // exists to prevent. `users/*` matches the trailing slash (and any `?query`) but not
    // sub-resource paths like `/users/:id/...`.
    await page.route('**/xenon/api/users/*', (route) =>
      route.fulfill({
        json: [
          {
            id: 'd645e82e-9c98-408c-a808-79b8328fe69b',
            email: 'bootstrap.super.administrator.longaddress@enterprise-staging.example.com',
            name: 'Bootstrap Super Administrator With A Very Long Display Name',
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            createdAt: '2026-07-16T06:46:13.234Z',
            lastLoginAt: '2026-07-16T09:12:00.000Z',
          },
          {
            id: 'u2',
            email: 'member@x.io',
            name: 'Member Two',
            role: 'MEMBER',
            status: 'INACTIVE',
            createdAt: '2026-07-15T00:00:00.000Z',
            lastLoginAt: null,
          },
        ],
      }),
    );
  },

  '/xenon/api-keys': async (page) => {
    // Bare array — the canonical 8-col wide table. Also overrides the shared
    // teams mock so the teamId pill resolves to a name instead of an id slice.
    await page.route('**/xenon/api/apikeys', (route) =>
      route.fulfill({
        json: [
          {
            id: 'key_9f8e7d6c5b4a3f2e1d0c',
            name: 'ci-main-runner-emea-staging-longkeyname-2026',
            scopes: 'read,sessions,devices,admin',
            rateLimit: 1200,
            createdAt: '2026-07-16T06:46:13.234Z',
            lastUsedAt: '2026-07-16T09:59:00.000Z',
            expiresAt: '2027-07-16T00:00:00.000Z',
            teamId: '11111111-2222-3333-4444-555555555555',
          },
          {
            id: 'key_shared',
            name: 'local-dev',
            scopes: 'read',
            rateLimit: 300,
            createdAt: '2026-07-10T00:00:00.000Z',
            lastUsedAt: null,
            expiresAt: null,
            teamId: null,
          },
        ],
      }),
    );
    await page.route('**/xenon/api/teams', (route) =>
      route.fulfill({
        json: [
          {
            id: '11111111-2222-3333-4444-555555555555',
            name: 'android-regression-fleet-emea-staging-longteamname',
            createdAt: '2026-07-16T06:46:13.234Z',
            deviceCount: 42,
            memberCount: 13,
          },
        ],
      }),
    );
  },

  '/xenon/notifications': async (page) => {
    // Bare array. events is a JSON-STRINGIFIED array (component JSON.parses
    // it) — keep it a string, not a nested array.
    await page.route('**/xenon/api/webhook', (route) =>
      route.fulfill({
        json: [
          {
            id: 'wh_1',
            url: 'https://hooks.slack.com/services/T00000000/B11111111/verylongtokensegmentXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
            type: 'slack',
            events: '["device_offline","session_failed","device_new","selector_health_digest"]',
            active: true,
            payloadTemplate: '{ "text": "{{udid}} offline" }',
          },
          {
            id: 'wh_2',
            url: 'https://example.com/webhook',
            type: 'slack',
            events: '["device_new"]',
            active: true,
          },
        ],
      }),
    );
  },
};

const ROUTE_CONTENT_CHECKS: Record<string, Setup> = {
  '/xenon/overview': async (page) => {
    // Overview always mounts chrome (KPI cards + section headers) even on an
    // empty DB, so a shell check alone would pass vacuously — assert the
    // row-gated FleetStatus rows instead. FleetStatus renders 'No devices
    // registered.' with zero devices, so this fails loudly without the mock.
    const fleetRows = page
      .locator('section', { hasText: 'Fleet status' })
      .getByRole('button', { name: /READY|BUSY|OFFLINE|RESERVED/ });
    await expect(fleetRows).not.toHaveCount(0);
    // Secondary: RecentActivity renders 'No activity yet' with zero heals.
    const activityRows = page
      .locator('section', { hasText: 'Recent activity' })
      .locator('div.divide-y > div');
    await expect(activityRows).not.toHaveCount(0);
  },

  '/xenon/devices': async (page) => {
    // Empty DB renders .device-explorer-empty instead of the card grid.
    await expect(page.locator('.device-explorer-card-container')).toHaveCount(1);
    await expect(page.locator('.device-explorer-card-container .dc2')).not.toHaveCount(0);
  },

  '/xenon/builds': async (page) => {
    // The route mock seeds builds, so the rail must render at least one
    // build-row button (an empty rail would make the overflow check vacuous).
    await expect(page.locator('aside.w-\\[280px\\] button[type="button"]')).not.toHaveCount(0);
  },

  [`/xenon/builds/${BUILD_ID}`]: async (page) => {
    // Empty session mock -> 'No sessions in this build yet.' with no <table>.
    await expect(page.locator('section.flex-1 table tbody tr')).not.toHaveCount(0);
  },

  '/xenon/apps': async (page) => {
    // .registry-table-header + .artifact-row only mount when
    // filteredApps.length > 0 (apps.tsx).
    await expect(page.locator('.artifact-row')).not.toHaveCount(0);
  },

  '/xenon/selector-health': async (page) => {
    // .sh-table/.sh-table__head/.sh-table__row only mount when
    // hotspots.length > 0; empty renders <EmptyState> instead.
    await expect(page.locator('.sh-table__head')).toBeVisible();
    await expect(page.locator('.sh-table__row')).not.toHaveCount(0);
  },

  [`/xenon/selector-health/detail?value=${SELECTOR_DETAIL_VALUE}`]: async (page) => {
    // The Timeline section + .sh-timeline__row only render when
    // detail.timeline is non-empty.
    await expect(page.locator('.sh-timeline__row')).not.toHaveCount(0);
  },

  '/xenon/teams': async (page) => {
    // Empty DB renders .empty-state instead of the card grid.
    await expect(page.locator('.team-card')).not.toHaveCount(0);
  },

  '/xenon/users': async (page) => {
    // Empty DB renders a 'No users' placeholder, no <table>.
    await expect(page.locator('table.w-full tbody tr')).not.toHaveCount(0);
  },

  '/xenon/api-keys': async (page) => {
    // ui/Table renders class .tbl; empty DB renders .empty-state instead.
    await expect(page.locator('.data-card .tbl tbody tr')).not.toHaveCount(0);
  },

  '/xenon/notifications': async (page) => {
    // The 'Add a new webhook' form always renders, so only the data list
    // (.webhook-list-grid > .webhook-row-card) can be vacuous.
    await expect(page.locator('.webhook-row-card')).not.toHaveCount(0);
  },
};

for (const width of WIDTHS) {
  for (const route of ROUTES) {
    test(`no overflow at ${width}px on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // Route-mock this route's data endpoints (if any) BEFORE navigating, so
      // the very first render already has the populated/hostile payload.
      // No-op for the control route and the 3 static-form routes.
      await (ROUTE_DATA_MOCKS[route]?.(page) ?? Promise.resolve());
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

      // Non-vacuity gate: prove this route's canonical wide content actually
      // rendered populated (not an empty-state placeholder), so the overflow
      // scan above had real rows/grids to measure. No-op for the control
      // route and the 3 static-form routes.
      await (ROUTE_CONTENT_CHECKS[route]?.(page) ?? Promise.resolve());
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
          .map(
            (o) =>
              `  ${o.tag}.${o.cls} rightOverflow=${o.rightOverflowPx}px leftOverflow=${o.leftOverflowPx}px`,
          )
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
