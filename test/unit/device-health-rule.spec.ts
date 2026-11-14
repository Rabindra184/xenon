import 'reflect-metadata';
import { expect } from 'chai';
import { leasable } from '../../src/services/lease/leaseFilters';
import { memberLossReason } from '../../src/services/lease/LeaseOrphanSweeper';

/**
 * A phone's `healthStatus`, read one way by everyone who decides whether it
 * may be used: allocation, a lease's candidates and the lease sweeper. Unset
 * or `Healthy` is healthy; `Unhealthy`, and any value Xenon doesn't write, is
 * not. Through 2.36 allocation refused anything but `Healthy`, while leases
 * took and kept anything but `Unhealthy`.
 */
describe('A phone’s health, one rule', () => {
  const NOW = Date.UTC(2026, 10, 14);
  const phone = (healthStatus: unknown) =>
    ({ udid: 'h1', host: 'http://10.0.0.9:4725', busy: false, healthStatus }) as any;
  const member = { index: 1, udid: 'h1', host: 'http://10.0.0.9:4725' };

  for (const healthy of [undefined, null, '', 'Healthy']) {
    it(`${JSON.stringify(healthy)} is healthy: leasable, and not a lost member`, () => {
      expect(leasable(phone(healthy), NOW)).to.equal(true);
      expect(memberLossReason(member, phone(healthy))).to.equal(null);
    });
  }

  for (const unhealthy of ['Unhealthy', 'Recovering', 'unhealthy']) {
    it(`${JSON.stringify(unhealthy)} is not healthy: not leasable, and a lost member`, () => {
      expect(leasable(phone(unhealthy), NOW)).to.equal(false);
      expect(memberLossReason(member, phone(unhealthy))).to.equal('member 1 (h1) is unhealthy');
    });
  }
});
