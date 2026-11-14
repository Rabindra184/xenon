import 'reflect-metadata';
import { expect } from 'chai';
import { describesSameElement } from '../../src/services/healing/fingerprintPath';
import { PrismaHealEtalonStore } from '../../src/data-service/prisma-store';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { useScratchDatabase } from '../helpers/scratch-database';
import { useLokiStores } from '../helpers/loki-stores';

// A fingerprint saved without a path (a heal whose element's path couldn't be
// worked out) keeps the stored path only when it is the same element. Through
// 2.36 it always kept it, so a heal that wrote another element's attributes
// left the old element's path: Resilio then went by one element and Fuzzy XML
// by another. Dropped, the path is learnt again on the next find that works.

const PATH = { format: 'page-source-1', nodes: [{ tag: 'hierarchy', id: '', index: 0 }] };
const BUTTON = 'android.widget.Button';
const PAY = {
  'resource-id': 'com.shop:id/pay',
  text: 'Pay',
  x: '10',
  y: '900',
  width: '300',
  height: '80',
};
const CANCEL = { ...PAY, 'resource-id': 'com.shop:id/cancel', text: 'Cancel' };

describe('Which saved fingerprint keeps the stored path', () => {
  const same = (a: object, b: object, typeA = BUTTON, typeB = BUTTON) =>
    describesSameElement(
      { nodeName: typeA, attributes: a as Record<string, string> },
      { nodeName: typeB, attributes: b as Record<string, string> },
    );

  it('the same element, moved or reworded, keeping its id', () => {
    expect(same(PAY, { ...PAY, y: '400', text: 'Pay now' })).to.equal(true);
  });

  it('the same id in another package (a debug build)', () => {
    expect(same(PAY, { ...PAY, 'resource-id': 'com.shop.debug:id/pay' })).to.equal(true);
  });

  it('a heal-written fingerprint of the same element, which has no rect', () => {
    expect(same(PAY, { 'resource-id': 'com.shop:id/pay', text: 'Pay' })).to.equal(true);
  });

  it('not another id at the same spot', () => {
    expect(same(PAY, CANCEL)).to.equal(false);
  });

  it('not an element of another type', () => {
    expect(same(PAY, PAY, BUTTON, 'android.widget.TextView')).to.equal(false);
  });

  it('not when one has an id and the other none', () => {
    expect(same(PAY, { text: 'Pay', x: '10', y: '900', width: '300', height: '80' })).to.equal(
      false,
    );
  });

  it('without ids: the same text, else the same rect', () => {
    const label = { label: 'Orders', name: 'Orders', x: '0', y: '0', width: '50', height: '20' };
    const ios = 'XCUIElementTypeStaticText';
    expect(same(label, { ...label, y: '40' }, ios, ios)).to.equal(true);
    expect(same(label, { ...label, label: 'Deliveries', name: 'Deliveries' }, ios, ios)).to.equal(
      false,
    );
    expect(same({ x: '1', y: '2' }, { x: '1', y: '2' })).to.equal(true);
    expect(same({ x: '1', y: '2' }, { x: '1', y: '3' })).to.equal(false);
  });

  it('an iOS accessibility identifier decides, as a resource-id does', () => {
    const ios = 'XCUIElementTypeButton';
    const pay = { name: 'payButton', label: 'Pay' };
    expect(same(pay, { name: 'payButton', label: 'Pay now' }, ios, ios)).to.equal(true);
    expect(same(pay, { name: 'cancelButton', label: 'Pay' }, ios, ios)).to.equal(false);
  });
});

/** Saves a fingerprint with a path, then another without one; answers the path stored then. */
async function pathAfter(
  store: { saveSignature(e: any): Promise<void>; getSignature(s: string): Promise<any> },
  selector: string,
  later: Record<string, string>,
  laterType = BUTTON,
) {
  const at = { selector, strategy: 'xpath', lastSeen: Date.now() };
  await store.saveSignature({ ...at, attributes: PAY, nodeName: BUTTON, path: PATH });
  await store.saveSignature({ ...at, attributes: later, nodeName: laterType, path: undefined });
  const stored = await store.getSignature(selector);
  expect(stored.attributes).to.deep.equal(later);
  return stored.path ?? null;
}

describe('The database fingerprint store, saving without a path', () => {
  useScratchDatabase();
  const store = () => new PrismaHealEtalonStore();

  it('keeps the path for the same element', async () => {
    expect(await pathAfter(store(), '//same-db', { ...PAY, y: '400' })).to.deep.equal(PATH);
  });

  it("drops the path when the attributes are another element's", async () => {
    expect(await pathAfter(store(), '//other-db', CANCEL)).to.equal(null);
  });

  it('drops the path for an element of another type', async () => {
    expect(await pathAfter(store(), '//type-db', PAY, 'android.widget.TextView')).to.equal(null);
  });
});

describe('The in-memory fingerprint store, saving without a path', () => {
  useLokiStores();
  const store = () => DeviceStoreFactory.getHealEtalonStore();

  it('keeps the path for the same element', async () => {
    expect(await pathAfter(store(), '//same-loki', { ...PAY, y: '400' })).to.deep.equal(PATH);
  });

  it("drops the path when the attributes are another element's", async () => {
    expect(await pathAfter(store(), '//other-loki', CANCEL)).to.equal(null);
  });
});
