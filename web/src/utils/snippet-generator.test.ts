import { describe, it, expect } from 'vitest';
import { snippet } from './snippet-generator';

describe('snippet', () => {
  it('emits a JS WebdriverIO accessibility id call', () => {
    expect(snippet('javascript', 'accessibility id', 'login-btn')).to.equal(
      "await driver.findElement('accessibility id', 'login-btn')",
    );
  });

  it('emits a Java AppiumBy accessibility id call', () => {
    expect(snippet('java', 'accessibility id', 'login-btn')).to.equal(
      'driver.findElement(AppiumBy.accessibilityId("login-btn"))',
    );
  });

  it('emits a Python xpath call', () => {
    expect(snippet('python', 'xpath', '//button[@id="x"]')).to.equal(
      `driver.find_element(AppiumBy.XPATH, '//button[@id=\"x\"]')`,
    );
  });

  it('escapes single quotes for single-quoted languages', () => {
    expect(snippet('javascript', 'xpath', "it's me")).to.contain("it\\'s");
  });

  it('escapes double quotes for double-quoted languages', () => {
    expect(snippet('java', 'xpath', '//*[@text="OK"]')).to.contain('\\"OK\\"');
  });

  it('escapes backslashes', () => {
    expect(snippet('javascript', 'xpath', 'a\\b')).to.contain('a\\\\b');
  });

  it('returns a comment placeholder for xenon:visual', () => {
    expect(snippet('javascript', 'xenon:visual', 'foo')).to.match(/visual|coordinate/i);
  });

  it('falls back to "STRATEGY: value" for unknown language', () => {
    expect(snippet('cobol' as any, 'xpath', 'x')).to.contain('XPATH');
    expect(snippet('cobol' as any, 'xpath', 'x')).to.contain('x');
  });

  it('falls back for known language but unknown strategy', () => {
    expect(snippet('javascript', 'mystery', 'x')).to.contain('MYSTERY');
  });

  it('emits Ruby :accessibility_id form', () => {
    expect(snippet('ruby', 'accessibility id', 'login-btn')).to.equal(
      "driver.find_element(:accessibility_id, 'login-btn')",
    );
  });
});
