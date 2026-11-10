import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

/**
 * `npm test` runs the suite the repo relies on, `test:all`: the unit and
 * integration specs, against a scratch database, with no devices.
 *
 * Through 2.28 it was plain `mocha`, which with `.mocharc.js`'s `recursive`
 * loaded every file under `test/` as a spec. The first it reached was a
 * helper (`test/helpers/fake-adb.ts`), whose import of AndroidDeviceManager
 * needs `reflect-metadata` first, so the run crashed before any test with
 * `_a.getMetadata is not a function`. It also loaded `test/e2e`, which
 * rewrites `temp-appium/*-config.json` as it loads and needs real devices,
 * and it ran without the scratch database, against the developer's own.
 */
describe('npm test', () => {
  it('runs test:all', () => {
    expect(pkg.scripts.test).to.equal('npm run test:all');
  });

  it('test:all loads specs only, with the scratch database, and none of test/e2e', () => {
    const all: string = pkg.scripts['test:all'];
    expect(all).to.include('--require test/setup/scratch-default-database.js');
    expect(all).to.include('NODE_ENV=test');
    for (const glob of all.match(/"[^"]+"/g) ?? []) {
      expect(glob, glob).to.match(/^"test\/(unit|integration)\//);
      expect(glob, glob).to.match(/\.spec|\{spec,test\}/);
    }
  });

  it('the helper that crashed it loads on its own, in a fresh process', function () {
    this.timeout(60_000);
    // Plain `mocha` reached test/helpers/fake-adb.ts first; it imported
    // AndroidDeviceManager without reflect-metadata, so TypeDI threw as the
    // module loaded. Each file imports what it uses (CLAUDE.md).
    const out = execFileSync(
      process.execPath,
      [
        // As .mocharc.js does: on Node >= 22.18 Node strips types itself and
        // ts-node would not be the one loading the helper.
        ...(process.allowedNodeEnvironmentFlags.has('--no-experimental-strip-types')
          ? ['--no-experimental-strip-types']
          : []),
        '-r',
        'ts-node/register',
        '-e',
        "require('./test/helpers/fake-adb.ts'); console.log('loaded')",
      ],
      {
        cwd: path.join(__dirname, '../..'),
        encoding: 'utf8',
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' },
      },
    );
    expect(out.trim().split('\n').pop()).to.equal('loaded');
  });

  it('coverage measures that same run', () => {
    expect(pkg.scripts['test:coverage']).to.equal('nyc npm run test');
  });
});
