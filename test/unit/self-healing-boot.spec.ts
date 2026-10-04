import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import { ServerManager } from '../../src/services/ServerManager';
import { PluginContext } from '../../src/PluginContext';
import { SelfHealingSwitch } from '../../src/services/settings/SelfHealingSwitch';
import { AiEngineSettings } from '../../src/services/settings/aiEngineSettings';
import log from '../../src/logger';

/**
 * The self-healing value saved on the Settings page, and the AI engine page's
 * provider, model and base URL, are read once at boot, so a restart doesn't put
 * the server back on the options it was started with. They have to be loaded
 * once the database is ready (migrations ran), after the startup options were
 * applied (the AI engine's are what a cleared value goes back to), and before
 * the first route can answer or the first command arrive.
 */
describe('loading the saved self-healing and AI engine settings, at boot', () => {
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

  it('runs once the database is ready, before routes are registered', async () => {
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
    // The real one kills every go-ios process on the machine.
    sinon.stub(boot, 'reapLeftoverGoIos').callsFake(step('reap'));
    sinon.stub(SelfHealingSwitch.prototype, 'load').callsFake(step('self-healing setting'));
    sinon.stub(AiEngineSettings.prototype, 'load').callsFake(step('AI engine settings'));
    sinon.stub(boot, 'registerRoutes').callsFake(() => {
      steps.push('routes');
      throw new Error('boot stopped by the test');
    });

    await Container.get(ServerManager)
      .updateServer({}, null, { port: 4723 } as any)
      .then(
        () => expect.fail('the stubbed routes step should have stopped the boot'),
        (err: Error) => expect(err.message).to.equal('boot stopped by the test'),
      );

    expect(steps).to.deep.equal([
      'database config',
      'database and migrations',
      'reap',
      'self-healing setting',
      'AI engine settings',
      'routes',
    ]);
  });
});
