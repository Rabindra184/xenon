import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import { HealedLocatorGenerator } from '../../src/services/healing/HealedLocatorGenerator';
import { FuzzyXmlHealingProvider } from '../../src/services/healing/FuzzyXmlHealingProvider';
import { RESILIO_PATH_FORMAT } from '../../src/services/healing/resilioPath';
import { PrismaHealEtalonStore } from '../../src/data-service/prisma-store';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { readFingerprint } from '../../src/services/selector-health/fingerprintRead';
import {
  fingerprintKey,
  parseFingerprintKey,
  platformFamilyOf,
} from '../../src/services/healing/fingerprintKey';
import { typeFamilyOf } from '../../src/services/healing/elementType';
import { waitFor } from '../../src/services/autowait/waitFor';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import { useLokiStores } from '../helpers/loki-stores';

/**
 * A cross-platform suite uses one accessibility id on both apps
 * (`accessibility id = "Login"`). Through 2.36 fingerprints were kept by
 * selector text alone, so both platforms shared one: Android learnt it first,
 * iPhone sessions took it as complete and learnt nothing, and Fuzzy XML's
 * type gate refused every iPhone element against an `android.widget.Button`,
 * so healing went on to OCR and the AI tiers. Each save also replaced the
 * row's strategy with its own.
 */
describe('fingerprints are kept per platform and strategy', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  let etalons: HealEtalonService;
  let store: PrismaHealEtalonStore;
  let restoreContainer: () => void;
  let run = 0;
  let LOGIN = '';
  let sessions = 0;

  beforeEach(async () => {
    run += 1;
    // The interceptor remembers what it learnt again for the life of the
    // process, so each test has selectors of its own.
    LOGIN = `Login-${process.pid}-${run}`;
    restoreContainer = saveRegistrations(HealEtalonService, HealedLocatorGenerator);
    Container.set(HealedLocatorGenerator, new HealedLocatorGenerator());
    etalons = new HealEtalonService();
    store = new PrismaHealEtalonStore();
    (etalons as any).store = store;
    Container.set(HealEtalonService, etalons);
    await scratch.db.locatorEtalon.deleteMany({});
  });

  afterEach(() => {
    sinon.restore();
    restoreContainer();
  });

  const androidDriver = () => ({
    caps: { platformName: 'Android' },
    getAttribute: async (name: string) => {
      const known: Record<string, string | null> = {
        'resource-id': 'com.shop:id/login',
        text: 'Log in',
        'content-desc': LOGIN,
        hint: null,
        class: 'android.widget.Button',
      };
      if (!(name in known)) throw new Error(`No such attribute '${name}'`);
      return String(known[name]);
    },
    getElementRect: async () => ({ x: 40, y: 900, width: 300, height: 96 }),
    getName: async () => LOGIN,
    getPageSource: async () =>
      `<hierarchy><android.widget.Button text="Log in" resource-id="com.shop:id/login" content-desc="${LOGIN}" bounds="[40,900][340,996]"/></hierarchy>`,
  });

  const iosPage = (name: string) =>
    `<AppiumAUT><XCUIElementTypeApplication name="Shop" x="0" y="0" width="428" height="926"><XCUIElementTypeButton name="${name}" label="Log in" x="20" y="800" width="388" height="50"/></XCUIElementTypeApplication></AppiumAUT>`;

  const iosDriver = () => ({
    caps: { platformName: 'iOS' },
    getAttribute: async (name: string) => {
      const known: Record<string, string> = { name: LOGIN, label: 'Log in' };
      if (!(name in known)) throw new Error('FBUnknownAttributeException');
      return known[name];
    },
    getElementRect: async () => ({ x: 20, y: 800, width: 388, height: 50 }),
    getName: async () => 'XCUIElementTypeButton',
    getPageSource: async () => iosPage(LOGIN),
    findElement: async () => ({ ELEMENT: 'healed-1' }),
  });

  const android = (strategy = 'accessibility id') => ({ platformName: 'Android', strategy });
  const ios = (strategy = 'accessibility id') => ({ platformName: 'iOS', strategy });

  /** A find of `selector` that worked, as the interceptor learns from it. */
  function find(driver: object, selector: string, strategy = 'accessibility id') {
    sessions += 1;
    return (Container.get(CommandInterceptor) as any).triggerLearning(
      driver,
      [strategy, selector],
      { ELEMENT: 'el-1' },
      `fp-key-${sessions}`,
    );
  }

  /** Whether `scope`'s fingerprint of `selector` gets the type `nodeName` within the time. */
  async function learnt(
    selector: string,
    scope: { platformName: string; strategy: string },
    nodeName: string,
    timeoutMs = 2000,
  ): Promise<boolean> {
    const done = await waitFor(
      async () =>
        (await etalons.getSignature(selector, scope))?.nodeName === nodeName ? true : null,
      { timeoutMs, intervalMs: 10 },
    );
    return 'value' in done;
  }

  const PATH = { format: RESILIO_PATH_FORMAT, nodes: [{ tag: 'hierarchy', id: '', index: 0 }] };

  /** A row as 2.36 and earlier wrote it: under the bare selector. */
  const legacyRow = (selector: string, nodeName: string, attributes: Record<string, string>) =>
    store.saveSignature({
      selector,
      strategy: 'accessibility id',
      attributes,
      nodeName,
      path: PATH,
      lastSeen: Date.now(),
    });

  it("doesn't let an Android fingerprint stop an iPhone session learning its own", async () => {
    await find(androidDriver(), LOGIN);
    expect(await learnt(LOGIN, android(), 'android.widget.Button')).to.equal(true);

    await find(iosDriver(), LOGIN);
    expect(await learnt(LOGIN, ios(), 'XCUIElementTypeButton')).to.equal(true);

    // Each platform keeps its own.
    expect((await etalons.getSignature(LOGIN, android()))?.nodeName).to.equal(
      'android.widget.Button',
    );
    const rows = await scratch.db.locatorEtalon.findMany({ orderBy: { selector: 'asc' } });
    expect(rows.map((r) => r.selector)).to.deep.equal([
      fingerprintKey('android', 'accessibility id', LOGIN),
      fingerprintKey('ios', 'accessibility id', LOGIN),
    ]);
  });

  it('heals on an iPhone with the iPhone fingerprint, not the Android one', async () => {
    await find(androidDriver(), LOGIN);
    expect(await learnt(LOGIN, android(), 'android.widget.Button')).to.equal(true);
    await find(iosDriver(), LOGIN);
    expect(await learnt(LOGIN, ios(), 'XCUIElementTypeButton')).to.equal(true);

    // The button's identifier was renamed; its label and place are the same.
    const healed = await new FuzzyXmlHealingProvider(etalons).heal({
      sessionId: 'ios-heal',
      driver: iosDriver(),
      strategy: 'accessibility id',
      selector: LOGIN,
      pageSource: iosPage('auth.signIn'),
    });

    expect(healed?.id).to.equal('healed-1');
    expect(healed?.node?.getAttribute('name')).to.equal('auth.signIn');
  });

  it("ignores a fingerprint stored before 2.37 that is another platform's", async () => {
    await legacyRow(LOGIN, 'android.widget.Button', {
      'resource-id': 'com.shop:id/login',
      'content-desc': LOGIN,
    });

    expect(await etalons.getSignature(LOGIN, ios())).to.equal(null);
    expect((await etalons.getSignature(LOGIN, android()))?.nodeName).to.equal(
      'android.widget.Button',
    );

    await find(iosDriver(), LOGIN);
    expect(await learnt(LOGIN, ios(), 'XCUIElementTypeButton')).to.equal(true);
  });

  it("still uses a fingerprint stored before 2.37 that is the session's platform's", async () => {
    await legacyRow(LOGIN, 'XCUIElementTypeButton', { name: LOGIN, label: 'Log in' });
    const save = sinon.spy(etalons, 'saveSignature');

    const signature = await etalons.getSignature(LOGIN, ios());
    expect(signature?.nodeName).to.equal('XCUIElementTypeButton');
    expect(signature?.selector).to.equal(LOGIN);

    // Complete for the iPhone, so not learnt again.
    await find(iosDriver(), LOGIN);
    await new Promise((r) => setTimeout(r, 300));
    expect(save.called).to.equal(false);

    const healed = await new FuzzyXmlHealingProvider(etalons).heal({
      sessionId: 'ios-heal-legacy',
      driver: iosDriver(),
      strategy: 'accessibility id',
      selector: LOGIN,
      pageSource: iosPage('auth.signIn'),
    });
    expect(healed?.id).to.equal('healed-1');
  });

  it('ignores a fingerprint stored before 2.37 under another strategy', async () => {
    await legacyRow(LOGIN, 'XCUIElementTypeButton', { name: LOGIN, label: 'Log in' });

    expect(await etalons.getSignature(LOGIN, ios('id'))).to.equal(null);
  });

  it('tries a relearn that failed to save again at the next find', async () => {
    // Stored before 2.37 and complete but for its path: learnt again, once
    // per process.
    await store.saveSignature({
      selector: LOGIN,
      strategy: 'accessibility id',
      attributes: { 'resource-id': 'com.shop:id/login' },
      nodeName: 'android.widget.Button',
      lastSeen: Date.now(),
    });
    const write = sinon.stub(store, 'saveSignature');
    write.onFirstCall().rejects(new Error('database is locked'));
    write.callThrough();
    // A screen where the element's path can't be learnt, so what is learnt
    // again stays without one, and only the mark stops a third try.
    const driver = { ...androidDriver(), getPageSource: async () => '<hierarchy/>' };

    await find(driver, LOGIN);
    await waitFor(async () => (write.callCount >= 1 ? true : null), {
      timeoutMs: 2000,
      intervalMs: 10,
    });
    // Let the failed learning finish before the next find.
    await new Promise((r) => setTimeout(r, 100));

    await find(driver, LOGIN);
    const again = await waitFor(async () => (write.callCount >= 2 ? true : null), {
      timeoutMs: 2000,
      intervalMs: 10,
    });
    expect('value' in again, 'learnt again after the failed save').to.equal(true);
    await new Promise((r) => setTimeout(r, 100));

    // Saved now, so not learnt a third time in this process.
    await find(driver, LOGIN);
    await new Promise((r) => setTimeout(r, 300));
    expect(write.callCount).to.equal(2);
  });

  it("keeps each strategy's fingerprint of one selector text", async () => {
    await find(androidDriver(), LOGIN, 'id');
    expect(await learnt(LOGIN, android('id'), 'android.widget.Button')).to.equal(true);
    await find(androidDriver(), LOGIN, 'accessibility id');
    expect(await learnt(LOGIN, android(), 'android.widget.Button')).to.equal(true);

    expect((await etalons.getSignature(LOGIN, android('id')))?.strategy).to.equal('id');
    expect((await etalons.getSignature(LOGIN, android()))?.strategy).to.equal('accessibility id');
    expect(await readFingerprint({ strategy: 'id', selector: LOGIN }, undefined)).to.include({
      strategy: 'id',
    });
    expect(
      await readFingerprint({ strategy: 'accessibility id', selector: LOGIN }, undefined),
    ).to.include({ strategy: 'accessibility id' });
  });

  it("reads every platform's fingerprint of a selector, the newest first", async () => {
    await find(androidDriver(), LOGIN);
    expect(await learnt(LOGIN, android(), 'android.widget.Button')).to.equal(true);
    await new Promise((r) => setTimeout(r, 20));
    await find(iosDriver(), LOGIN);
    expect(await learnt(LOGIN, ios(), 'XCUIElementTypeButton')).to.equal(true);

    for (const strategy of ['accessibility id', '']) {
      const answer = await readFingerprint({ strategy, selector: LOGIN }, undefined);
      expect(answer).to.include({
        platform: 'ios',
        selector: LOGIN,
        type: 'XCUIElementTypeButton',
        strategy: 'accessibility id',
      });
      expect(answer?.platforms.map((p) => [p.platform, p.type])).to.deep.equal([
        ['ios', 'XCUIElementTypeButton'],
        ['android', 'android.widget.Button'],
      ]);
    }
    expect(await readFingerprint({ strategy: 'xpath', selector: LOGIN }, undefined)).to.equal(null);
  });

  it('keeps a session of neither platform on the bare selector, as before', async () => {
    const saved = await etalons.saveSignature(
      'id',
      LOGIN,
      { nodeName: 'Unknown', attributes: [{ name: 'name', value: LOGIN }] },
      undefined,
      'Windows',
    );
    expect(saved).to.equal(true);
    expect((await etalons.getSignature(LOGIN))?.nodeName).to.equal('Unknown');
    expect((await etalons.getSignature(LOGIN, { platformName: 'Windows' }))?.nodeName).to.equal(
      'Unknown',
    );
    // Its type says no platform, so neither family reads it.
    expect(await etalons.getSignature(LOGIN, android('id'))).to.equal(null);
    expect(await etalons.getSignature(LOGIN, ios('id'))).to.equal(null);
  });

  it('says a save failed', async () => {
    sinon.stub(store, 'saveSignature').rejects(new Error('database is locked'));
    expect(
      await etalons.saveSignature(
        'id',
        LOGIN,
        { nodeName: 'android.widget.Button' },
        null,
        'Android',
      ),
    ).to.equal(false);
  });
});

describe('the fingerprint key', () => {
  it('names the platform family and strategy, and reads back a selector holding |', () => {
    const key = fingerprintKey('ios', '-ios predicate string', "label == 'a|b'");
    expect(key).to.equal("fp1|ios|-ios predicate string|label == 'a|b'");
    expect(parseFingerprintKey(key)).to.deep.equal({
      family: 'ios',
      strategy: '-ios predicate string',
      selector: "label == 'a|b'",
    });
    expect(parseFingerprintKey('Login')).to.equal(null);
    expect(fingerprintKey(null, 'id', 'Login')).to.equal('Login');
  });

  it("reads a session's platform family", () => {
    expect(platformFamilyOf('Android')).to.equal('android');
    expect(platformFamilyOf('iOS')).to.equal('ios');
    expect(platformFamilyOf('tvOS')).to.equal('ios');
    expect(platformFamilyOf('Windows')).to.equal(null);
    expect(platformFamilyOf(undefined)).to.equal(null);
  });

  it("reads a stored type's platform, and none from a fallback or a description", () => {
    expect(typeFamilyOf('android.widget.Button')).to.equal('android');
    expect(typeFamilyOf('com.shop.PayButton')).to.equal('android');
    expect(typeFamilyOf('XCUIElementTypeButton')).to.equal('ios');
    expect(typeFamilyOf('XCUIElementTypeAny')).to.equal(null);
    expect(typeFamilyOf('Sun, Nov 8')).to.equal(null);
    expect(typeFamilyOf('Unknown')).to.equal(null);
  });
});

describe('the in-memory fingerprint store, by key', () => {
  useLokiStores();

  it("finds a selector's rows by key and by selector, exactly", async () => {
    const store = DeviceStoreFactory.getHealEtalonStore();
    const selector = `50%_off|${process.pid}`;
    const row = (key: string, nodeName: string) => ({
      selector: key,
      strategy: 'id',
      attributes: {},
      nodeName,
      lastSeen: Date.now(),
    });
    await store.saveSignature(
      row(fingerprintKey('android', 'id', selector), 'android.widget.Button'),
    );
    await store.saveSignature(row(fingerprintKey('ios', 'id', selector), 'XCUIElementTypeButton'));
    await store.saveSignature(row(selector, 'android.widget.Button'));
    await store.saveSignature(row(`50X_off|${process.pid}`, 'android.widget.Button'));

    const byKey = await store.getSignatures([fingerprintKey('ios', 'id', selector), 'nope']);
    expect(byKey.map((r: any) => r.nodeName)).to.deep.equal(['XCUIElementTypeButton']);
    const all = await store.getSignaturesOfSelector(selector);
    expect(all.map((r: any) => r.selector).sort()).to.deep.equal(
      [
        selector,
        fingerprintKey('android', 'id', selector),
        fingerprintKey('ios', 'id', selector),
      ].sort(),
    );
  });
});

describe('the database fingerprint store, by selector', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();

  it('matches the selector exactly, whatever LIKE would take', async () => {
    await scratch.db.locatorEtalon.deleteMany({});
    const store = new PrismaHealEtalonStore();
    const selector = '50%_Off';
    const row = (key: string) => ({
      selector: key,
      strategy: 'id',
      attributes: {},
      nodeName: 'android.widget.Button',
      lastSeen: Date.now(),
    });
    for (const key of [
      fingerprintKey('android', 'id', selector),
      fingerprintKey('android', 'id', '50X_off'),
      fingerprintKey('ios', 'id', '50%_off'),
      selector,
    ]) {
      await store.saveSignature(row(key));
    }

    const all = await store.getSignaturesOfSelector(selector);
    expect(all.map((r: any) => r.selector).sort()).to.deep.equal(
      [selector, fingerprintKey('android', 'id', selector)].sort(),
    );
  });
});
