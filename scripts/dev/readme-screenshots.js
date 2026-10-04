#!/usr/bin/env node
/**
 * Takes the README's dashboard screenshots: assets/dashboard-dark.png and
 * assets/dashboard-light.png.
 *
 * Serves the built dashboard (web/build) at /xenon/ and answers its API calls
 * with sample devices, so no server, database or phone is needed and the
 * pictures are the same on every machine.
 *
 *   cd web && npm run build && cd ..
 *   node scripts/dev/readme-screenshots.js
 *
 * Uses web/'s Playwright. Set CHROME_BIN to use a particular Chromium.
 */
/* eslint-disable @typescript-eslint/no-var-requires -- a plain Node script, run without a build */
/* global document, localStorage -- used inside the page, by Playwright */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(ROOT, 'web', 'build');
const ASSETS = path.join(ROOT, 'assets');
const PORT = 5179;

const { chromium } = require(path.join(ROOT, 'web', 'node_modules', 'playwright'));

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
  if (apiPath === '/queue' || apiPath === '/teams' || apiPath === '/build') return [];
  if (apiPath.startsWith('/session')) return [];
  if (apiPath.startsWith('/healing/events')) return { events: [], todayCount: 0 };
  return {};
}

async function shoot(browser, theme, file) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 700 },
    deviceScaleFactor: 2,
    colorScheme: theme,
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
  await page.route('**/xenon/api/**', (route) => {
    const apiPath = new URL(route.request().url()).pathname.replace('/xenon/api', '');
    if (apiPath.includes('/stream')) return route.abort();
    return route.fulfill({ json: answer(apiPath) });
  });

  await page.goto(`http://127.0.0.1:${PORT}/xenon/devices`, { waitUntil: 'load' });
  await page.waitForSelector('text=Pixel 8 Pro');
  await page.waitForTimeout(1000);
  // The live-updates badge says "Connecting" here only because the socket is
  // blocked; hide it rather than picture a connection problem.
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
  await page.screenshot({ path: path.join(ASSETS, file) });
  await context.close();
  console.log(`assets/${file}`);
}

(async () => {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  try {
    await shoot(browser, 'dark', 'dashboard-dark.png');
    await shoot(browser, 'light', 'dashboard-light.png');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
