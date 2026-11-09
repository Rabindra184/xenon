import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { AIRedactionInvalid, AIScreenshotWithheld, AIService } from '../../src/services/AIService';
import {
  describeAiRedaction,
  passesLuhn,
  readAiRedaction,
  redactText,
} from '../../src/services/ai/aiRedaction';
import { PluginContext } from '../../src/PluginContext';
import { PROVIDERS, useFakeAiProviders } from '../helpers/fake-ai-provider';

/**
 * Healing tiers 4 and 5, failure analysis and the visual commands send the
 * screen, the page source, command answers and device logs to the AI
 * provider. Through 2.23 they went as they were, so a lab with personal data
 * on its phones couldn't use them (Xenon Test's ENH-05). The server option
 * `aiRedaction` takes text out and can keep screenshots back, before any
 * provider's SDK sees the call.
 */
describe('AI redaction', () => {
  const only = (builtIn: string[]) => readAiRedaction({ builtIn });
  const redact = (text: string, builtIn: string[]) => redactText(text, only(builtIn)).text;

  describe('the built-in sets', () => {
    it('emails', () => {
      expect(redact('Signed in as jane.doe+qa@shop.example.co.uk today', ['emails'])).to.equal(
        'Signed in as [redacted email] today',
      );
      expect(redact('version 2.23.0 of @appium/base-driver', ['emails'])).to.equal(
        'version 2.23.0 of @appium/base-driver',
      );
    });

    it('phone numbers in international form, not dates, ids or bounds', () => {
      expect(redact('Call +44 20 7946 0958 or +1 (415) 555-0100', ['phoneNumbers'])).to.equal(
        'Call [redacted phone] or [redacted phone]',
      );
      for (const kept of [
        '2026-11-08 06:07:03',
        'bounds="[0,1440][1080,1920]"',
        'order 20261108123456',
        'offset +5 minutes',
      ]) {
        expect(redact(kept, ['phoneNumbers']), kept).to.equal(kept);
      }
    });

    it('card numbers that pass the Luhn check, not other long numbers', () => {
      expect(passesLuhn('4111111111111111')).to.equal(true);
      expect(passesLuhn('4111111111111112')).to.equal(false);
      expect(redact('Card 4111 1111 1111 1111 saved', ['cardNumbers'])).to.equal(
        'Card [redacted card] saved',
      );
      expect(redact('5555-5555-5555-4444', ['cardNumbers'])).to.equal('[redacted card]');
      expect(redact('order 4111111111111112', ['cardNumbers'])).to.equal('order 4111111111111112');
    });

    it('tokens and passwords, keeping the key', () => {
      const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c3IifQ.c2lnbmF0dXJlLWhlcmU';
      expect(redact(`auth ${jwt} ok`, ['secrets'])).to.equal('auth [redacted token] ok');
      expect(redact('Authorization: Bearer abc123def456ghi', ['secrets'])).to.equal(
        'Authorization: Bearer [redacted token]',
      );
      expect(redact('{"password":"hunter2!"}', ['secrets'])).to.equal('{"password":"[redacted]"}');
      expect(redact('<node text="" password="hunter2"/>', ['secrets'])).to.equal(
        '<node text="" password="[redacted]"/>',
      );
      expect(redact('api_key=AKIA1234567890', ['secrets'])).to.equal('api_key=[redacted]');
      expect(redact('A token is required', ['secrets'])).to.equal('A token is required');
    });
  });

  describe("the lab's own rules", () => {
    it("use Appium's log-filters format, replaced by [redacted] unless they say", () => {
      const redaction = readAiRedaction({
        rules: [
          'Jane Doe',
          { text: 'ACME-1234' },
          { pattern: '(account )\\d{6,}', flags: 'i', replacer: '$1######' },
        ],
      });
      const out = redactText('Jane Doe paid ACME-1234 from Account 12345678', redaction);
      expect(out.text).to.equal('[redacted] paid [redacted] from Account ######');
      expect(out.replaced).to.equal(3);
    });
  });

  describe('a configuration', () => {
    it('unset redacts nothing', () => {
      const none = readAiRedaction(undefined);
      expect(none.active).to.equal(false);
      expect(redactText('jane@shop.example.com', none).text).to.equal('jane@shop.example.com');
    });

    it("that can't be read fails closed, saying why", () => {
      for (const bad of [
        'emails',
        { builtIn: ['emails', 'addresses'] },
        { rules: [{ pattern: '(' }] },
        { rules: 'x' },
        { screenshots: 'blur' },
      ]) {
        const read = readAiRedaction(bad);
        expect(read.error, JSON.stringify(bad)).to.match(/aiRedaction is not valid/);
        expect(read.screenshots).to.equal('withhold');
      }
    });

    it('is described by names and counts, never its patterns', () => {
      const described = describeAiRedaction(
        readAiRedaction({ builtIn: ['emails'], rules: ['Jane Doe'], screenshots: 'withhold' }),
      );
      expect(described).to.deep.equal({
        builtIn: ['emails'],
        rules: 1,
        screenshots: 'withhold',
        valid: true,
      });
      expect(JSON.stringify(described)).not.to.include('Jane');
    });
  });

  describe('every AI call, through each provider', () => {
    const ai = useFakeAiProviders();
    const SCREEN = 'c2NyZWVuLXdpdGgtamFuZS1kb2U=';
    const PAGE =
      '<hierarchy><android.widget.TextView text="jane.doe@shop.example.com" />' +
      '<android.widget.EditText password="hunter2!" /><android.widget.TextView text="Jane Doe" /></hierarchy>';
    let savedArgs: any;

    beforeEach(() => {
      savedArgs = Container.get(PluginContext).pluginArgs;
    });
    afterEach(() => {
      Container.get(PluginContext).pluginArgs = savedArgs;
      sinon.restore();
    });

    const setRedaction = (aiRedaction: unknown) => {
      const context = Container.get(PluginContext);
      context.pluginArgs = { ...context.pluginArgs, aiRedaction } as any;
    };

    for (const provider of PROVIDERS) {
      it(`${provider}: the provider gets the call redacted, and no withheld screenshot`, async () => {
        ai.use(provider);
        ai.answer({ text: '{"recommendedXpath": "//x", "reason": "r"}' });
        setRedaction({
          builtIn: ['emails', 'secrets'],
          rules: ['Jane Doe'],
          screenshots: 'withhold',
        });

        await new AIService().healLocator({
          selector: '//android.widget.Button[@text="Pay"]',
          strategy: 'xpath',
          xml: PAGE,
          screenshotBase64: SCREEN,
        });

        expect(ai.calls).to.have.length(1);
        const sent = ai.calls[0].body;
        for (const secret of ['jane.doe@shop.example.com', 'hunter2!', 'Jane Doe', SCREEN]) {
          expect(sent, `${provider} was sent ${secret}`).not.to.include(secret);
        }
        expect(sent).to.include('[redacted email]');
        expect(sent).to.include('Pay');
      });
    }

    it('sends everything as before with no redaction set', async () => {
      ai.use('openai');
      ai.answer({ text: '{"recommendedXpath": "//x", "reason": "r"}' });
      setRedaction(undefined);

      await new AIService().healLocator({
        selector: '//x',
        strategy: 'xpath',
        xml: PAGE,
        screenshotBase64: SCREEN,
      });

      expect(ai.calls[0].body).to.include('jane.doe@shop.example.com');
      expect(ai.calls[0].body).to.include(SCREEN);
    });

    it('refuses the calls that need a screenshot, without calling the provider', async () => {
      ai.use('anthropic');
      ai.answer({ text: 'true' });
      setRedaction({ screenshots: 'withhold' });
      const service = new AIService();

      const errors = await Promise.all([
        service.assertVisual(SCREEN, 'The cart is empty').catch((e) => e),
        service.describeScreen(SCREEN).catch((e) => e),
        service.visualFind(SCREEN, 'the cart icon', { throwOnError: true }).catch((e) => e),
      ]);

      for (const error of errors) expect(error).to.be.instanceOf(AIScreenshotWithheld);
      // A visual heal finds nothing and healing goes on.
      expect(await service.visualFind(SCREEN, 'the cart icon')).to.equal(null);
      expect(ai.calls).to.have.length(0);
    });

    it("refuses every call while the configuration can't be read", async () => {
      ai.use('gemini');
      ai.answer({ text: 'x' });
      setRedaction({ builtIn: ['addresses'] });

      const error = await new AIService()
        .healLocator({ selector: '//x', strategy: 'xpath', xml: PAGE })
        .catch((e) => e);

      // healLocator gives up quietly on a failed call; nothing was sent.
      expect(error === null || error instanceof AIRedactionInvalid).to.equal(true);
      expect(ai.calls).to.have.length(0);
    });
  });
});
