import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { rulesHideTokens } from '../../src/services/logging/tokenLogFilter';

/**
 * Whether the server's own `log-filters` rules hide a session create's
 * tokens in Appium's request log, judged as Appium applies them. A lab whose
 * launch config had none logged every lease token (Xenon Control 0.1.5).
 */
describe("whether Appium's log hides a create's tokens", () => {
  /** The JSON rules authentication.md gives, as a server would load them. */
  function documentedRules(): unknown[] {
    const doc = fs.readFileSync(
      path.join(__dirname, '../../website/docs/authentication.md'),
      'utf8',
    );
    const block = doc
      .split('### Keep secrets out of Appium')[1]
      .split('```json')[1]
      .split('```')[0];
    return JSON.parse(block);
  }

  it('is true with the rules the docs give (and Xenon Control writes)', () => {
    expect(rulesHideTokens(documentedRules())).to.equal(true);
  });

  it('is false with no rules', () => {
    expect(rulesHideTokens(undefined)).to.equal(false);
    expect(rulesHideTokens([])).to.equal(false);
  });

  it('is false with only the password rule', () => {
    expect(rulesHideTokens(documentedRules().slice(1))).to.equal(false);
  });

  it('is false when a rule leaves one of the three tokens', () => {
    expect(
      rulesHideTokens([{ pattern: '("leaseToken"\\s*:\\s*")[^"]+', replacer: '$1**REDACTED**' }]),
    ).to.equal(false);
  });

  it('is false for a rule Appium would refuse', () => {
    expect(rulesHideTokens([{ pattern: '' }])).to.equal(false);
    expect(rulesHideTokens([42])).to.equal(false);
  });

  it("applies Appium's defaults: flag g, and **SECURE** as the replacer", () => {
    expect(
      rulesHideTokens([{ pattern: '(?<="(?:token|sessionToken|leaseToken)":")[^"]+' }]),
    ).to.equal(true);
  });
});
