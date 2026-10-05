import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

const pkg = readJson(path.join(root, 'package.json'));
const lock = readJson(path.join(root, 'package-lock.json'));
const appium = readJson(require.resolve('appium/package.json'));

/**
 * The plugin runs inside Appium, so it supports the Node versions Appium 3
 * does and no others. `engines` used to say `^14.17.0 || ^16.13.0 || >=18.0.0`
 * while every Appium 3 release needs 20.19, 22.12 or 24 and later.
 */
describe('package.json engines', () => {
  it("are the installed Appium 3's, the Appium the plugin is built and tested against", () => {
    expect(appium.version).to.match(/^3\./);
    expect(pkg.engines).to.deep.equal({ node: appium.engines.node, npm: appium.engines.npm });
  });

  it('match the copy in package-lock.json', () => {
    expect(lock.packages[''].engines).to.deep.equal(pkg.engines);
  });
});
