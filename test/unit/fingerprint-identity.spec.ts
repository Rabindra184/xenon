import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { HealEtalonService, LocatorSignature } from '../../src/services/healing/HealEtalonService';
import { HealedLocatorGenerator } from '../../src/services/healing/HealedLocatorGenerator';
import { FuzzyXmlHealingProvider } from '../../src/services/healing/FuzzyXmlHealingProvider';
import { RESILIO_PATH_FORMAT } from '../../src/services/healing/resilioPath';
import {
  attributesToLearn,
  resourceIdName,
  sameIdentifier,
  sameText,
} from '../../src/services/healing/fingerprintIdentity';
import { waitFor } from '../../src/services/autowait/waitFor';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A fingerprint has to say which element it is, not only where it was.
 *
 * Through 2.14, learning asked the driver for `getElementAttribute`, which
 * UiAutomator2 and XCUITest don't have (the command is `getAttribute(name,
 * elementId)`). Every read failed quietly, so a learnt fingerprint held only
 * the element's type and rect. Fuzzy XML weighs position at 5 of about 8, so
 * any element of that type at that spot healed the selector: on an unexpected
 * screen, the test tapped whatever button sat where "Pay" used to be.
 */
describe('selector fingerprints identify their element', () => {
  let restoreContainer: () => void;

  beforeEach(() => {
    restoreContainer = saveRegistrations(HealEtalonService, HealedLocatorGenerator);
    Container.set(HealedLocatorGenerator, new HealedLocatorGenerator());
  });

  afterEach(() => {
    sinon.restore();
    restoreContainer();
  });

  describe('learning', () => {
    let saved: sinon.SinonStub;
    let existing: Partial<LocatorSignature> | null;

    beforeEach(() => {
      existing = null;
      saved = sinon.stub().resolves();
      Container.set(HealEtalonService, {
        getSignature: async () => existing,
        saveSignature: saved,
      } as unknown as HealEtalonService);
    });

    let asked: string[];
    beforeEach(() => {
      asked = [];
    });

    /**
     * UiAutomator2 as it is: getAttribute(name, elementId) answers
     * String(value), so an unset attribute is the string "null", and an
     * attribute it doesn't know throws.
     */
    const androidDriver = () => ({
      caps: { platformName: 'Android' },
      getAttribute: async (name: string, elementId: string) => {
        expect(elementId).to.equal('el-1');
        asked.push(name);
        const known: Record<string, string | null> = {
          'resource-id': 'com.shop:id/pay',
          text: 'Pay now',
          name: 'Pay now',
          'content-desc': null,
          hint: null,
        };
        if (!(name in known)) throw new Error(`No such attribute '${name}'`);
        return String(known[name]);
      },
      getElementRect: async () => ({ x: 40, y: 900, width: 300, height: 96 }),
      getName: async () => 'android.widget.Button',
      getPageSource: async () =>
        '<hierarchy><android.widget.Button text="Pay now" resource-id="com.shop:id/pay" bounds="[40,900][340,996]"/></hierarchy>',
    });

    /** XCUITest as it is: WebDriverAgent throws for an attribute it doesn't have. */
    const iosDriver = () => ({
      caps: { platformName: 'iOS' },
      getAttribute: async (name: string) => {
        asked.push(name);
        const known: Record<string, string> = { name: 'checkout.pay', label: 'Pay now' };
        if (!(name in known)) throw new Error('FBUnknownAttributeException');
        return known[name];
      },
      getElementRect: async () => ({ x: 20, y: 800, width: 388, height: 50 }),
      getName: async () => 'XCUIElementTypeButton',
      getPageSource: async () =>
        '<AppiumAUT><XCUIElementTypeButton name="checkout.pay" label="Pay now" x="20" y="800" width="388" height="50"/></AppiumAUT>',
    });

    let sessions = 0;
    async function learn(driver: object) {
      sessions += 1;
      const interceptor = Container.get(CommandInterceptor) as any;
      await interceptor.triggerLearning(
        driver,
        ['id', 'com.shop:id/pay'],
        { ELEMENT: 'el-1' },
        `fp-${sessions}`,
      );
      const done = await waitFor(async () => (saved.called ? true : null), {
        timeoutMs: 2000,
        intervalMs: 5,
      });
      return 'value' in done;
    }

    it("reads an Android element's attributes with the driver's getAttribute", async () => {
      expect(await learn(androidDriver())).to.equal(true);

      const [strategy, selector, node] = saved.firstCall.args;
      expect([strategy, selector]).to.deep.equal(['id', 'com.shop:id/pay']);
      const identity = node.attributes.filter(
        (a: any) => !['x', 'y', 'width', 'height'].includes(a.name),
      );
      // "null" is UiAutomator2's answer for an attribute the element hasn't set.
      expect(identity).to.deep.equal([
        { name: 'resource-id', value: 'com.shop:id/pay' },
        { name: 'text', value: 'Pay now' },
      ]);
      // Only what UiAutomator2 has, and never a field's value.
      expect(asked.sort()).to.deep.equal(['content-desc', 'hint', 'resource-id', 'text']);
    });

    it("reads an iPhone element's identifier and label", async () => {
      expect(await learn(iosDriver())).to.equal(true);

      const node = saved.firstCall.args[2];
      expect(node.attributes).to.deep.include({ name: 'name', value: 'checkout.pay' });
      expect(node.attributes).to.deep.include({ name: 'label', value: 'Pay now' });
      // WebDriverAgent throws for any other: no round trips that can only fail.
      expect(asked.sort()).to.deep.equal(['label', 'name']);
    });

    it('learns again a fingerprint that has a path but nothing that says which element it is', async () => {
      existing = {
        nodeName: 'android.widget.Button',
        attributes: { x: '40', y: '900', width: '300', height: '96' },
        path: { format: RESILIO_PATH_FORMAT, nodes: [{ tag: 'hierarchy' }] },
      };

      expect(await learn(androidDriver())).to.equal(true);
    });
  });

  it("doesn't keep an element's value, which is what a test typed into a field", async () => {
    const service = new HealEtalonService();
    const store = { saveSignature: sinon.stub().resolves() };
    (service as any).store = store;

    await service.saveSignature('id', 'email', {
      nodeName: 'XCUIElementTypeTextField',
      attributes: [
        { name: 'name', value: 'signup.email' },
        { name: 'value', value: 'jane.doe@example.com' },
      ],
    });

    expect(store.saveSignature.firstCall.args[0].attributes).to.deep.equal({
      name: 'signup.email',
    });
  });

  describe('Fuzzy XML', () => {
    const ORDER_TITLE =
      '<android.widget.TextView text="Order #1042" resource-id="com.shop:id/title" bounds="[48,100][1032,180]"/>';
    const IOS_APP_RECT = 'name="Shop" label="Shop" x="0" y="0" width="428" height="926"';
    let fingerprint: Partial<LocatorSignature> | null;
    let resolved: string[];

    beforeEach(() => {
      fingerprint = null;
      resolved = [];
    });

    function heal(selector: string, strategy: string, pageSource: string) {
      const provider = new FuzzyXmlHealingProvider({
        getSignature: async () => fingerprint,
      } as unknown as HealEtalonService);
      return provider.heal({
        sessionId: 's',
        strategy,
        selector,
        pageSource,
        driver: {
          findElement: async (_using: string, xpath: string) => {
            resolved.push(xpath);
            return { ELEMENT: 'healed-1' };
          },
        },
      } as any);
    }

    const android = (button: string) =>
      `<hierarchy><android.widget.FrameLayout bounds="[0,0][1080,1920]">${ORDER_TITLE}` +
      `${button}</android.widget.FrameLayout></hierarchy>`;

    const AT_PAY = { x: '40', y: '900', width: '300', height: '96' };
    const PAY = {
      nodeName: 'android.widget.Button',
      attributes: {
        'resource-id': 'com.shop:id/pay',
        text: 'Pay now',
        x: '40',
        y: '900',
        width: '300',
        height: '96',
      },
    };

    it("doesn't heal to a different element at the same spot", async () => {
      fingerprint = PAY;
      const cancel = android(
        '<android.widget.Button text="Cancel order" resource-id="com.shop:id/cancel" bounds="[40,900][340,996]"/>',
      );

      expect(await heal('com.shop:id/pay', 'id', cancel)).to.equal(null);
    });

    it('heals an element whose id was renamed and kept its text', async () => {
      fingerprint = PAY;
      const renamed = android(
        '<android.widget.Button text="Pay now" resource-id="com.shop:id/checkout_pay" bounds="[40,900][340,996]"/>',
      );

      const healed = await heal('com.shop:id/pay', 'id', renamed);

      expect(healed?.id).to.equal('healed-1');
      expect(resolved[0]).to.match(/checkout_pay|Pay now/);
    });

    it('heals an element that kept its id and changed its text', async () => {
      fingerprint = PAY;
      const reworded = android(
        '<android.widget.Button text="Pay" resource-id="com.shop:id/pay" bounds="[40,900][340,996]"/>',
      );

      expect(
        (await heal("//android.widget.Button[@text='Pay now']", 'xpath', reworded))?.id,
      ).to.equal('healed-1');
    });

    const ios = (button: string) =>
      `<AppiumAUT><XCUIElementTypeApplication ${IOS_APP_RECT}>` +
      `${button}</XCUIElementTypeApplication></AppiumAUT>`;

    const IOS_PAY = {
      nodeName: 'XCUIElementTypeButton',
      attributes: {
        name: 'checkout.pay',
        label: 'Pay now',
        x: '20',
        y: '800',
        width: '388',
        height: '50',
      },
    };

    it('reads an iOS accessibility identifier the same way', async () => {
      fingerprint = IOS_PAY;
      const cancel = ios(
        '<XCUIElementTypeButton name="checkout.cancel" label="Cancel order" x="20" y="800" width="388" height="50"/>',
      );
      const reworded = ios(
        '<XCUIElementTypeButton name="checkout.pay" label="Pay" x="20" y="800" width="388" height="50"/>',
      );

      expect(await heal('checkout.pay', 'accessibility id', cancel)).to.equal(null);
      expect((await heal('checkout.pay', 'accessibility id', reworded))?.id).to.equal('healed-1');
    });

    it("doesn't heal to the opposite button", async () => {
      fingerprint = {
        nodeName: 'android.widget.Button',
        attributes: { 'resource-id': 'com.shop:id/login', text: 'Log in', ...AT_PAY },
      };
      const logout = android(
        '<android.widget.Button text="Log out" resource-id="com.shop:id/logout" bounds="[40,900][340,996]"/>',
      );
      expect(await heal('com.shop:id/login', 'id', logout)).to.equal(null);

      fingerprint = {
        nodeName: 'XCUIElementTypeButton',
        attributes: {
          name: 'auth.signIn',
          label: 'Sign in',
          x: '20',
          y: '800',
          width: '388',
          height: '50',
        },
      };
      const signUp = ios(
        '<XCUIElementTypeButton name="auth.signUp" label="Sign up" x="20" y="800" width="388" height="50"/>',
      );
      expect(await heal('auth.signIn', 'accessibility id', signUp)).to.equal(null);
    });

    it('heals an element whose id was renamed outright and kept its text', async () => {
      fingerprint = PAY;
      const renamed = android(
        '<android.widget.Button text="Pay now" resource-id="com.shop:id/btn_primary" bounds="[40,900][340,996]"/>',
      );

      expect((await heal('com.shop:id/pay', 'id', renamed))?.id).to.equal('healed-1');
    });

    it('heals an icon whose id was renamed and kept its description', async () => {
      fingerprint = {
        nodeName: 'android.widget.ImageButton',
        attributes: { 'resource-id': 'com.shop:id/share', 'content-desc': 'Share', ...AT_PAY },
      };
      const icon = android(
        '<android.widget.ImageButton content-desc="Share" resource-id="com.shop:id/action_3" bounds="[40,900][340,996]"/>',
      );

      expect((await heal('com.shop:id/share', 'id', icon))?.id).to.equal('healed-1');
    });

    it("compares resource-ids without the app's package, as a debug build's differs", async () => {
      fingerprint = {
        nodeName: 'android.widget.Button',
        attributes: { 'resource-id': 'com.shop.debug:id/pay', text: 'Pay now', ...AT_PAY },
      };
      const release = android(
        '<android.widget.Button text="Pay" resource-id="com.shop:id/pay" bounds="[40,900][340,996]"/>',
      );

      expect((await heal('com.shop.debug:id/pay', 'id', release))?.id).to.equal('healed-1');
    });

    it('reads the text again when an id gains words, as pay_later or undo_delete do', async () => {
      fingerprint = PAY;
      const later = android(
        '<android.widget.Button text="Pay later" resource-id="com.shop:id/pay_later" bounds="[40,900][340,996]"/>',
      );
      expect(await heal('com.shop:id/pay', 'id', later)).to.equal(null);

      fingerprint = {
        nodeName: 'android.widget.Button',
        attributes: { 'resource-id': 'com.mail:id/delete', text: 'Delete', ...AT_PAY },
      };
      const undo = android(
        '<android.widget.Button text="Undo delete" resource-id="com.mail:id/undo_delete" bounds="[40,900][340,996]"/>',
      );
      expect(await heal('com.mail:id/delete', 'id', undo)).to.equal(null);
    });

    it("doesn't heal an icon with no text whose id names another", async () => {
      fingerprint = {
        nodeName: 'android.widget.ImageButton',
        attributes: { 'resource-id': 'com.shop:id/cart', ...AT_PAY },
      };
      const menu = android(
        '<android.widget.ImageButton resource-id="com.shop:id/menu" bounds="[40,900][340,996]"/>',
      );

      expect(await heal('com.shop:id/cart', 'id', menu)).to.equal(null);
    });

    it('tells non-Latin identifiers and labels apart', async () => {
      fingerprint = {
        nodeName: 'XCUIElementTypeButton',
        attributes: {
          name: 'checkout.pay',
          label: '支払う',
          x: '20',
          y: '800',
          width: '388',
          height: '50',
        },
      };
      const cancel = ios(
        '<XCUIElementTypeButton name="キャンセル" label="キャンセル" x="20" y="800" width="388" height="50"/>',
      );

      expect(await heal('checkout.pay', 'accessibility id', cancel)).to.equal(null);
    });

    it('heals a heal-written fingerprint from a debug build, which has no position', async () => {
      // A heal stores the element of the page source: on Android its rect is
      // bounds, not x and y, so the id and the text are all there is.
      fingerprint = {
        nodeName: 'android.widget.Button',
        attributes: { 'resource-id': 'com.shop.debug:id/pay', text: 'Pay now' },
      };
      const release = android(
        '<android.widget.Button text="Pay" resource-id="com.shop:id/pay" bounds="[40,1200][340,1296]"/>',
      );

      expect((await heal('com.shop.debug:id/pay', 'id', release))?.id).to.equal('healed-1');
    });

    it('heals a heal-written fingerprint whose id was renamed outright and kept its text', async () => {
      // No position: the score rests on the type, the text and the id. An id
      // of the same app still earns a share of its weight, as through 2.14.
      fingerprint = {
        nodeName: 'android.widget.Button',
        attributes: { 'resource-id': 'com.shop:id/pay', text: 'Pay now' },
      };
      const renamed = android(
        '<android.widget.Button text="Pay now" resource-id="com.shop:id/btn_primary" bounds="[40,1200][340,1296]"/>',
      );

      expect((await heal('com.shop:id/pay', 'id', renamed))?.id).to.equal('healed-1');
    });

    it('reads the text of an element with no id where one with an id was, as on iOS', async () => {
      fingerprint = PAY;
      const cancel = android(
        '<android.widget.Button text="Cancel order" bounds="[40,900][340,996]"/>',
      );
      expect(await heal('com.shop:id/pay', 'id', cancel)).to.equal(null);

      const idDropped = android(
        '<android.widget.Button text="Pay now" bounds="[40,900][340,996]"/>',
      );
      expect((await heal('com.shop:id/pay', 'id', idDropped))?.id).to.equal('healed-1');
    });

    it('takes an id that merely contains the old one for another element', async () => {
      fingerprint = {
        nodeName: 'android.widget.Button',
        attributes: { 'resource-id': 'com.social:id/follow', text: 'Follow', ...AT_PAY },
      };
      const unfollow = android(
        '<android.widget.Button text="Unfollow" resource-id="com.social:id/unfollow" bounds="[40,900][340,996]"/>',
      );

      expect(await heal('com.social:id/follow', 'id', unfollow)).to.equal(null);
    });

    it('takes "null" for nothing, as UiAutomator2 answers for an unset attribute', async () => {
      fingerprint = {
        nodeName: 'android.widget.ImageView',
        attributes: { 'resource-id': 'null', 'content-desc': 'null', hint: 'null', ...AT_PAY },
      };
      const other = android(
        '<android.widget.ImageView content-desc="Delete account" bounds="[40,900][340,996]"/>',
      );

      expect(await heal('com.shop:id/avatar', 'id', other)).to.equal(null);
    });

    it("doesn't heal by position with a fingerprint that says nothing about the element", async () => {
      // As every fingerprint learnt through 2.14 was.
      fingerprint = {
        nodeName: 'android.widget.Button',
        attributes: { x: '40', y: '900', width: '300', height: '96' },
      };
      const cancel = android(
        '<android.widget.Button text="Cancel order" resource-id="com.shop:id/cancel" bounds="[40,900][340,996]"/>',
      );

      expect(await heal('com.shop:id/pay', 'id', cancel)).to.equal(null);
    });
  });

  describe('comparing names', () => {
    it('reads a resource-id without its package', () => {
      expect(resourceIdName('com.shop:id/pay')).to.equal('pay');
      expect(resourceIdName('com.shop.debug:id/pay_button')).to.equal('pay_button');
      expect(resourceIdName('pay')).to.equal('pay');
    });

    it('takes identifiers with the same words for the same', () => {
      expect(sameIdentifier('btn-pay', 'pay_btn')).to.equal(true);
      expect(sameIdentifier('payButton', 'pay_button')).to.equal(true);
      expect(sameIdentifier('Checkout.Pay', 'checkout_pay')).to.equal(true);
      // camelCase and accents in any script.
      expect(sameIdentifier('оплатаКнопка', 'оплата_кнопка')).to.equal(true);
      expect(sameIdentifier('cafe\u0301.order', 'caf\u00e9_order')).to.equal(true);
      // Neither has a letter or digit: nothing to tell them apart by.
      expect(sameIdentifier('___', '..')).to.equal(true);
    });

    it('takes any other identifier for another element', () => {
      // Words added: the text decides (pay_later, undo_delete).
      expect(sameIdentifier('pay', 'checkout_pay')).to.equal(false);
      expect(sameIdentifier('delete', 'undo_delete')).to.equal(false);
      // In any script.
      expect(sameIdentifier('支払う', 'キャンセル')).to.equal(false);
      expect(sameIdentifier('oplata', 'оплата')).to.equal(false);
      expect(sameIdentifier('checkout.pay', '___')).to.equal(false);
      expect(sameIdentifier('follow', 'unfollow')).to.equal(false);
      expect(sameIdentifier('pay', 'paypal')).to.equal(false);
      expect(sameIdentifier('ok', 'book')).to.equal(false);
      expect(sameIdentifier('checkout.cancel', 'checkout.pay')).to.equal(false);
    });

    it('takes texts as the same only when they read the same', () => {
      expect(sameText('Pay now', '  pay NOW!')).to.equal(true);
      expect(sameText('Log in', 'Log out')).to.equal(false);
      expect(sameText('Enable', 'Disable')).to.equal(false);
      expect(sameText('X', 'Exit')).to.equal(false);
      expect(sameText(' ', 'Anything')).to.equal(false);
    });

    it('keeps the marks that make a word another word, and composes accents first', () => {
      expect(sameText('भुगतान दें', 'भुगतान दो')).to.equal(false);
      expect(sameText('ยกเลิก', 'ยกเล็ก')).to.equal(false);
      expect(sameText('caf\u0065\u0301', 'caf\u00e9')).to.equal(true);
    });

    it('asks each platform for the attributes its driver has', () => {
      expect(attributesToLearn('Android')).to.deep.equal([
        'resource-id',
        'content-desc',
        'text',
        'hint',
      ]);
      expect(attributesToLearn('iOS')).to.deep.equal(['name', 'label']);
      expect(attributesToLearn('tvOS')).to.deep.equal(['name', 'label']);
      expect(attributesToLearn('mac')).to.deep.equal([
        'resource-id',
        'content-desc',
        'text',
        'hint',
        'name',
        'label',
      ]);
    });
  });
});
