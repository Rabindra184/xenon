// Writes static/img/social-card.png, the picture a link to the site shows when
// it is shared: the home page's first section, in dark mode, at 1200 x 630,
// with the navbar and everything below the section left out.
//
//   npm run build && npm run serve -- --port 3100     (in one terminal)
//   node scripts/social-card.mjs [site URL]           (in another)
//
// The site URL is the first argument and defaults to http://localhost:3100/.
// Playwright comes from the dashboard's dependencies (../web/node_modules), so
// the website needs no browser of its own; run `npm install` in web/ first.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const WIDTH = 1200;
const HEIGHT = 630;

const siteUrl = process.argv[2] ?? 'http://localhost:3100/';
const output = fileURLToPath(new URL('../static/img/social-card.png', import.meta.url));

let chromium;
try {
  const requireFromWeb = createRequire(new URL('../../web/', import.meta.url));
  ({ chromium } = requireFromWeb('playwright'));
} catch (error) {
  console.error(`Playwright was not found in ../web/node_modules (${error.message}). Run \`npm install\` in web/.`);
  process.exit(1);
}

// The theme switch Docusaurus reads from the address, so the card is dark
// whatever the page remembers.
const address = new URL(siteUrl);
address.searchParams.set('docusaurus-theme', 'dark');

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await page.goto(address.toString(), { waitUntil: 'networkidle' });
  // The first section alone, filling the card and centred in it. Its inner
  // box is the hero's own grid, which already centres its two columns. The
  // install command is left out: a picture can't be copied from, and at this
  // width its box is a hair too narrow for the command. (CSS-module class names
  // carry a hash after the name, so the box is found by the name alone.)
  await page.addStyleTag({
    content: `
      .navbar, .theme-announcement-bar, footer, main > section:not(:first-child) { display: none !important; }
      main > section:first-child [class*='install'] { display: none !important; }
      main > section:first-child > div { min-height: ${HEIGHT}px; padding: 0 56px !important; box-sizing: border-box; }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const shots = [...document.querySelectorAll('main img')].filter((img) => img.offsetParent !== null);
    await Promise.all(shots.map((img) => img.decode().catch(() => {})));
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: output, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  console.log(`wrote ${output} (${WIDTH} x ${HEIGHT}) from ${address.origin}${address.pathname}`);
} finally {
  await browser.close();
}
