import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { VisionAssertionService } from '../../src/services/omni-vision/VisionAssertionService';
import { AI_SERVICE } from '../../src/services/AIService';

/**
 * `xenon: assertVisualState` answered `{ result: true, message: 'Assertion
 * placeholder' }` whenever the AI step gave it nothing usable: with no AI
 * provider, when the provider failed, and usually even with one, because the
 * condition was wrapped in a "find the centre coordinates, answer {x, y}"
 * prompt. A test asserting a screen state passed without anything being
 * checked.
 *
 * Now it asks the provider a yes/no question of the screenshot and answers
 * with the provider's verdict. Whenever there is no verdict (no provider, a
 * failed call, an answer that isn't true or false, no screenshot, no
 * condition) it fails with an error the test sees, never `true` and never
 * `false`: a `false` would pass a test that asserts a state is absent.
 */
describe('xenon: assertVisualState', () => {
  const SCREEN = 'c2NyZWVuc2hvdA==';
  let service: VisionAssertionService;
  let driver: { getScreenshot: sinon.SinonStub };

  beforeEach(() => {
    service = new VisionAssertionService();
    driver = { getScreenshot: sinon.stub().resolves(SCREEN) };
    // The real provider set-up reads the server's AI settings; these tests set the provider themselves.
    sinon.stub(AI_SERVICE as any, 'initializeProvider');
  });
  afterEach(() => sinon.restore());

  const failureOf = (p: Promise<unknown>) =>
    p.then(
      (value) => {
        throw new Error(`expected a failure, got ${JSON.stringify(value)}`);
      },
      (e: Error) => e,
    );

  function withProvider(answer: string | Error) {
    sinon.stub(AI_SERVICE as any, 'provider').value({ analyze: async () => '' });
    const call = sinon.stub(AI_SERVICE as any, 'callProvider');
    if (answer instanceof Error) call.rejects(answer);
    else call.resolves(answer);
    return call;
  }

  it('fails, rather than passing, when no AI provider is configured', async () => {
    sinon.stub(AI_SERVICE as any, 'provider').value(null);
    const err = await failureOf(service.assertState(driver, 'The Login button is visible'));
    expect(err.message).to.match(/No AI provider is configured/);
    expect(err.message).to.match(/not checked/);
  });

  it('asks a yes/no question about the condition, with the screenshot', async () => {
    const call = withProvider('{"result": true, "reason": "A Login button is shown."}');
    const answer = await service.assertState(driver, 'The Login button is visible');
    expect(answer).to.deep.equal({ result: true, message: 'A Login button is shown.' });
    expect(call.calledOnce).to.equal(true);
    const [prompt, image] = call.firstCall.args;
    expect(image).to.equal(SCREEN);
    expect(prompt).to.include('The Login button is visible');
    expect(prompt).to.match(/true or false/i);
    expect(prompt).to.not.match(/coordinates/i);
  });

  it("answers false when the provider says the condition doesn't hold", async () => {
    withProvider('```json\n{"result": false, "reason": "The cart shows 2 items."}\n```');
    expect(await service.assertState(driver, 'The cart is empty')).to.deep.equal({
      result: false,
      message: 'The cart shows 2 items.',
    });
  });

  it("fails when the provider's answer is not a true/false verdict", async () => {
    for (const answer of ['{"x": 120, "y": 340}', 'Yes, I can see it.', '{"result": "maybe"}']) {
      sinon.restore();
      sinon.stub(AI_SERVICE as any, 'initializeProvider');
      driver = { getScreenshot: sinon.stub().resolves(SCREEN) };
      withProvider(answer);
      const err = await failureOf(service.assertState(driver, 'The cart is empty'));
      expect(err.message, answer).to.match(/could not read/i);
    }
  });

  it('fails when the provider call fails', async () => {
    withProvider(new Error('429 quota exceeded'));
    const err = await failureOf(service.assertState(driver, 'The cart is empty'));
    expect(err.message).to.match(/429 quota exceeded/);
  });

  it('fails when the provider is rate-limited', async () => {
    // Gemini's provider answers this instead of throwing on a 429.
    withProvider('CONNECTION_OK_RATE_LIMITED');
    const err = await failureOf(service.assertState(driver, 'The cart is empty'));
    expect(err.message).to.match(/rate-limited/i);
  });

  it('fails without asking when there is no condition', async () => {
    const call = withProvider('{"result": true, "reason": "ok"}');
    for (const empty of ['', '   ', undefined as unknown as string]) {
      const err = await failureOf(service.assertState(driver, empty));
      expect(err.message).to.match(/needs a condition/);
    }
    expect(call.called).to.equal(false);
    expect(driver.getScreenshot.called).to.equal(false);
  });

  it('fails when no screenshot can be taken', async () => {
    const call = withProvider('{"result": true, "reason": "ok"}');
    driver.getScreenshot.rejects(new Error('WDA is not running'));
    const err = await failureOf(service.assertState(driver, 'The cart is empty'));
    expect(err.message).to.match(/WDA is not running/);
    expect(call.called).to.equal(false);
  });
});
