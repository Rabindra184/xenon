import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import dashboard from '../../src/app/routers/dashboard';
import { config, Config } from '../../src/config';
import { WebConfigService } from '../../src/data-service/web-config-service';
import {
  AI_ENGINE_SETTINGS,
  AiEngineSettings,
  effectiveAiEngine,
} from '../../src/services/settings/aiEngineSettings';
import log from '../../src/logger';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * The AI engine page's choice of provider was kept in memory only: `POST
 * /config` changed the running server's settings and saved nothing, so a
 * restart went back to the provider the server was started with. The model and
 * base URL the same route accepts went the same way.
 *
 * They follow the other lab settings now: a value saved in the dashboard wins
 * over the plugin option or environment variable the server started with, which
 * wins over the default, and it applies to the next AI call without a restart.
 * API keys are never saved or sent: they stay in the server's environment.
 */
describe('the AI engine settings', () => {
  const scratch = useScratchDatabase();
  const AI_FIELDS: Array<keyof Config> = [
    'aiProvider',
    'aiModel',
    'aiBaseUrl',
    'geminiModel',
    'openaiModel',
    'anthropicModel',
    'ollamaModel',
    'geminiApiKey',
    'openaiApiKey',
    'anthropicApiKey',
  ];
  let startedWith: Partial<Config>;
  let restoreContainer: () => void;

  /** The AI settings the server was started with (its option, else its environment). */
  const startup = (over: Partial<Config> = {}) => {
    const blank: Partial<Config> = {};
    for (const field of AI_FIELDS) (blank as any)[field] = undefined;
    Object.assign(config, blank, { aiProvider: 'gemini' }, over);
  };

  /** A server process starting: nothing in memory, the settings read from the database. */
  const restart = async () => {
    Container.set(AiEngineSettings, new AiEngineSettings());
    await Container.get(AiEngineSettings).load();
  };

  beforeEach(async () => {
    startedWith = {};
    for (const field of AI_FIELDS) (startedWith as any)[field] = config[field];
    restoreContainer = saveRegistrations(AiEngineSettings);
    // A service of its own, as at boot, so nothing saved leaks in from another spec.
    Container.set(AiEngineSettings, new AiEngineSettings());
    await scratch.db.webConfig.deleteMany({});
  });

  afterEach(() => {
    Object.assign(config, startedWith);
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

  describe('the provider chosen on the page', () => {
    it('is saved, and shown by GET /config', async () => {
      startup({ anthropicApiKey: 'sk-ant-test' });
      const saved = await save({ aiProvider: 'anthropic' });
      expect(saved.status).to.equal(200);

      expect(await Container.get(WebConfigService).getConfig()).to.deep.equal({
        aiProvider: 'anthropic',
      });
      expect((await read()).body.aiProvider).to.equal('anthropic');
    });

    it('applies to the running server at once, with no restart', async () => {
      startup();
      await save({ aiProvider: 'openai' });
      expect(config.aiProvider).to.equal('openai');
    });

    it('is still the provider after a restart', async () => {
      startup();
      await save({ aiProvider: 'ollama' });

      startup(); // the process starts again with its option or environment: gemini
      await restart();
      expect(config.aiProvider).to.equal('ollama');
      expect((await read()).body.aiProvider).to.equal('ollama');
    });

    it('wins over the provider the server was started with', async () => {
      startup({ aiProvider: 'openai' });
      await save({ aiProvider: 'anthropic' });
      startup({ aiProvider: 'openai' });
      await restart();
      expect(config.aiProvider).to.equal('anthropic');
    });

    it('leaves the started-with provider in charge when nothing was saved', async () => {
      startup({ aiProvider: 'anthropic' });
      await restart();
      expect(config.aiProvider).to.equal('anthropic');
      expect((await read()).body.aiProvider).to.equal('anthropic');
    });

    it('goes back to the started-with provider when the saved one is cleared', async () => {
      startup({ aiProvider: 'openai' });
      await save({ aiProvider: 'anthropic' });
      await save({ aiProvider: '' });
      expect(config.aiProvider).to.equal('openai');
      startup({ aiProvider: 'openai' });
      await restart();
      expect(config.aiProvider).to.equal('openai');
    });

    it('is saved without touching the other settings', async () => {
      startup();
      await save({ buildCleanupDays: 7 });
      await save({ aiProvider: 'openai' });
      expect(await Container.get(WebConfigService).getConfig()).to.deep.equal({
        buildCleanupDays: 7,
        aiProvider: 'openai',
      });
    });
  });

  describe('the models and base URL', () => {
    it('are saved, applied at once, and kept across a restart', async () => {
      startup();
      const saved = await save({
        ollamaModel: 'llava',
        aiBaseUrl: 'http://gpu-box.lab:11434',
        geminiModel: 'gemini-2.5-pro',
        openaiModel: 'gpt-4.1',
        anthropicModel: 'claude-opus-4-1',
        aiModel: 'llava:13b',
      });
      expect(saved.status).to.equal(200);
      expect(config.ollamaModel).to.equal('llava');
      expect(config.aiBaseUrl).to.equal('http://gpu-box.lab:11434');

      startup();
      await restart();
      expect(config).to.include({
        ollamaModel: 'llava',
        aiBaseUrl: 'http://gpu-box.lab:11434',
        geminiModel: 'gemini-2.5-pro',
        openaiModel: 'gpt-4.1',
        anthropicModel: 'claude-opus-4-1',
        aiModel: 'llava:13b',
      });
      const shown = (await read()).body;
      expect(shown).to.include({ ollamaModel: 'llava', aiBaseUrl: 'http://gpu-box.lab:11434' });
    });

    it('win over the values the server was started with', async () => {
      startup({ ollamaModel: 'llama3', aiBaseUrl: 'http://localhost:11434' });
      await save({ ollamaModel: 'llava', aiBaseUrl: 'http://gpu-box.lab:11434' });
      startup({ ollamaModel: 'llama3', aiBaseUrl: 'http://localhost:11434' });
      await restart();
      expect(config.ollamaModel).to.equal('llava');
      expect(config.aiBaseUrl).to.equal('http://gpu-box.lab:11434');
    });

    it('go back to the started-with values when cleared with an empty value', async () => {
      startup({ ollamaModel: 'llama3', aiBaseUrl: 'http://localhost:11434' });
      await save({ ollamaModel: 'llava', aiBaseUrl: 'http://gpu-box.lab:11434' });
      await save({ ollamaModel: '', aiBaseUrl: '' });
      expect(config.ollamaModel).to.equal('llama3');
      expect(config.aiBaseUrl).to.equal('http://localhost:11434');
    });

    it('go back to no value at all when cleared and the server was started with none', async () => {
      startup();
      await save({ geminiModel: 'gemini-2.5-pro' });
      await save({ geminiModel: '' });
      expect(config.geminiModel).to.equal(undefined);
      expect((await read()).body.geminiModel).to.equal(undefined);
    });

    it('take surrounding spaces off a model name', async () => {
      startup();
      await save({ openaiModel: '  gpt-4.1  ' });
      expect(config.openaiModel).to.equal('gpt-4.1');
    });
  });

  describe('what is refused, with a 400 naming the setting and nothing saved', () => {
    const refused: Array<[string, unknown]> = [
      ['aiProvider', 'gpt'],
      ['aiProvider', 'Gemini'],
      ['aiProvider', 1],
      ['aiProvider', null],
      ['ollamaModel', 7],
      ['ollamaModel', 'llama 3'],
      ['geminiModel', 'a'.repeat(201)],
      ['aiModel', 'gpt-4o\nx'],
      ['aiBaseUrl', 'localhost:11434'],
      ['aiBaseUrl', 'ftp://models.lab/'],
      ['aiBaseUrl', 'not a url'],
      // A key in the address would be a key saved in the database.
      ['aiBaseUrl', 'https://user:secret@llm.lab/v1'],
      ['aiBaseUrl', 'https://llm.lab/v1?key=secret'],
    ];
    for (const [field, value] of refused) {
      it(`${field}: ${JSON.stringify(value)?.slice(0, 40)}`, async () => {
        startup();
        const answer = await save({ [field]: value, buildCleanupDays: 9 });
        expect(answer.status).to.equal(400);
        expect(answer.body).to.include({ error: 'invalid_setting', field });
        expect(answer.body.message).to.be.a('string').and.not.equal('');
        expect(await Container.get(WebConfigService).getConfig()).to.deep.equal({});
        expect(config.aiProvider).to.equal('gemini');
      });
    }
  });

  describe('API keys', () => {
    it('are never saved, and never change the running server', async () => {
      startup({ geminiApiKey: 'server-key' });
      const answer = await save({
        aiProvider: 'gemini',
        geminiApiKey: 'page-key',
        openaiApiKey: 'page-key',
        anthropicApiKey: 'page-key',
      });
      expect(answer.status).to.equal(200);
      expect(config.geminiApiKey).to.equal('server-key');
      expect(config.openaiApiKey).to.equal(undefined);
      const rows = await scratch.db.webConfig.findMany();
      expect(rows.map((row) => row.name)).to.deep.equal(['aiProvider']);
      expect(JSON.stringify(rows)).not.to.include('page-key');
    });

    it('are never sent from the started-with base URL either', async () => {
      // A key in the address: POST /config refuses one, but the environment
      // can still hold it. GET /config is open to every admin.
      startup({
        aiProvider: 'openai',
        aiBaseUrl: 'https://lab:pw-secret@llm.lab/v1?key=key-secret&region=eu',
      });
      const shown = (await read()).body.aiBaseUrl as string;
      expect(shown).not.to.include('pw-secret');
      expect(shown).not.to.include('key-secret');
      expect(shown).to.include('llm.lab/v1');
      // The server still uses the address as it was given.
      expect(config.aiBaseUrl).to.equal(
        'https://lab:pw-secret@llm.lab/v1?key=key-secret&region=eu',
      );
    });

    it('are never sent, only whether one is set', async () => {
      startup({ geminiApiKey: 'server-key', aiProvider: 'gemini' });
      const shown = (await read()).body;
      expect(JSON.stringify(shown)).not.to.include('server-key');
      expect(shown).to.include({ geminiSet: true, openaiSet: false, anthropicSet: false });
    });
  });

  describe('the model parameters the page used to show', () => {
    it('are not sent: temperature, max tokens and top P were never used by any AI call', async () => {
      startup();
      await save({ aiTemperature: 0.2, aiMaxTokens: 1024, aiTopP: 0.5 });
      const shown = (await read()).body;
      expect(shown).not.to.have.any.keys('aiTemperature', 'aiMaxTokens', 'aiTopP');
      expect(await Container.get(WebConfigService).getConfig()).to.deep.equal({});
    });
  });

  describe('at boot', () => {
    it('a database that cannot be read leaves the started-with settings in charge, said once', async () => {
      startup({ aiProvider: 'anthropic' });
      sinon.stub(WebConfigService.prototype, 'getConfig').rejects(new Error('disk I/O error'));
      const warn = sinon.stub(log, 'warn');
      await restart();
      expect(config.aiProvider).to.equal('anthropic');
      expect(warn.callCount).to.equal(1);
      expect(String(warn.firstCall.args[0])).to.include('disk I/O error');
    });

    it('a saved value that could not work is skipped, not applied', async () => {
      startup({ aiProvider: 'openai' });
      // Written by hand: POST /config refuses it.
      await scratch.db.webConfig.create({
        data: { id: 'aiProvider', name: 'aiProvider', value: 'gpt' },
      });
      await restart();
      expect(config.aiProvider).to.equal('openai');
    });
  });

  describe('effectiveAiEngine', () => {
    it('takes a saved value over the startup one, field by field', () => {
      expect(
        effectiveAiEngine(
          { aiProvider: 'gemini', ollamaModel: 'llama3', aiBaseUrl: 'http://a:1' },
          { aiProvider: 'ollama', aiBaseUrl: 'http://b:2' },
        ),
      ).to.deep.equal({
        aiProvider: 'ollama',
        aiModel: undefined,
        aiBaseUrl: 'http://b:2',
        geminiModel: undefined,
        openaiModel: undefined,
        anthropicModel: undefined,
        ollamaModel: 'llama3',
      });
    });

    it('falls back to gemini when neither names a provider', () => {
      expect(effectiveAiEngine({}, {}).aiProvider).to.equal('gemini');
      expect(effectiveAiEngine({}, { aiProvider: '' as any }).aiProvider).to.equal('gemini');
    });

    it("keeps a started-with provider it doesn't know, rather than pick another for it", () => {
      // AIService then runs with no provider, and says so; a fallback to gemini
      // would send screenshots somewhere the server's owner didn't choose.
      expect(effectiveAiEngine({ aiProvider: 'claude' as any }, {}).aiProvider).to.equal('claude');
    });

    it('names every setting it decides, and no key', () => {
      expect([...AI_ENGINE_SETTINGS].sort()).to.deep.equal(
        [
          'aiBaseUrl',
          'aiModel',
          'aiProvider',
          'anthropicModel',
          'geminiModel',
          'ollamaModel',
          'openaiModel',
        ].sort(),
      );
    });
  });
});
