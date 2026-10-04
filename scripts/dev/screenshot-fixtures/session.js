/**
 * A sample finished session for the dashboard screenshots: a made-up
 * "Checkout: pay by saved card" test that passed on the Pixel 8 Pro, with its
 * build, command log, device and debug logs and CPU and memory figures.
 *
 * Every time is a fixed instant, so the pictures don't change from run to run
 * (the script gives the browser the UTC time zone, so they don't change from
 * machine to machine either).
 */

const SESSION_ID = 'f3a91c5e-7d2b-4e08-9a64-0b8c1d2e3f47';
const BUILD_ID = 'bld-42';
const UDID = '28141FDH2000AB';
const APP = 'com.example.shop';
/** The recording's file name; the script serves a WebM under it. */
const VIDEO_FILE = 'session.webm';

/** 2026-10-04 02:14:09 UTC. */
const START = Date.UTC(2026, 9, 4, 2, 14, 9);
/** The session lasted 2 min 38 s. */
const DURATION_MS = 158_500;
const iso = (ms) => new Date(ms).toISOString();

const BUILD = {
  id: BUILD_ID,
  name: 'nightly-2026-10-04',
  createdAt: iso(START - 4 * 60_000),
  updatedAt: iso(START + DURATION_MS),
  sessionCount: 1,
  passedCount: 1,
  failedCount: 0,
  runningCount: 0,
};

const CAPABILITIES = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': 'Pixel 8 Pro',
  'appium:platformVersion': '15',
  'appium:appPackage': APP,
  'appium:appActivity': '.home.HomeActivity',
  'appium:newCommandTimeout': 120,
  'xe:options': { name: 'Checkout: pay by saved card', build: 'nightly-2026-10-04' },
};

const SESSION = {
  id: SESSION_ID,
  build_id: BUILD_ID,
  name: 'Checkout: pay by saved card',
  status: 'passed',
  desired_capabilities: JSON.stringify(CAPABILITIES),
  session_capabilities: JSON.stringify({
    ...CAPABILITIES,
    'appium:udid': UDID,
    'appium:deviceScreenSize': '1344x2992',
    'appium:deviceApiLevel': 35,
  }),
  node_id: 'lab-mac-01',
  has_live_video: false,
  video_recording_enabled: true,
  video_recording: `${SESSION_ID}/video/${VIDEO_FILE}`,
  startTime: iso(START),
  endTime: iso(START + DURATION_MS),
  failure_reason: null,
  failure_category: null,
  ai_analysis: null,
  tags: null,
  device_udid: UDID,
  device_platform: 'android',
  device_version: '15',
  device_name: 'Pixel 8 Pro',
  performance_trace: null,
  createdAt: iso(START),
  updatedAt: iso(START + DURATION_MS),
  owner: { name: 'Priya', email: 'priya@example.com' },
  ranOn: 'here',
};

/**
 * [end offset in seconds, command, duration in ms, extra fields]: oldest
 * first. A row is written as its command ends. The one healed command is a
 * find whose id changed from `btn_pay` to `btn_pay_now`.
 */
const STEPS = [
  [9.4, 'findElement', 410, { body: ['id', `${APP}:id/cart_checkout`] }],
  [10.9, 'click', 92, {}],
  [24.7, 'findElement', 288, { body: ['id', `${APP}:id/saved_card_visa`] }],
  [26.2, 'click', 84, {}],
  [38.8, 'getText', 71, {}],
  [
    55.3,
    'findElement',
    1942,
    {
      body: ['id', `${APP}:id/btn_pay`],
      healed: {
        from: ['id', `${APP}:id/btn_pay`],
        to: ['id', `${APP}:id/btn_pay_now`],
        tier: 'Fuzzy XML',
        confidence: 0.91,
      },
    },
  ],
  [57.0, 'click', 104, {}],
  [88.6, 'findElement', 11_206, { body: ['id', `${APP}:id/order_confirmation`] }],
  [90.2, 'getText', 64, {}],
  [96.5, 'getScreenshot', 188, {}],
  [112.0, 'findElement', 297, { body: ['id', `${APP}:id/order_number`] }],
  [113.5, 'getText', 58, {}],
  [131.8, 'getPageSource', 641, {}],
  [158.4, 'deleteSession', 1204, {}],
];

const titleOf = (name) => name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const pathOf = (name) =>
  ({
    findElement: '/element',
    click: '/element/e1/click',
    getText: '/element/e1/text',
    getScreenshot: '/screenshot',
    getPageSource: '/source',
    deleteSession: '',
  })[name] ?? '';

/** The command log as GET /session/:id/session_log answers it: newest first. */
const COMMANDS = STEPS.map(([end, name, duration, extra], i) => {
  const at = iso(START + Math.round(end * 1000));
  const heal = extra.healed;
  return {
    id: `cmd-${String(i + 1).padStart(2, '0')}`,
    session_id: SESSION_ID,
    command_name: name,
    url: `/wd/hub/session/${SESSION_ID}${pathOf(name)}`,
    method:
      name === 'deleteSession'
        ? 'DELETE'
        : name === 'getText' || name === 'getPageSource' || name === 'getScreenshot'
          ? 'GET'
          : 'POST',
    title: titleOf(name),
    subtitle: '',
    body: JSON.stringify(extra.body ?? {}),
    response: JSON.stringify({ value: null }),
    screenshot: null,
    is_success: true,
    is_error: false,
    is_healed: !!heal,
    original_strategy: heal ? heal.from[0] : (extra.body?.[0] ?? null),
    original_selector: heal ? heal.from[1] : (extra.body?.[1] ?? null),
    healed_strategy: heal ? heal.to[0] : null,
    healed_selector: heal ? heal.to[1] : null,
    healing_tier: heal ? heal.tier : null,
    healing_confidence: heal ? heal.confidence : null,
    duration,
    createdAt: at,
    updatedAt: at,
  };
}).reverse();

const LOG_LINES = [
  [1.2, 'DEVICE', 'I/ActivityTaskManager: START u0 {cmp=com.example.shop/.home.HomeActivity}'],
  [8.7, 'DEVICE', 'D/ShopCheckout: CartViewModel: 3 items, subtotal=145.50 USD'],
  [52.1, 'DEVICE', 'W/chromium: [WARNING:CONSOLE(1)] "Slow payment: 9.3s from tap to capture"'],
  [88.0, 'DEVICE', 'I/ShopCheckout: payment captured paymentId=pay_3f9a2c attempt=3'],
  [0.4, 'DEBUG', 'Session started on Pixel 8 Pro (Android 15)'],
  [
    55.2,
    'DEBUG',
    'Selector id=com.example.shop:id/btn_pay not found; healed by Fuzzy XML to id=com.example.shop:id/btn_pay_now (91%)',
  ],
  [158.2, 'DEBUG', 'Session finished: passed'],
];
const logRows = (type) =>
  LOG_LINES.filter(([, t]) => t === type).map(([at, t, message], i) => ({
    id: `log-${type.toLowerCase()}-${i + 1}`,
    session_id: SESSION_ID,
    log_type: t,
    message,
    timestamp: iso(START + Math.round(at * 1000)),
    createdAt: iso(START + Math.round(at * 1000)),
    updatedAt: iso(START + Math.round(at * 1000)),
  }));
const DEVICE_LOGS = logRows('DEVICE');
const DEBUG_LOGS = logRows('DEBUG');

const clamp = (lo, hi, v) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
/** A smooth bump: `height` at sample `at`, fading over about `width` samples. */
const bump = (i, at, width, height) => height * Math.exp(-(((i - at) / width) ** 2));

/**
 * 80 samples, one every 2 s, as GET /session/:id/metrics answers them. The
 * device's CPU stays between 15 and 45 %, the app's between 5 and 25 %,
 * with a rise as the app opens and another as the payment goes through. The
 * first sample has no CPU: it comes from the change since the one before.
 */
const SAMPLES = Array.from({ length: 80 }, (_, i) => {
  const deviceCpu =
    27 +
    7 * Math.sin(i * 0.18) +
    3 * Math.sin(i * 0.55 + 1.3) +
    bump(i, 4, 3, 7) +
    bump(i, 43, 5, 9);
  const appCpu =
    11 +
    4 * Math.sin(i * 0.21 + 0.7) +
    2 * Math.sin(i * 0.6) +
    bump(i, 5, 3, 7) +
    bump(i, 43, 5, 6);
  const progress = i / 79;
  return {
    t: START + 300 + i * 2000,
    deviceCpu: i === 0 ? null : round1(clamp(15, 45, deviceCpu)),
    deviceMemMb: Math.round(5320 + 24 * Math.sin(i * 0.13) + 0.9 * i),
    deviceMemTotalMb: 11776,
    appCpu: i === 0 ? null : round1(clamp(5, 25, appCpu)),
    appMemMb: round1(290 + 50 * (progress * (2 - progress)) + 2 * Math.sin(i * 0.9)),
    app: APP,
  };
});

const METRICS = {
  platform: 'android',
  intervalMs: 2000,
  appId: APP,
  series: { deviceCpu: true, deviceMem: true, appCpu: true, appMem: true },
  recording: null,
  samples: SAMPLES,
};

module.exports = {
  SESSION_ID,
  BUILD_ID,
  UDID,
  VIDEO_FILE,
  BUILD,
  SESSION,
  COMMANDS,
  DEVICE_LOGS,
  DEBUG_LOGS,
  METRICS,
};
