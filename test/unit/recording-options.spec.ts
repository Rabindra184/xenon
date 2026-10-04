import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import { ServerManager } from '../../src/services/ServerManager';
import { PluginContext } from '../../src/PluginContext';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';
import {
  config,
  updateConfig,
  resolveMaxConcurrentRecordings,
  resolveRecordingsAssetsPath,
} from '../../src/config';
import log from '../../src/logger';

/**
 * `maxConcurrentRecordings` and `recordingsAssetsPath` are declared in
 * schema.json, so Appium accepts them in a config file, but nothing read them:
 * only the XENON_MAX_CONCURRENT_RECORDINGS and XENON_RECORDINGS_ASSETS_PATH
 * environment variables reached src/config.ts. The option now wins, the
 * variable is the fallback, and both are applied at boot before anything that
 * reads them (the artifact store, the concurrency gate).
 */
describe('the recording options', () => {
  let saved: { max: number; path: string };
  let env: { max?: string; path?: string };
  let statics: { nodeId: string; port: number; basePath: string };

  beforeEach(() => {
    saved = { max: config.maxConcurrentRecordings, path: config.recordingsAssetsPath };
    env = {
      max: process.env.XENON_MAX_CONCURRENT_RECORDINGS,
      path: process.env.XENON_RECORDINGS_ASSETS_PATH,
    };
    delete process.env.XENON_MAX_CONCURRENT_RECORDINGS;
    delete process.env.XENON_RECORDINGS_ASSETS_PATH;
    statics = {
      nodeId: XenonPlugin.NODE_ID,
      port: XenonPlugin.port,
      basePath: XenonPlugin.nodeBasePath,
    };
  });

  afterEach(() => {
    sinon.restore();
    updateConfig({ maxConcurrentRecordings: saved.max, recordingsAssetsPath: saved.path });
    for (const [name, value] of [
      ['XENON_MAX_CONCURRENT_RECORDINGS', env.max],
      ['XENON_RECORDINGS_ASSETS_PATH', env.path],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    XenonPlugin.NODE_ID = statics.nodeId;
    XenonPlugin.port = statics.port;
    XenonPlugin.nodeBasePath = statics.basePath;
  });

  /**
   * Boots as far as the database step and says what the options were when it
   * began: the artifact store is built there from `recordingsAssetsPath`.
   */
  async function seenAtDatabaseStep(pluginArgs: Record<string, unknown>) {
    const seen: { max?: number; path?: string } = {};
    const boot = ServerManager.prototype as any;
    sinon.stub(boot, 'resolvePluginArgs').resolves(pluginArgs);
    sinon.stub(log, 'banner');
    sinon.stub(PluginContext.prototype, 'setContext');
    sinon.stub(boot, 'syncDatabaseAndAIConfig').resolves();
    sinon.stub(boot, 'initializeCoreSubsystems').callsFake(async () => {
      seen.max = config.maxConcurrentRecordings;
      seen.path = config.recordingsAssetsPath;
      throw new Error('boot stopped by the test');
    });
    await Container.get(ServerManager)
      .updateServer({}, null, { port: 4723 } as any)
      .catch((err: Error) => expect(err.message).to.equal('boot stopped by the test'));
    return seen;
  }

  describe('applied at boot', () => {
    it('takes the maxConcurrentRecordings option', async () => {
      const seen = await seenAtDatabaseStep({ maxConcurrentRecordings: 2 });
      expect(seen.max).to.equal(2);
    });

    it('takes the recordingsAssetsPath option', async () => {
      const seen = await seenAtDatabaseStep({ recordingsAssetsPath: '/srv/xenon/recordings' });
      expect(seen.path).to.equal('/srv/xenon/recordings');
    });

    it('falls back to the environment variables when the options are not set', async () => {
      process.env.XENON_MAX_CONCURRENT_RECORDINGS = '7';
      process.env.XENON_RECORDINGS_ASSETS_PATH = '/mnt/recordings';
      const seen = await seenAtDatabaseStep({});
      expect(seen).to.deep.equal({ max: 7, path: '/mnt/recordings' });
    });

    it('lets the option win over the environment variable', async () => {
      process.env.XENON_MAX_CONCURRENT_RECORDINGS = '7';
      process.env.XENON_RECORDINGS_ASSETS_PATH = '/mnt/recordings';
      const seen = await seenAtDatabaseStep({
        maxConcurrentRecordings: 3,
        recordingsAssetsPath: '/srv/xenon/recordings',
      });
      expect(seen).to.deep.equal({ max: 3, path: '/srv/xenon/recordings' });
    });

    it('keeps the default cap of 4 when neither is set', async () => {
      const seen = await seenAtDatabaseStep({});
      expect(seen.max).to.equal(4);
    });

    it('ignores a cap that is not a whole number of at least 1', async () => {
      for (const bad of [0, -2, 2.5, NaN, '3', null]) {
        const seen = await seenAtDatabaseStep({ maxConcurrentRecordings: bad });
        expect(seen.max, `option ${JSON.stringify(bad)}`).to.equal(4);
        sinon.restore();
      }
    });

    it('ignores an environment cap that is not a whole number of at least 1', async () => {
      process.env.XENON_MAX_CONCURRENT_RECORDINGS = 'many';
      const seen = await seenAtDatabaseStep({});
      expect(seen.max).to.equal(4);
    });

    it('ignores a blank recordingsAssetsPath', async () => {
      const seen = await seenAtDatabaseStep({ recordingsAssetsPath: '   ' });
      expect(seen.path).to.equal(saved.path);
    });
  });

  describe('the concurrency gate', () => {
    it('reads the cap when it admits, not when it is built', () => {
      updateConfig({ maxConcurrentRecordings: 4 });
      const gate = new ConcurrencyGate();

      updateConfig({ maxConcurrentRecordings: 1 });

      expect(gate.getLimit()).to.equal(1);
      expect(gate.tryAcquire(['r1'])).to.equal(true);
      expect(gate.tryAcquire(['r2'])).to.equal(false);
    });

    it('keeps an explicit limit over the configured one', () => {
      updateConfig({ maxConcurrentRecordings: 4 });
      expect(new ConcurrencyGate(2).getLimit()).to.equal(2);
    });
  });
});

describe('resolving the recording options', () => {
  describe('maxConcurrentRecordings', () => {
    it('takes the option, then the variable, then 4', () => {
      expect(resolveMaxConcurrentRecordings(2, '7')).to.equal(2);
      expect(resolveMaxConcurrentRecordings(undefined, '7')).to.equal(7);
      expect(resolveMaxConcurrentRecordings(undefined, undefined)).to.equal(4);
    });

    it('passes over a value that is not a whole number of at least 1', () => {
      for (const bad of [0, -1, 1.5, NaN, Infinity, '2', null, {}]) {
        expect(resolveMaxConcurrentRecordings(bad, '7'), JSON.stringify(bad)).to.equal(7);
      }
      for (const bad of ['', ' ', '0', '-3', '2.5', 'many', 'NaN']) {
        expect(resolveMaxConcurrentRecordings(undefined, bad), JSON.stringify(bad)).to.equal(4);
      }
    });
  });

  describe('recordingsAssetsPath', () => {
    it('takes the option, then the variable, then the default folder', () => {
      expect(resolveRecordingsAssetsPath('/a', '/b')).to.equal('/a');
      expect(resolveRecordingsAssetsPath(undefined, '/b')).to.equal('/b');
      expect(resolveRecordingsAssetsPath(undefined, undefined)).to.match(
        /\.cache\/xenon\/assets\/sessions\/recordings$/,
      );
    });

    it('counts a blank value as unset', () => {
      expect(resolveRecordingsAssetsPath('  ', '/b')).to.equal('/b');
      expect(resolveRecordingsAssetsPath(undefined, '')).to.match(/recordings$/);
      expect(resolveRecordingsAssetsPath(42, undefined)).to.match(/recordings$/);
    });

    it('trims what it is given', () => {
      expect(resolveRecordingsAssetsPath(' /a ', undefined)).to.equal('/a');
    });
  });
});
