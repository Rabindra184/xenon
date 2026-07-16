// Renders build/icon.svg into the assets macOS needs:
//   build/icon.png   — 1024x1024, used for the dock icon in dev
//   build/icon.icns  — the packaged app's icon (electron-builder)
//
//   node scripts/make-icon.mjs
//
// Rasterising uses the Electron we already depend on (Chromium), so there's no
// image toolchain to install; iconutil/sips ship with macOS.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const buildDir = resolve(here, '..', 'build');
const svg = resolve(buildDir, 'icon.svg');
const png = resolve(buildDir, 'icon.png');
const icns = resolve(buildDir, 'icon.icns');
const iconset = resolve(buildDir, 'icon.iconset');

if (!existsSync(svg)) {
  console.error(`[make-icon] source not found: ${svg}`);
  process.exit(1);
}

// 1. SVG -> 1024px PNG, via a headless Electron window.
const renderer = resolve(buildDir, '.render-icon.cjs');
writeFileSync(
  renderer,
  `const { app, BrowserWindow } = require('electron');
const { writeFileSync, readFileSync } = require('fs');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const w = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true }
  });
  const svg = readFileSync(${JSON.stringify(svg)}, 'utf8');
  const html = '<html><body style="margin:0;background:transparent">' + svg + '</body></html>';
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  writeFileSync(${JSON.stringify(png)}, img.toPNG());
  app.exit(0);
});`
);

const electronBin = resolve(here, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
try {
  execFileSync(electronBin, [renderer], { stdio: 'inherit', timeout: 60_000 });
} finally {
  rmSync(renderer, { force: true });
}
if (!existsSync(png)) {
  console.error('[make-icon] render produced no PNG');
  process.exit(1);
}
// capturePage honours the display's scale factor, so a Retina Mac yields 2048.
// Normalise so the committed asset is the same 1024 everywhere.
execFileSync('/usr/bin/sips', ['-z', '1024', '1024', png, '--out', png], { stdio: 'ignore' });
console.log(`[make-icon] rendered ${png} (${readFileSync(png).length} bytes, 1024x1024)`);

// 2. PNG -> .iconset -> .icns, using the tools macOS already has.
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
// The exact set Apple expects; omitting sizes makes iconutil fail.
const variants = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
];
for (const [size, name] of variants) {
  execFileSync('/usr/bin/sips', ['-z', String(size), String(size), png, '--out', resolve(iconset, name)], {
    stdio: 'ignore'
  });
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icns], { stdio: 'inherit' });
rmSync(iconset, { recursive: true, force: true });
console.log(`[make-icon] wrote ${icns} (${readFileSync(icns).length} bytes)`);
