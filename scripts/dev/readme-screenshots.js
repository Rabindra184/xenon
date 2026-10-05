#!/usr/bin/env node
/**
 * Takes the dashboard screenshots the README and the documentation site show.
 *
 *   README:  assets/dashboard-{dark,light}.png (the Devices page)
 *   Site:    website/static/img/screens/{devices,device-control,session}-{dark,light}.webp
 *            (the Devices page, a phone's Logs tab in device control, and a
 *            finished session's page), 1600 px wide
 *
 * Serves the built dashboard (web/build) at /xenon/ and answers its API calls
 * with sample data, so no server, database or phone is needed and the
 * pictures are the same on every machine. The sample phone's screen is
 * screenshot-fixtures/phone-screen.html: the live preview shows it, and a
 * two-second recording made from it plays in the session's page. The sample
 * session and log lines are in screenshot-fixtures/.
 *
 * The site's pictures are captured at 2x (2880 px wide) and shrunk to 1600 px
 * WebP, which is what a 1200 px column needs and a sixth of the weight. The
 * bundled ffmpeg has no WebP encoder, so Chromium does it: the capture is drawn
 * to a canvas and read back as WebP (see toWebp).
 *
 *   cd web && npm run build && cd ..
 *   node scripts/dev/readme-screenshots.js
 *
 * Uses web/'s Playwright and the bundled ffmpeg (for the recording). Set
 * CHROME_BIN to use a particular Chromium.
 */
/* eslint-disable @typescript-eslint/no-var-requires -- a plain Node script, run without a build */
/* global document, Image, localStorage -- used inside the page, by Playwright */
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(ROOT, 'web', 'build');
const ASSETS = path.join(ROOT, 'assets');
const SCREENS = path.join(ROOT, 'website', 'static', 'img', 'screens');
const FIXTURES = path.join(__dirname, 'screenshot-fixtures');
const SITE_IMAGE_WIDTH = 1600;
const SITE_IMAGE_QUALITY = 0.85;
const PORT = 5179;
const BASE = `http://127.0.0.1:${PORT}`;

const { chromium } = require(path.join(ROOT, 'web', 'node_modules', 'playwright'));
const { logcatRecords } = require('./screenshot-fixtures/logcat');
const sample = require('./screenshot-fixtures/session');

if (!fs.existsSync(path.join(BUILD, 'index.html'))) {
  console.error('web/build is missing: run `npm run build` in web/ first.');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/** The built dashboard, with index.html for every route it handles itself. */
const server = http.createServer((req, res) => {
  const requested = decodeURIComponent(req.url.split('?')[0]).replace(/^\/xenon/, '');
  let file = path.join(BUILD, requested);
  if (!file.startsWith(BUILD) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(BUILD, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const now = Date.now();
const MINUTE = 60_000;
const base = {
  host: 'http://10.0.4.21:4723',
  state: 'device',
  busy: false,
  userBlocked: false,
  offline: false,
  session_id: null,
  healthStatus: 'Healthy',
  thermalStatus: 'Normal',
  teamId: null,
  teamName: null,
  tags: [],
  reservedBy: null,
  reservedUntil: null,
  reservationReason: null,
  totalUtilizationTimeMilliSec: 0,
  total_session_count: 0,
  sessionStartTime: 0,
};

const DEVICES = [
  {
    ...base,
    udid: '28141FDH2000AB',
    name: 'Pixel 8 Pro',
    platform: 'android',
    sdk: '15',
    deviceType: 'real',
    realDevice: true,
    batteryLevel: 92,
    tags: ['payments'],
    // Device control draws the live preview at this size.
    screenWidth: '1344',
    screenHeight: '2992',
  },
  {
    ...base,
    udid: '00008120-001A2B3C4D5E6F01',
    name: 'iPhone 15',
    platform: 'ios',
    sdk: '18.1',
    deviceType: 'real',
    realDevice: true,
    batteryLevel: 78,
    busy: true,
    session_id: 'b6f0c3e8-8d1a-4f5b-9c7e-1a2b3c4d5e6f',
    sessionStartTime: now - 6 * MINUTE,
  },
  {
    ...base,
    udid: 'R5CT32ABCDE',
    name: 'Galaxy S24',
    platform: 'android',
    sdk: '14',
    deviceType: 'real',
    realDevice: true,
    batteryLevel: 64,
    busy: true,
    session_id: 'c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    sessionStartTime: now - 2 * MINUTE,
    host: 'http://10.0.4.22:4723',
  },
  {
    ...base,
    udid: '00008110-000A1C2E3F4B5D6E',
    name: 'iPhone 14 Pro',
    platform: 'ios',
    sdk: '17.6',
    deviceType: 'real',
    realDevice: true,
    batteryLevel: 100,
    reservedBy: 'Priya',
    reservedUntil: now + 90 * MINUTE,
    reservationReason: 'Release checkout',
    host: 'http://10.0.4.22:4723',
  },
  {
    ...base,
    udid: 'emulator-5554',
    name: 'Pixel 7 API 34',
    platform: 'android',
    sdk: '14',
    deviceType: 'emulator',
    realDevice: false,
    batteryLevel: 100,
  },
  {
    ...base,
    udid: '7A1C9E52-3B4D-4F6A-8C2E-1D0F9B8A7C65',
    name: 'iPad Air (5th generation)',
    platform: 'ios',
    sdk: '18.1',
    deviceType: 'simulator',
    realDevice: false,
    state: 'Booted',
  },
];

const ME = {
  userId: 'u-admin',
  role: 'SUPER_ADMIN',
  scopes: 'admin,devices,sessions,read',
  teamId: null,
  name: 'Lab admin',
  email: 'admin@example.com',
};

/** Sample answers for the calls the Devices page makes; an empty object for the rest. */
function answer(apiPath) {
  if (apiPath === '/auth/me') return ME;
  if (apiPath === '/devices' || apiPath.startsWith('/device')) return DEVICES;
  if (apiPath === '/queue/length') return 0;
  if (apiPath === '/queue/summary') return { total: 0, byPlatform: {}, otherCount: 0 };
  if (apiPath === '/queue' || apiPath === '/teams') return [];
  if (apiPath === '/build') return [sample.BUILD];
  if (apiPath.startsWith('/session')) return [];
  if (apiPath.startsWith('/healing/events')) return { events: [], todayCount: 0 };
  return {};
}

/** Calls a page made that nothing above answers: listed after each picture, to spot a missing sample. */
const unanswered = new Set();

/**
 * Answers one /xenon/api call, or aborts it. `phone` holds the sample phone's
 * screen as a JPEG and the session's recording as a WebM.
 */
async function handleApi(route, phone) {
  const request = route.request();
  const apiPath = new URL(request.url()).pathname.replace('/xenon/api', '');
  const method = request.method();

  // Device control, for the sample Android phone. The live preview is a still
  // JPEG, which an <img> shows as a stream that has just loaded.
  const control = apiPath.match(/^\/control\/([^/]+)\/(.+)$/);
  if (control && decodeURIComponent(control[1]) === sample.UDID) {
    const action = control[2];
    if (action === 'stream' && method === 'GET') {
      return route.fulfill({ contentType: 'image/jpeg', body: phone.jpeg });
    }
    if (action === 'stream/start') return route.fulfill({ json: { success: true, type: 'mjpeg' } });
    if (action === 'stream/ticket')
      return route.fulfill({ json: { ticket: 'sample', expiresIn: 60 } });
    if (action === 'stream/leave') return route.fulfill({ json: {} });
    if (action === 'display') return route.fulfill({ json: { state: 'on' } });
    if (action.startsWith('stream')) return route.abort();
  } else if (apiPath.includes('/stream')) {
    return route.abort();
  }

  // The sample session's page.
  const session = apiPath.match(/^\/session\/([^/]+)(?:\/(.+))?$/);
  if (session && session[1] === sample.SESSION_ID) {
    const part = session[2] ?? '';
    if (part === '') return route.fulfill({ json: sample.SESSION });
    if (part === 'session_log') return route.fulfill({ json: sample.COMMANDS });
    if (part === 'logs/device') return route.fulfill({ json: sample.DEVICE_LOGS });
    if (part === 'logs/debug') return route.fulfill({ json: sample.DEBUG_LOGS });
    if (part === 'profiling') return route.fulfill({ json: [] });
    if (part === 'metrics') return route.fulfill({ json: sample.METRICS });
    if (part === `asset/video/${sample.VIDEO_FILE}`) {
      return route.fulfill({ contentType: 'video/webm', body: phone.webm });
    }
  }
  // No network capture for it: the page says so.
  if (apiPath === `/interceptor/sessions/${sample.SESSION_ID}/requests`) {
    return route.fulfill({ status: 404, json: { error: 'No capture for this session' } });
  }

  const body = answer(apiPath);
  if (JSON.stringify(body) === '{}') unanswered.add(`${method} ${apiPath}`);
  return route.fulfill({ json: body });
}

/**
 * The sample phone's screen, as the live preview's JPEG and as a 2-second
 * WebM (VP9, which the bundled ffmpeg encodes and every Chromium plays).
 */
async function preparePhone(browser, workDir) {
  const page = await browser.newPage({ viewport: { width: 1344, height: 2992 } });
  await page.setContent(fs.readFileSync(path.join(FIXTURES, 'phone-screen.html'), 'utf8'));
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 85 });
  await page.close();

  const still = path.join(workDir, 'phone.jpg');
  const video = path.join(workDir, sample.VIDEO_FILE);
  fs.writeFileSync(still, jpeg);
  execFileSync(
    require(path.join(ROOT, 'node_modules', '@ffmpeg-installer', 'ffmpeg')).path,
    [
      ...['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '10', '-i', still, '-t', '2'],
      ...['-vf', 'scale=448:996', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40'],
      ...['-pix_fmt', 'yuv420p', '-deadline', 'realtime', '-cpu-used', '8', video],
    ],
    { stdio: 'inherit' },
  );
  return { jpeg, webm: fs.readFileSync(video) };
}

/** A browser context in the theme, its page answering the dashboard's calls from the samples. */
async function openPage(browser, theme, viewport, phone) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: theme,
    // Log lines and sessions show local times: fix them.
    timezoneId: 'UTC',
    locale: 'en-US',
  });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('xenon.theme', t);
    } catch {
      // The dashboard follows colorScheme without it.
    }
  }, theme);
  const page = await context.newPage();
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/xenon/api/**', (route) => handleApi(route, phone));
  return { context, page };
}

/**
 * The live-updates badge says "Connecting" here only because the socket is
 * blocked; hide it rather than picture a connection problem.
 */
async function hideConnectingBadge(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('header *')) {
      if (el.children.length === 0 && /^Connecting/.test((el.textContent || '').trim())) {
        let badge = el;
        while (
          badge.parentElement &&
          /^Connecting/.test((badge.parentElement.textContent || '').trim())
        ) {
          badge = badge.parentElement;
        }
        badge.style.visibility = 'hidden';
      }
    }
  });
}

/** Throws if any of the texts is on the page: a picture of a spinner or an error is not a picture. */
async function assertAbsent(page, what, texts) {
  for (const text of texts) {
    if ((await page.getByText(text).count()) > 0) {
      throw new Error(`${what}: the page still says "${text}"`);
    }
  }
}

/** Where a picture goes. */
function save(buffer, ...files) {
  for (const file of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    console.log(path.relative(ROOT, file));
  }
}

/**
 * A PNG as WebP, `width` px wide (its height in proportion). Chromium encodes
 * it: the PNG is drawn to a canvas of that size and read back as WebP.
 */
async function toWebp(browser, png, width = SITE_IMAGE_WIDTH, quality = SITE_IMAGE_QUALITY) {
  const page = await browser.newPage();
  try {
    const dataUrl = await page.evaluate(
      async ({ base64, size, q }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = Math.round((image.naturalHeight * size) / image.naturalWidth);
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/webp', q);
      },
      { base64: png.toString('base64'), size: width, q: quality },
    );
    if (!dataUrl.startsWith('data:image/webp;base64,')) {
      throw new Error('this Chromium cannot encode WebP');
    }
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  } finally {
    await page.close();
  }
}

/** The site's copy of a capture: website/static/img/screens/<name>.webp. */
async function saveForSite(browser, png, name) {
  save(await toWebp(browser, png), path.join(SCREENS, `${name}.webp`));
}

function reportUnanswered(what) {
  if (unanswered.size > 0) {
    console.log(`  ${what}: no sample for ${Array.from(unanswered).join(', ')}`);
    unanswered.clear();
  }
}

/** The Devices page: the README's picture and the site's. */
async function shootDevices(browser, theme, phone) {
  const { context, page } = await openPage(browser, theme, { width: 1440, height: 700 }, phone);
  await page.goto(`${BASE}/xenon/devices`, { waitUntil: 'load' });
  await page.waitForSelector('text=Pixel 8 Pro');
  await page.waitForTimeout(1000);
  await hideConnectingBadge(page);
  const png = await page.screenshot();
  save(png, path.join(ASSETS, `dashboard-${theme}.png`));
  await saveForSite(browser, png, `devices-${theme}`);
  reportUnanswered('devices');
  await context.close();
}

/** Device control on the sample Android phone, the Logs tab streaming. */
async function shootDeviceControl(browser, theme, phone) {
  const { context, page } = await openPage(browser, theme, { width: 1440, height: 900 }, phone);
  // The logs arrive over a WebSocket: send them once it is open, as the
  // phone's logcat does, since the tab clears its lines when the socket opens.
  const live = Date.UTC(2026, 9, 4, 10, 42, 30);
  await page.routeWebSocket(/\/xenon\/api\/control\/[^/]+\/logcat/, (ws) => {
    setTimeout(() => {
      for (const record of logcatRecords(live)) ws.send(JSON.stringify(record));
    }, 300);
  });

  await page.goto(`${BASE}/xenon/devices/${sample.UDID}/control/logs`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const img = document.querySelector('img[alt="Device Stream"]');
    return !!img && img.complete && img.naturalWidth > 0;
  });
  await page.locator('.log-status', { hasText: 'Live' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.log-row').length >= 30);
  await page.waitForTimeout(800);
  await hideConnectingBadge(page);
  await assertAbsent(page, 'device control', [
    'Waiting for stream',
    'ESTABLISHING TRACE',
    'Stream unavailable',
    'Display is off',
  ]);
  await saveForSite(
    browser,
    await page.screenshot({ animations: 'disabled' }),
    `device-control-${theme}`,
  );
  reportUnanswered('device control');
  await context.close();
}

/** The page of the sample session: outcome, tiles, healing, CPU and memory, recording. */
async function shootSession(browser, theme, phone) {
  const { context, page } = await openPage(browser, theme, { width: 1440, height: 900 }, phone);
  await page.goto(`${BASE}/xenon/builds/${sample.BUILD_ID}/sessions/${sample.SESSION_ID}`, {
    waitUntil: 'load',
  });
  await page.getByRole('heading', { name: sample.SESSION.name }).waitFor();
  await page.waitForSelector('section[aria-label="CPU"] svg path');
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return !!video && video.readyState >= 2;
  });
  await page.waitForTimeout(800);
  await hideConnectingBadge(page);
  if (!page.url().includes(`/sessions/${sample.SESSION_ID}`)) {
    throw new Error(`session: the page left the session (${page.url()})`);
  }
  await assertAbsent(page, 'session', [
    'Loading session',
    'Loading performance',
    'Session not found',
    'No video available',
  ]);
  await saveForSite(
    browser,
    await page.screenshot({ animations: 'disabled' }),
    `session-${theme}`,
  );
  reportUnanswered('session');
  await context.close();
}

(async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-screenshots-'));
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  try {
    const phone = await preparePhone(browser, workDir);
    for (const theme of ['dark', 'light']) {
      await shootDevices(browser, theme, phone);
      await shootDeviceControl(browser, theme, phone);
      await shootSession(browser, theme, phone);
    }
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
