import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import { ServerManager } from '../../src/services/ServerManager';
import { PluginContext } from '../../src/PluginContext';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import * as goIosBinary from '../../src/device-managers/ios/goIosBinary';
import { GO_IOS_VERSION } from '../../src/scripts/goIosVersion';
import { RecordingOrchestrator } from '../../src/services/recording/RecordingOrchestrator';
import log from '../../src/logger';

/**
 * At boot Xenon reaps what a previous run left of go-ios (tunnels whose agents
 * self-fork, WebDriverAgent runners, log streams). The reap kills every process
 * running the vendored go-ios binary, so it also kills this process's own
 * go-ios calls. It used to run last, after device detection had started:
 * detection asks `ios info` about each plugged-in iPhone in the background,
 * and those calls were killed ("Failed to fetch IP via go-ios" for every
 * iPhone, at every boot). It now runs as soon as the database is ready,
 * before this process starts go-ios at all.
 */
describe('reaping go-ios left by a previous run, at boot', () => {
  let statics: { nodeId: string; port: number; basePath: string };

  beforeEach(() => {
    statics = {
      nodeId: XenonPlugin.NODE_ID,
      port: XenonPlugin.port,
      basePath: XenonPlugin.nodeBasePath,
    };
  });

  afterEach(() => {
    sinon.restore();
    XenonPlugin.NODE_ID = statics.nodeId;
    XenonPlugin.port = statics.port;
    XenonPlugin.nodeBasePath = statics.basePath;
  });

  it('runs once the database is ready, before routes and device detection start', async () => {
    const steps: string[] = [];
    const step = (name: string) => () => {
      steps.push(name);
      return Promise.resolve();
    };
    const boot = ServerManager.prototype as any;
    sinon.stub(boot, 'resolvePluginArgs').resolves({});
    sinon.stub(log, 'banner');
    sinon.stub(PluginContext.prototype, 'setContext');
    sinon.stub(boot, 'syncDatabaseAndAIConfig').callsFake(step('database config'));
    sinon.stub(boot, 'initializeCoreSubsystems').callsFake(step('database and migrations'));
    const reap = sinon
      .stub(IOSStreamService.prototype, 'reapOrphanTunnels')
      .callsFake(step('reap'));
    sinon.stub(boot, 'reportBundledGoIos').callsFake(() => steps.push('go-ios report'));
    // Everything that starts go-ios (device managers, detection, the hub's and
    // node's discovery crons) comes after the routes; stop there.
    sinon.stub(boot, 'registerRoutes').callsFake(() => {
      steps.push('routes');
      throw new Error('boot stopped by the test');
    });

    const booting = Container.get(ServerManager).updateServer({}, null, { port: 4723 } as any);

    await booting.then(
      () => expect.fail('the stubbed routes step should have stopped the boot'),
      (err: Error) => expect(err.message).to.equal('boot stopped by the test'),
    );
    expect(steps).to.deep.equal([
      'database config',
      'database and migrations',
      'reap',
      'go-ios report',
      'routes',
    ]);
    // A go-ios an older Xenon left at the old cache path is reaped too.
    expect(reap.calledOnceWithExactly({ includeLegacy: true })).to.equal(true);
  });

  it('is followed by one line saying which go-ios an iOS server runs, or why it cannot', () => {
    const manager: any = Container.get(ServerManager);
    const info = sinon.stub(manager.logger, 'info');
    const warn = sinon.stub(manager.logger, 'warn');
    const check = sinon.stub(goIosBinary, 'checkGoIosBinary').returns('ok');
    const bundled = goIosBinary.goIosBinaryPath();

    manager.reportBundledGoIos({ platform: 'ios' });
    check.returns('missing');
    manager.reportBundledGoIos({ platform: 'both' });
    manager.reportBundledGoIos({ platform: 'android' });

    expect(check.alwaysCalledWithExactly(bundled)).to.equal(true);
    expect(info.args).to.deep.equal([[`go-ios ${GO_IOS_VERSION} (comes with Xenon): ${bundled}`]]);
    expect(warn.args).to.deep.equal([[goIosBinary.goIosStateMessage('missing', bundled)]]);
  });

  it('is not left to the plugin, which boots after detection has started', async () => {
    sinon.stub(ServerManager.prototype, 'updateServer').resolves();
    sinon.stub(RecordingOrchestrator.prototype, 'recoverOnBoot').resolves();
    const reap = sinon.stub(IOSStreamService.prototype, 'reapOrphanTunnels').resolves();

    await XenonPlugin.updateServer({}, null, {} as any);

    expect(reap.called).to.equal(false);
  });
});
