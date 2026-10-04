import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { useScratchDatabase } from '../helpers/scratch-database';
import { useLokiStores } from '../helpers/loki-stores';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { android, ios, pageDriver } from '../helpers/page-sources';
import { PrismaHealEtalonStore } from '../../src/data-service/prisma-store';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import { ResilioTreeHealingProvider } from '../../src/services/healing/ResilioTreeHealingProvider';
import { HealingOrchestrator } from '../../src/services/healing/HealingOrchestrator';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';

/**
 * Self-healing's first tier, Resilio, finds an element by the path it had
 * through the screen's element tree when its selector last worked. Through
 * 2.14 it never found anything: the database dropped the path when it saved
 * the selector's fingerprint, and the provider gives up without one. Its
 * locators were also lowercase (an HTML parse of the page source), which the
 * drivers' XPath doesn't match, and it answered with the nearest element
 * however far it was, so with a path it would have healed to the wrong
 * button whenever the right one was gone.
 *
 * Here the path is learnt from a found element, stored in a scratch
 * database, and used on a changed screen. resiliotree runs for real; the
 * driver is a fake that runs each XPath on the page source.
 */

const FORM_A = android.page(
  android.layout(
    0,
    'login_form',
    '[0,200][1080,1400]',
    android.field(0, 'username', 'Username', '[40,240][1040,360]') +
      android.field(1, 'password', 'Password', '[40,400][1040,520]') +
      android.button(2, 'forgot', 'Forgot password?', '[40,560][1040,680]') +
      android.button(3, 'login', 'Log in', '[40,720][1040,840]'),
  ),
);
// The buttons moved into a new row, after a new "Sign up" button.
const FORM_MOVED = android.page(
  android.layout(
    0,
    'login_form',
    '[0,200][1080,1400]',
    android.field(0, 'username', 'Username', '[40,240][1040,360]') +
      android.field(1, 'password', 'Password', '[40,400][1040,520]') +
      android.layout(
        2,
        'actions',
        '[0,560][1080,1100]',
        android.button(0, 'signup', 'Sign up', '[40,560][1040,680]') +
          android.button(1, 'forgot', 'Forgot password?', '[40,720][1040,840]') +
          android.button(2, 'login', 'Log in', '[40,880][1040,1000]'),
      ),
  ),
);
// The button is another one now: new id, new text.
const FORM_RENAMED = android.page(
  android.layout(
    0,
    'login_form',
    '[0,200][1080,1400]',
    android.field(0, 'username', 'Username', '[40,240][1040,360]') +
      android.field(1, 'password', 'Password', '[40,400][1040,520]') +
      android.button(2, 'forgot', 'Forgot password?', '[40,560][1040,680]') +
      android.button(3, 'sign_in', 'Sign in', '[40,720][1040,840]'),
  ),
);
// The button is gone.
const FORM_GONE = android.page(
  android.layout(
    0,
    'login_form',
    '[0,200][1080,1400]',
    android.field(0, 'username', 'Username', '[40,240][1040,360]') +
      android.field(1, 'password', 'Password', '[40,400][1040,520]') +
      android.button(2, 'forgot', 'Forgot password?', '[40,560][1040,680]'),
  ),
);
// Two buttons the path can't tell apart.
const FORM_TWICE = android.page(
  android.layout(
    0,
    'login_form',
    '[0,200][1080,1400]',
    android.layout(
      0,
      '',
      '[0,200][1080,700]',
      android.button(0, 'login', 'Log in', '[40,720][1040,840]'),
    ) +
      android.layout(
        1,
        '',
        '[0,700][1080,1400]',
        android.button(0, 'login', 'Log in', '[40,720][1040,840]'),
      ),
  ),
);

// A positional XPath, as an inspector writes one: the second button of the form.
const POSITIONAL = "//*[@resource-id='com.example.shop:id/login_form']/android.widget.Button[2]";

describe('Resilio healing, from the path a selector had when it worked', function () {
  this.timeout(90_000);
  useScratchDatabase();
  let etalons: HealEtalonService;
  let restoreStore: () => void;

  beforeEach(() => {
    // The etalon service on the Prisma store (the scratch database), whatever
    // store this process picked.
    etalons = Container.get(HealEtalonService);
    const service = etalons as unknown as { store: unknown };
    const before = service.store;
    service.store = new PrismaHealEtalonStore();
    restoreStore = () => {
      service.store = before;
    };
  });

  afterEach(() => {
    restoreStore();
    sinon.restore();
  });

  describe('the fingerprint store', () => {
    const store = () => new PrismaHealEtalonStore();
    const fingerprint = (selector: string, path?: unknown) => ({
      selector,
      strategy: 'xpath',
      attributes: { 'resource-id': 'com.example.shop:id/login' },
      nodeName: 'android.widget.Button',
      path,
      lastSeen: Date.now(),
    });
    const PATH = { format: 'page-source-1', nodes: [{ tag: 'hierarchy', id: '', index: 0 }] };

    it("keeps a selector's path", async () => {
      await store().saveSignature(fingerprint('//keep-path', PATH));

      expect((await store().getSignature('//keep-path'))?.path).to.deep.equal(PATH);
    });

    it('keeps the path when a later fingerprint comes without one', async () => {
      await store().saveSignature(fingerprint('//keep-old-path', PATH));
      await store().saveSignature(fingerprint('//keep-old-path'));

      expect((await store().getSignature('//keep-old-path'))?.path).to.deep.equal(PATH);
    });
  });

  /** Learn `selector` as the interceptor does after a find, and wait for it. */
  async function learn(driver: ReturnType<typeof pageDriver>, selector: string) {
    const found = await driver.findElement('xpath', selector);
    (Container.get(CommandInterceptor) as any).triggerLearning(
      driver,
      ['xpath', selector],
      found,
      `learn-${selector}`,
    );
    for (let i = 0; i < 100; i++) {
      const signature = await etalons.getSignature(selector);
      if (signature?.path?.format === 'page-source-1') return signature;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no path was learnt for ${selector}`);
  }

  const heal = (driver: ReturnType<typeof pageDriver>, selector: string, pageSource: string) =>
    new ResilioTreeHealingProvider(etalons).heal({
      sessionId: 'resilio-session',
      driver,
      strategy: 'xpath',
      selector,
      pageSource,
    });

  it('finds an Android element that moved in the tree', async () => {
    const driver = pageDriver(FORM_A);
    await learn(driver, POSITIONAL);

    driver.show(FORM_MOVED);
    const healed = await heal(driver, POSITIONAL, FORM_MOVED);

    expect(healed, 'healed').to.not.equal(null);
    expect(healed!.id).to.equal('el:com.example.shop:id/login');
    expect(healed!.confidence).to.be.greaterThan(0.9);
    // The locator it suggests finds that element on the new screen.
    const again = await driver.findElement('xpath', healed!.recommendedSelector);
    expect(again.ELEMENT).to.equal('el:com.example.shop:id/login');
  });

  it('finds an iPhone element that moved in the tree', async () => {
    const before = ios.page(
      ios.group(
        ios.field('username', 'Username', 120) +
          ios.button('forgot', 'Forgot password?', 200) +
          ios.button('login', 'Log in', 260),
      ),
    );
    const after = ios.page(
      ios.group(
        ios.field('username', 'Username', 120) +
          ios.group(
            ios.button('signup', 'Sign up', 200) +
              ios.button('forgot', 'Forgot password?', 260) +
              ios.button('login', 'Log in', 320),
          ),
      ),
    );
    const selector = '//XCUIElementTypeOther/XCUIElementTypeButton[2]';
    const driver = pageDriver(before);
    await learn(driver, selector);

    driver.show(after);
    const healed = await heal(driver, selector, after);

    expect(healed?.id).to.equal('el:login');
    const again = await driver.findElement('xpath', healed!.recommendedSelector);
    expect(again.ELEMENT).to.equal('el:login');
  });

  it('leaves a renamed element to the next tier rather than guess', async () => {
    const driver = pageDriver(FORM_A);
    await learn(driver, POSITIONAL);

    driver.show(FORM_RENAMED);
    expect(await heal(driver, POSITIONAL, FORM_RENAMED)).to.equal(null);
  });

  it('does not take a neighbour when the element is gone', async () => {
    const driver = pageDriver(FORM_A);
    await learn(driver, POSITIONAL);

    driver.show(FORM_GONE);
    expect(await heal(driver, POSITIONAL, FORM_GONE)).to.equal(null);
  });

  it('does not pick one of two elements it cannot tell apart', async () => {
    const driver = pageDriver(FORM_A);
    await learn(driver, POSITIONAL);

    driver.show(FORM_TWICE);
    expect(await heal(driver, POSITIONAL, FORM_TWICE)).to.equal(null);
  });

  it('ignores a path an older Xenon stored, and learns it again', async () => {
    const selector = "//*[@resource-id='com.example.shop:id/login']";
    await etalons.saveSignature('xpath', selector, { nodeName: 'android.widget.Button' }, {
      nodes: [{ tag: 'html', id: '', index: 0 }],
    });
    const driver = pageDriver(FORM_A);
    expect(await heal(driver, selector, FORM_MOVED)).to.equal(null);

    const learnt = await learn(driver, selector);
    expect(learnt.path.format).to.equal('page-source-1');
  });

  it('learns the healed element’s path after a Fuzzy XML heal', async () => {
    const driver = pageDriver(FORM_MOVED);
    const save = sinon.spy(etalons, 'saveSignature');
    const orchestrator = new HealingOrchestrator(etalons);
    // Only Fuzzy XML (tier 2), which finds the button by the words in the selector.
    const healed = await orchestrator.attemptHealing(
      'fuzzy-session',
      Object.assign(driver, { getScreenshot: async () => 'aGVsbG8=' }),
      'xpath',
      "//android.widget.Button[@text='Log in' and @resource-id='com.example.shop:id/log_in']",
      [2],
    );

    expect(healed?.id).to.equal('el:com.example.shop:id/login');
    expect(save.called, 'fingerprint saved').to.equal(true);
    const path = save.lastCall.args[3];
    expect(path?.format).to.equal('page-source-1');
    expect(path.nodes[path.nodes.length - 1].id).to.equal('com.example.shop:id/login');
  });
});

describe('The in-memory fingerprint store', () => {
  useLokiStores();

  it('keeps the path when a later fingerprint comes without one', async () => {
    const store = DeviceStoreFactory.getHealEtalonStore();
    const PATH = { format: 'page-source-1', nodes: [{ tag: 'hierarchy', id: '', index: 0 }] };
    const fingerprint = { selector: '//loki-path', strategy: 'xpath', attributes: {} };
    await store.saveSignature({ ...fingerprint, nodeName: 'android.widget.Button', path: PATH });
    await store.saveSignature({ ...fingerprint, nodeName: 'android.widget.Button', path: undefined });

    expect((await store.getSignature('//loki-path'))?.path).to.deep.equal(PATH);
  });
});
