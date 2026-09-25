/**
 * Control sweep: every visible control on every page is clicked with a real
 * (trusted) mouse click on a fresh load, and must visibly do something. It found
 * the dead "Upload app" button (#274) and the account menu hidden behind the
 * Devices and Apps toolbars (#279), neither of which unit tests could see.
 *
 * Controls that open a menu, dialog or popover get a second level: every
 * control that appeared is clicked too.
 *
 * SAFETY — it runs against a live server, so nothing it clicks can change state:
 *  - Every non-GET request to /xenon/api is answered here with {} and never sent.
 *  - Everything under /xenon/api/control/ (the device router) is answered here,
 *    whatever the method, so no request reaches a device. Streams are aborted.
 *  - Device control uses a route-mocked device, not real hardware.
 *  - confirm()/alert() are dismissed, file choosers and downloads cancelled,
 *    and clipboard writes and window.open recorded instead of performed.
 *
 * Run: `npm run test:sweep` against a running server (dashboard enabled, auth
 * disabled), about 20 minutes. The HTML report lands in test/sweep/report.
 */
import { test, expect, Page, BrowserContext, Browser } from '@playwright/test';

const MAX_LEVEL_2 = 25;

// Minimal device for the control routes (the viewport suite uses the same shape).
const MOCK_DEVICE = {
  udid: 'MOCK-ANDROID-01', host: 'http://127.0.0.1:4723', name: 'Pixel 8 Pro', state: 'device', sdk: '14',
  platform: 'android', deviceType: 'real', busy: false, userBlocked: false, realDevice: true, session_id: null,
  offline: false, systemPort: 10100, mjpegServerPort: 9101, adbPort: 5037, screenWidth: '1080', screenHeight: '2340',
  totalUtilizationTimeMilliSec: 0, sessionStartTime: 0, total_session_count: 0, healthStatus: 'Healthy',
  batteryLevel: 100, storageFree: '97G', thermalStatus: 'Normal', sessionProgress: '', totalHealedCount: 0,
  ip: '192.168.0.112', cpuArchitecture: 'arm64-v8a', reservedBy: null, reservedUntil: null, reservationReason: null,
  owningSessionId: null, lockedAt: null, teamId: null, createdAt: '2026-07-16T06:53:02.793Z',
  updatedAt: '2026-07-16T07:29:10.635Z',
};

const CONTROL = `/devices/${MOCK_DEVICE.udid}/control`;
const ROUTES: { path: string; mockDevice?: boolean }[] = [
  '/overview', '/devices', '/devices/live', '/apps', '/builds', '/selector-health', '/notifications',
  '/settings', '/ai-settings', '/maintenance', '/teams', '/users', '/api-keys', '/profile',
  '/runbooks/timeout', '/login', '/forgot-password', '/reset-password',
]
  .map((path) => ({ path }))
  .concat(['', '/screenshot', '/logs', '/terminal', '/omni'].map((t) => ({ path: CONTROL + t, mockDevice: true })));

// Legitimate no-ops the sweep can't tell apart from a dead control. Keep short,
// and give every entry a reason.
const EXPECTED_NO_EFFECT: { route: RegExp; key: RegExp; reason: string }[] = [
  {
    route: /\/control\/omni$/,
    key: /^button\|\|(Expand|Collapse) all$/,
    reason: 'the mocked device returns no element tree, so there is nothing to expand',
  },
];

type Result = {
  level: 1 | 2;
  opener?: string;
  key: string;
  status: 'ok' | 'expected' | 'NO-EFFECT' | 'click-failed' | 'disabled' | 'vanished';
  why?: string;
  effects?: string[];
};

// Runs in the page before any app code.
const INIT = () => {
  const w = window as any;
  const fx = (w.__fx = { targets: new Set<Node>(), nav: [] as string[], clip: 0, opens: [] as string[], invalid: 0 });
  new MutationObserver((records) => records.forEach((r) => fx.targets.add(r.target))).observe(document, {
    subtree: true, childList: true, attributes: true, characterData: true,
  });
  document.addEventListener('invalid', () => fx.invalid++, true);
  for (const k of ['pushState', 'replaceState'] as const) {
    const orig = history[k].bind(history);
    (history as any)[k] = (s: unknown, t: string, u?: string | URL | null) => {
      fx.nav.push(String(u));
      return orig(s, t, u);
    };
  }
  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => { fx.clip++; return Promise.resolve(); },
        readText: () => Promise.resolve(''),
        write: () => { fx.clip++; return Promise.resolve(); },
      },
    });
  } catch { /* clipboard not overridable here */ }
  const exec = document.execCommand.bind(document);
  document.execCommand = (c: string, ...a: any[]) => (c === 'copy' ? (fx.clip++, true) : exec(c, ...(a as [])));
  w.open = (u: unknown) => { fx.opens.push(String(u)); return null; };

  const SELECTOR = [
    'button', 'a[href]', 'summary', 'label[for]', 'input[type=checkbox]', 'input[type=radio]',
    ...['button', 'tab', 'menuitem', 'menuitemradio', 'radio', 'switch', 'checkbox', 'option'].map((r) => `[role=${r}]`),
  ].join(', ');
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[aria-hidden=true]');
  };
  const label = (e: Element) =>
    `${e.getAttribute('aria-label') || (e as HTMLElement).innerText || e.getAttribute('title') || (e as HTMLInputElement).value || ''}`
      .trim().replace(/\s+/g, ' ').slice(0, 50);
  const walk = (fn: (e: Element, key: string, nth: number) => void) => {
    const counts: Record<string, number> = {};
    for (const e of document.querySelectorAll(SELECTOR)) {
      if (!visible(e)) continue;
      const key = `${e.tagName.toLowerCase()}|${e.getAttribute('role') || ''}|${label(e)}`;
      counts[key] = (counts[key] || 0) + 1;
      fn(e, key, counts[key] - 1);
    }
  };
  w.__enum = () => {
    const out: { key: string; nth: number; disabled: boolean; active: boolean }[] = [];
    walk((e, key, nth) => out.push({
      key, nth,
      disabled: !!((e as HTMLButtonElement).disabled || e.getAttribute('aria-disabled') === 'true'),
      // Already selected/current: clicking it again is rightly a no-op.
      active: ['aria-selected', 'aria-checked', 'aria-pressed'].some((a) => e.getAttribute(a) === 'true')
        || (!!e.getAttribute('aria-current') && e.getAttribute('aria-current') !== 'false'),
    }));
    return out;
  };
  w.__tag = (key: string, nth: number) => {
    document.querySelectorAll('[data-sweep]').forEach((x) => x.removeAttribute('data-sweep'));
    let hit = false;
    walk((e, k, n) => { if (!hit && k === key && n === nth) { e.setAttribute('data-sweep', '1'); hit = true; } });
    return hit;
  };
  // The checkbox/radio a control drives: itself, or a label's control.
  w.__checkable = () => {
    const t = document.querySelector('[data-sweep]');
    const c = t instanceof HTMLLabelElement ? t.control : t;
    return c instanceof HTMLInputElement && /checkbox|radio/.test(c.type) ? c : null;
  };
};

async function guard(page: Page, mockDevice: boolean, net: string[], writes: string[]) {
  await page.route('**/*', async (route) => {
    const req = route.request(); const method = req.method();
    const { pathname } = new URL(req.url());
    if (!pathname.startsWith('/xenon/api')) return route.continue();
    if (/\/stream(\/|$)|\/logcat/.test(pathname)) return route.abort();
    if (mockDevice && method === 'GET' && /^\/xenon\/api\/devices?$/.test(pathname)) {
      return route.fulfill({ json: [MOCK_DEVICE] });
    }
    if (pathname.startsWith('/xenon/api/control/') || !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      if (method !== 'GET') writes.push(`${method} ${pathname}`);
      return route.fulfill({ json: {} });
    }
    return route.continue();
  });
  page.on('request', (q) => {
    const p = new URL(q.url()).pathname;
    if (!p.startsWith('/socket.io')) net.push(`${q.method()} ${p}`);
  });
}

async function openPage(browser: Browser, path: string, mockDevice: boolean, canary: boolean) {
  const net: string[] = []; const writes: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(INIT);
  if (canary) {
    await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:70px;bottom:10px;z-index:99999;display:flex;gap:8px';
      box.innerHTML = '<button>Canary dead</button><button id="canary-live">Canary live</button><span id="canary-out"></span>';
      document.body.appendChild(box);
      document.getElementById('canary-live')!.addEventListener('click', () => {
        document.getElementById('canary-out')!.textContent = 'clicked';
      });
    }));
  }
  const page = await ctx.newPage();
  await guard(page, mockDevice, net, writes);
  await page.goto('/xenon' + path);
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
  return { ctx, page, net, writes };
}

/** Click the tagged control and report what it did. */
async function measure(page: Page, ctx: BrowserContext, net: string[], writes: string[]) {
  const seen = { dialogs: 0, choosers: 0, downloads: 0, popups: 0 };
  const onDialog = (d: any) => { seen.dialogs++; d.dismiss().catch(() => {}); };
  const onChooser = () => { seen.choosers++; };
  const onDownload = (d: any) => { seen.downloads++; d.cancel().catch(() => {}); };
  const onPopup = (p: Page) => { seen.popups++; p.close().catch(() => {}); };
  page.on('dialog', onDialog); page.on('filechooser', onChooser); page.on('download', onDownload); ctx.on('page', onPopup);
  try {
    const target = page.locator('[data-sweep="1"]');
    await target.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    await target.hover({ timeout: 1500, force: true }).catch(() => {});
    await page.waitForTimeout(300);

    // A label whose field already has focus has nothing left to do.
    const labelOfFocused = await page.evaluate(() => {
      const t = document.querySelector('[data-sweep]');
      return t instanceof HTMLLabelElement && !!t.control && t.control === document.activeElement;
    });
    if (labelOfFocused) return { status: 'expected' as const, why: "label's field already has focus" };

    // Idle window: remember what the page changes on its own, so a busy page
    // (live timers, polling) can't make a dead control look alive.
    const reset = () => page.evaluate(() => {
      const f = (window as any).__fx; f.targets = new Set(); f.nav = []; f.clip = 0; f.opens = []; f.invalid = 0;
    });
    await reset(); net.length = 0;
    await page.waitForTimeout(900);
    await page.evaluate(() => { const f = (window as any).__fx; f.idle = f.targets; f.targets = new Set(); });
    const idleNet = new Set(net);
    net.length = 0; writes.length = 0;

    const urlBefore = page.url();
    const checkedBefore = await page.evaluate(() => (window as any).__checkable()?.checked ?? null);
    let clickError: string | undefined;
    try {
      await target.click({ timeout: 2500 });
    } catch (e: any) {
      clickError = String(e.message).split('\n').find((l) => l.includes('intercepts pointer events')) || String(e.message).split('\n')[0];
    }
    await page.waitForTimeout(900);

    if (clickError) {
      // Sort the known, legitimate reasons a control can't take a direct click.
      const cover = await page.evaluate(() => {
        const t = document.querySelector('[data-sweep]') as HTMLElement | null;
        if (!t) return 'gone';
        const r = t.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (!top) return 'unknown';
        for (let e: Element | null = top; e; e = e.parentElement) {
          const cs = getComputedStyle(e); const b = e.getBoundingClientRect();
          if (cs.position === 'fixed' && b.width >= innerWidth * 0.9 && b.height >= innerHeight * 0.9 && !e.contains(t)) {
            return 'overlay';
          }
        }
        const lab = top.closest('label');
        if (lab && t instanceof HTMLInputElement && (lab.contains(t) || lab.control === t)) return 'own-label';
        return `${top.tagName.toLowerCase()}.${String((top as HTMLElement).className).slice(0, 60)}`;
      });
      if (cover === 'overlay') return { status: 'expected' as const, why: 'under a full-screen overlay' };
      if (cover === 'own-label') {
        // Custom switch: its slider covers the input, and clicking the label is what a user does.
        await page.evaluate(() => {
          const t = document.querySelector('[data-sweep]') as HTMLInputElement;
          const lab = (t.closest('label') || t.labels?.[0]) as HTMLElement; lab.setAttribute('data-sweep-label', '1');
        });
        await page.locator('[data-sweep-label="1"]').click({ timeout: 2500 });
        const after = await page.evaluate(() => (document.querySelector('[data-sweep]') as HTMLInputElement).checked);
        return after !== checkedBefore
          ? { status: 'ok' as const, effects: ['checked (via its label)'] }
          : { status: 'NO-EFFECT' as const, why: 'clicking its label did not toggle it' };
      }
      return { status: 'click-failed' as const, why: cover === 'gone' ? clickError : `covered by ${cover}` };
    }

    const fx = await page.evaluate(() => {
      const f = (window as any).__fx;
      // A full page load replaces __fx, so there is no idle set; the URL change
      // below reports it as navigation.
      const idle: Set<Node> = f.idle || new Set();
      const fresh = [...f.targets].filter((n: Node) => !idle.has(n)).length;
      return { fresh, nav: f.nav, clip: f.clip, opens: f.opens, invalid: f.invalid };
    });
    const checkedAfter = await page.evaluate(() => (window as any).__checkable()?.checked ?? null);
    const focusElsewhere = await page.evaluate(() => {
      const a = document.activeElement; const t = document.querySelector('[data-sweep]');
      return !!a && a !== document.body && !!t && a !== t && !t.contains(a);
    });
    const requests = net.filter((n) => !idleNet.has(n));
    const effects: string[] = [];
    if (writes.length) effects.push(`write: ${[...new Set(writes)].join(', ')}`);
    if (requests.length) effects.push(`request: ${[...new Set(requests)].slice(0, 3).join(', ')}`);
    if (page.url() !== urlBefore || fx.nav.length) effects.push('navigation');
    if (fx.fresh) effects.push(`dom (${fx.fresh} nodes)`);
    if (checkedAfter !== checkedBefore) effects.push('checked');
    if (fx.invalid) effects.push('form validation');
    if (fx.clip) effects.push('clipboard');
    if (fx.opens.length) effects.push('window.open');
    if (seen.dialogs) effects.push('dialog');
    if (seen.choosers) effects.push('file chooser');
    if (seen.downloads) effects.push('download');
    if (seen.popups) effects.push('popup');
    if (focusElsewhere) effects.push('focus moved');
    return effects.length ? { status: 'ok' as const, effects } : { status: 'NO-EFFECT' as const };
  } finally {
    page.off('dialog', onDialog); page.off('filechooser', onChooser); page.off('download', onDownload); ctx.off('page', onPopup);
  }
}

async function sweep(browser: Browser, path: string, mockDevice: boolean, opts: { canary?: boolean; only?: RegExp } = {}) {
  const results: Result[] = [];
  const canary = !!opts.canary;
  const inventory = await openPage(browser, path, mockDevice, canary);
  const finalUrl = inventory.page.url();
  const controls: { key: string; nth: number; disabled: boolean; active: boolean }[] = (
    await inventory.page.evaluate(() => (window as any).__enum())
  ).filter((c: { key: string }) => !opts.only || opts.only.test(c.key));
  await inventory.ctx.close();

  for (const c of controls) {
    if (c.disabled) { results.push({ level: 1, key: c.key, status: 'disabled' }); continue; }
    const { ctx, page, net, writes } = await openPage(browser, path, mockDevice, canary);
    const before: { key: string; nth: number }[] = await page.evaluate(() => (window as any).__enum());
    const found = await page.evaluate(([k, n]) => (window as any).__tag(k, n), [c.key, c.nth] as const);
    let r: Omit<Result, 'level' | 'key'> = found ? await measure(page, ctx, net, writes) : { status: 'vanished' };
    if (r.status === 'NO-EFFECT' && c.active) r = { status: 'expected', why: 'already selected' };
    results.push({ level: 1, key: c.key, ...r });

    // Level 2: controls that appeared after this click, while still on this page.
    let added: { key: string; nth: number; disabled: boolean; active: boolean }[] = [];
    if (r.status === 'ok' && page.url() === finalUrl) {
      const seen = new Set(before.map((b) => `${b.key}#${b.nth}`));
      added = (await page.evaluate(() => (window as any).__enum()))
        .filter((a: any) => !seen.has(`${a.key}#${a.nth}`) && !a.disabled)
        .slice(0, MAX_LEVEL_2);
    }
    await ctx.close();
    for (const a of added) {
      const l2 = await openPage(browser, path, mockDevice, canary);
      if (await l2.page.evaluate(([k, n]) => (window as any).__tag(k, n), [c.key, c.nth] as const)) {
        await l2.page.locator('[data-sweep="1"]').click({ timeout: 2500 }).catch(() => {});
        await l2.page.waitForTimeout(700);
        const inner = await l2.page.evaluate(([k, n]) => (window as any).__tag(k, n), [a.key, a.nth] as const);
        let r2: Omit<Result, 'level' | 'key'> = inner ? await measure(l2.page, l2.ctx, l2.net, l2.writes) : { status: 'vanished' };
        if (r2.status === 'NO-EFFECT' && a.active) r2 = { status: 'expected', why: 'already selected' };
        results.push({ level: 2, opener: c.key, key: a.key, ...r2 });
      }
      await l2.ctx.close();
    }
  }
  return results;
}

function unexplained(path: string, results: Result[]) {
  return results.filter((r) => {
    if (r.status !== 'NO-EFFECT' && r.status !== 'click-failed') return false;
    const allowed = EXPECTED_NO_EFFECT.find((e) => e.route.test(path) && e.key.test(r.key));
    if (allowed) { r.status = 'expected'; r.why = allowed.reason; return false; }
    return true;
  });
}

const describeLine = (r: Result) =>
  `  ${r.status}: ${r.opener ? `[${r.opener.split('|')[2]}] > ` : ''}${r.key}${r.why ? ` (${r.why})` : ''}`;

test.describe('control sweep', () => {
  // The harness must be able to fail: a button that does nothing has to be caught.
  test('harness self-test: catches a dead control, passes a live one', async ({ browser }) => {
    const results = await sweep(browser, '/overview', false, { canary: true, only: /Canary/ });
    const byLabel = Object.fromEntries(results.map((r) => [r.key.split('|')[2], r.status]));
    expect(byLabel).toEqual({ 'Canary dead': 'NO-EFFECT', 'Canary live': 'ok' });
  });

  for (const r of ROUTES) {
    test(`every control on ${r.path} does something`, async ({ browser }, testInfo) => {
      const results = await sweep(browser, r.path, !!r.mockDevice);
      const bad = unexplained(r.path, results);
      await testInfo.attach('results.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
      // Say how much was actually checked, so a pass can't hide an empty sweep.
      const counts: Record<string, number> = {};
      for (const x of results) counts[x.status] = (counts[x.status] || 0) + 1;
      const summary = `${results.length} controls: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`;
      testInfo.annotations.push({ type: 'summary', description: summary });
      console.log(`${r.path}: ${summary}`);
      expect(results.length, `no controls found on ${r.path}`).toBeGreaterThan(0);
      expect(bad.map(describeLine), `Controls on ${r.path} that did nothing or could not be clicked`).toEqual([]);
    });
  }
});
