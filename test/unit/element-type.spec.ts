import { expect } from 'chai';
import { typeLooksLearnt } from '../../src/services/healing/elementType';

/**
 * Which stored fingerprint types are learnt again. Through 2.20 an Android
 * fingerprint was typed `XCUIElementTypeAny`, or by the element's description
 * (UiAutomator2's getName), neither of which a page source has as a tag.
 */
describe('a stored fingerprint type', () => {
  for (const type of [
    'android.widget.Button',
    'androidx.recyclerview.widget.RecyclerView',
    'com.shop.ui.PriceView',
    'XCUIElementTypeButton',
    'android.view.View',
  ]) {
    it(`${type} is a type a page source has`, () => {
      expect(typeLooksLearnt(type)).to.equal(true);
    });
  }

  for (const type of [
    'XCUIElementTypeAny',
    'Unknown',
    'Sun, Nov 8',
    'Pay now',
    'Version 2.1',
    '',
    undefined,
  ]) {
    it(`${JSON.stringify(type)} is learnt again`, () => {
      expect(typeLooksLearnt(type)).to.equal(false);
    });
  }
});
