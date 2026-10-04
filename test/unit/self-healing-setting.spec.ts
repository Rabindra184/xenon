import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import dashboard from '../../src/app/routers/dashboard';
import { PluginContext } from '../../src/PluginContext';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { HealingOrchestrator } from '../../src/services/healing/HealingOrchestrator';
import { SelfHealingSwitch } from '../../src/services/settings/SelfHealingSwitch';
import { WebConfigService } from '../../src/data-service/web-config-service';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import log from '../../src/logger';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * The Settings page's "AI self-healing" toggle used to do nothing: POST /config
 * stored only the fields its table knew, GET /config never sent the switch back
 * (so the page always showed Enabled), and CommandInterceptor read the copy of
 * the plugin options the server started with, which nothing updates.
 *
 * It follows the other lab settings now: a value saved in the dashboard wins
 * over the startup option, which wins over the default, and applies to the very
 * next command without a restart. The interceptor runs on every command, so it
 * reads an in-memory value (SelfHealingSwitch), never the database.
 */
describe('the AI self-healing switch', () => {
  const scratch = useScratchDatabase();
  let context: PluginContext;
  let startedWith: IPluginArgs;
  let restoreContainer: () => void;
  let healingSwitch: SelfHealingSwitch;

  const startup = (over: Partial<IPluginArgs> = {}) => {
    context.pluginArgs = { ...DefaultPluginArgs, ...over };
    return context.pluginArgs;
  };

  beforeEach(async () => {
    context = Container.get(PluginContext);
    startedWith = context.pluginArgs;
    restoreContainer = saveRegistrations(HealingOrchestrator, SelfHealingSwitch);
    // A switch of its own, as at boot, so no saved value leaks in from another spec.
    Container.set(SelfHealingSwitch, new SelfHealingSwitch());
    healingSwitch = Container.get(SelfHealingSwitch);
    await scratch.db.webConfig.deleteMany({});
  });

  afterEach(() => {
    context.pluginArgs = startedWith;
    restoreContainer();
    sinon.restore();
  });

  function app() {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user-session',
        userId: 'usr_x',
        role: 'SUPER_ADMIN',
        scopes: 'admin,devices,sessions,read',
        rateLimit: 1000,
      };
      next();
    });
    dashboard.register(a as any);
    return a;
  }

  const save = (body: Record<string, unknown>) =>
    request(app()).post('/config').send(body).timeout(5000);
  const read = () => request(app()).get('/config').timeout(5000);

  describe('as the Settings page saves and reads it', () => {
    it('is kept: what POST /config saves, GET /config sends back', async () => {
      startup();
      const saved = await save({ enableSelfHealing: false });
      expect(saved.status).to.equal(200);

      const shown = await read();
      expect(shown.status).to.equal(200);
      expect(shown.body.enableSelfHealing).to.equal(false);
      expect(await Container.get(WebConfigService).getConfig()).to.deep.equal({
        enableSelfHealing: false,
      });
    });

    it('can be turned back on', async () => {
      startup();
      await save({ enableSelfHealing: false });
      await save({ enableSelfHealing: true });
      expect((await read()).body.enableSelfHealing).to.equal(true);
    });

    it('is on, and says so, when nothing was saved and the server was started with nothing', async () => {
      startup();
      const shown = await read();
      expect(shown.body.enableSelfHealing).to.equal(true);
      expect(shown.body.defaults.enableSelfHealing).to.equal(true);
    });

    it('shows the option the server started with when nothing was saved', async () => {
      startup({ enableSelfHealing: false });
      expect((await read()).body.enableSelfHealing).to.equal(false);
    });

    it('shows a saved value over the option the server started with', async () => {
      startup({ enableSelfHealing: false });
      await save({ enableSelfHealing: true });
      expect((await read()).body.enableSelfHealing).to.equal(true);
    });

    it('is saved on its own, without touching the other settings', async () => {
      startup();
      await save({ buildCleanupDays: 7 });
      await save({ enableSelfHealing: false });
      expect(await Container.get(WebConfigService).getConfig()).to.deep.equal({
        buildCleanupDays: 7,
        enableSelfHealing: false,
      });
    });

    for (const bad of ['false', 'no', 0, 1, null, {}, []]) {
      it(`refuses ${JSON.stringify(bad)} with a 400 naming the setting, and saves nothing`, async () => {
        startup();
        const refused = await save({ enableSelfHealing: bad, buildCleanupDays: 9 });
        expect(refused.status).to.equal(400);
        expect(refused.body).to.include({ error: 'invalid_setting', field: 'enableSelfHealing' });
        expect(await Container.get(WebConfigService).getConfig()).to.deep.equal({});
      });
    }
  });

  describe('on a running interceptor', () => {
    const noSuchElement = () =>
      Object.assign(new Error('NoSuchElement: An element could not be located'), {
        name: 'NoSuchElementError',
      });
    let attemptHealing: sinon.SinonStub;
    let pluginArgs: IPluginArgs;

    beforeEach(() => {
      pluginArgs = startup();
      attemptHealing = sinon.stub().resolves(null);
      Container.set(HealingOrchestrator, { attemptHealing } as unknown as HealingOrchestrator);
    });

    /** A findElement the driver answers with NoSuchElement, as a broken selector does. */
    async function findMissing(sessionId: string) {
      let thrown: any;
      try {
        await Container.get(CommandInterceptor).handle(
          async () => {
            throw noSuchElement();
          },
          { sessionId },
          'findElement',
          ['xpath', '//android.widget.Button[@text="Gone"]', sessionId],
          pluginArgs,
          false,
        );
      } catch (err) {
        thrown = err;
      }
      return thrown;
    }

    it('heals a missing element while the switch is on, as it always did', async () => {
      const thrown = await findMissing('sess-on');
      expect(attemptHealing.calledOnce).to.equal(true);
      // Nothing healed it, so the test still sees its own NoSuchElement.
      expect(thrown?.name).to.equal('NoSuchElementError');
    });

    it('stops healing for the next command once off is saved, with no restart', async () => {
      await findMissing('sess-1');
      expect(attemptHealing.callCount).to.equal(1);

      expect((await save({ enableSelfHealing: false })).status).to.equal(200);

      const thrown = await findMissing('sess-1');
      expect(attemptHealing.callCount).to.equal(1);
      // The failure reaches the test untouched, which is the point of turning it off.
      expect(thrown?.name).to.equal('NoSuchElementError');
    });

    it('heals again once on is saved after off', async () => {
      await save({ enableSelfHealing: false });
      await findMissing('sess-2');
      expect(attemptHealing.called).to.equal(false);

      await save({ enableSelfHealing: true });
      await findMissing('sess-2');
      expect(attemptHealing.calledOnce).to.equal(true);
    });

    it('does not read the database for a command', async () => {
      await save({ enableSelfHealing: false });
      const reads = sinon.spy(Container.get(WebConfigService), 'getConfig');
      await findMissing('sess-3');
      await findMissing('sess-3');
      expect(reads.called).to.equal(false);
    });

    it('follows the startup option when nothing is saved', async () => {
      pluginArgs = startup({ enableSelfHealing: false });
      await findMissing('sess-4');
      expect(attemptHealing.called).to.equal(false);
    });

    it('lets a saved on beat a startup off', async () => {
      pluginArgs = startup({ enableSelfHealing: false });
      await save({ enableSelfHealing: true });
      await findMissing('sess-5');
      expect(attemptHealing.calledOnce).to.equal(true);
    });

    it("still hands a session's own healing tiers to the healing it runs", async () => {
      // Read from the session's driver, which every session has: SESSION_MANAGER
      // holds a local one only with the dashboard on, and holds none here.
      const driver = { sessionId: 'sess-6', caps: { 'xe:options': { healingTiers: [1, 2] } } };
      expect(SESSION_MANAGER.getSession('sess-6')).to.equal(undefined);

      await Container.get(CommandInterceptor)
        .handle(
          async () => {
            throw noSuchElement();
          },
          driver,
          'findElement',
          ['id', 'gone', 'sess-6'],
          pluginArgs,
          false,
        )
        .catch(() => undefined);

      expect(attemptHealing.calledOnce).to.equal(true);
      expect(attemptHealing.firstCall.args).to.deep.equal(['sess-6', driver, 'id', 'gone', [1, 2]]);
    });

    describe('and what it learns from a found element', () => {
      let learn: sinon.SinonStub;

      beforeEach(() => {
        sinon.stub(DASHBORD_EVENT_MANAGER, 'afterSessionCommand').resolves();
        learn = sinon.stub(CommandInterceptor.prototype as any, 'triggerLearning');
      });

      const afterFind = () =>
        (Container.get(CommandInterceptor) as any).runPostCommandHooks(
          'sess-7',
          'findElement',
          {},
          ['id', 'there'],
          { ELEMENT: 'el-1' },
          pluginArgs,
        );

      it('learns the selector while the switch is on', async () => {
        await afterFind();
        expect(learn.calledOnce).to.equal(true);
      });

      it('learns nothing once off is saved', async () => {
        await save({ enableSelfHealing: false });
        await afterFind();
        expect(learn.called).to.equal(false);
      });
    });
  });

  describe('at boot', () => {
    it('is the saved value, over the startup option', async () => {
      const pluginArgs = startup({ enableSelfHealing: true });
      await scratch.db.webConfig.create({
        data: { id: 'enableSelfHealing', name: 'enableSelfHealing', value: 'false' },
      });

      await healingSwitch.load();

      expect(healingSwitch.isEnabled(pluginArgs)).to.equal(false);
    });

    it('is the startup option when nothing is saved', async () => {
      await healingSwitch.load();
      expect(healingSwitch.isEnabled(startup({ enableSelfHealing: false }))).to.equal(false);
      expect(healingSwitch.isEnabled(startup({ enableSelfHealing: true }))).to.equal(true);
    });

    it('is on when neither was set', async () => {
      await healingSwitch.load();
      expect(healingSwitch.isEnabled({})).to.equal(true);
    });

    it('is the startup option, and says so once, when the saved value cannot be read', async () => {
      const warn = sinon.stub(log, 'warn');
      sinon.stub(Container.get(WebConfigService), 'getConfig').rejects(new Error('db is down'));

      await healingSwitch.load();

      const off = startup({ enableSelfHealing: false });
      const on = startup({ enableSelfHealing: true });
      expect(healingSwitch.isEnabled(off)).to.equal(false);
      expect(healingSwitch.isEnabled(on)).to.equal(true);
      // However many commands follow, it is said once, at the load.
      expect(warn.calledOnce).to.equal(true);
      expect(String(warn.firstCall.args[0])).to.match(/self-healing/i);
      expect(String(warn.firstCall.args[0])).to.include('db is down');
    });

    it('uses the startup option until it has loaded', () => {
      expect(healingSwitch.isEnabled({ enableSelfHealing: false })).to.equal(false);
      expect(healingSwitch.isEnabled({ enableSelfHealing: true })).to.equal(true);
    });
  });
});
