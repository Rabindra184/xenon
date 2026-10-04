import { expect } from 'chai';
import http from 'http';
import {
  HEAL_REPORT_HEADER,
  reportHeal,
  runReportingHeals,
  takeHealReport,
} from '../../src/gateway/healReport';

/**
 * How a node hands a heal back to its hub on the answer to the hub's command
 * (healReport.ts): what goes on the answer, and what the hub accepts off it.
 */
describe('A heal reported to the hub', () => {
  const answer = () => new http.ServerResponse(new http.IncomingMessage(null as any));
  const heal = (selector: string) => ({
    originalSelector: selector,
    originalStrategy: 'xpath',
    healedSelector: "//*[@text='Anmelden']",
    healedStrategy: 'xpath',
    confidence: 0.82,
    tier: 2,
  });

  it('goes on the answer and comes off it whole, whatever its characters', () => {
    const res = answer();
    const sent = heal("//*[@text='Ünïcödé “quotes”']");

    expect(runReportingHeals(res, () => reportHeal(sent))).to.equal('reported');

    const headers = { [HEAL_REPORT_HEADER]: String(res.getHeader(HEAL_REPORT_HEADER)) };
    expect(takeHealReport(headers)).to.deep.equal(sent);
    expect(headers, 'taken off the headers').to.not.have.property(HEAL_REPORT_HEADER);
  });

  it('is not sent for a command that did not come from a hub', () => {
    expect(reportHeal(heal('//a'))).to.equal('not-from-hub');
  });

  it('is not sent when too long for the hub to read, so the command still answers', () => {
    const res = answer();

    const reported = runReportingHeals(res, () => reportHeal(heal(`//${'x'.repeat(10_000)}`)));

    expect(reported).to.equal('too-long');
    expect(res.getHeader(HEAL_REPORT_HEADER)).to.equal(undefined);
  });

  it('is ignored when it is not one', () => {
    const notJson = { [HEAL_REPORT_HEADER]: 'not base64 json' };
    const notAHeal = {
      [HEAL_REPORT_HEADER]: Buffer.from('{"originalSelector":1}').toString('base64url'),
    };
    expect(takeHealReport(notJson)).to.equal(undefined);
    expect(takeHealReport(notAHeal)).to.equal(undefined);
    expect(takeHealReport({})).to.equal(undefined);
  });
});
