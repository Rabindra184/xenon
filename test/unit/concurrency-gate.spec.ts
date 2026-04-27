import 'reflect-metadata';
import { expect } from 'chai';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';

describe('ConcurrencyGate', () => {
  it('admits up to the limit', () => {
    const g = new ConcurrencyGate(2);
    expect(g.tryAcquire(['r1', 'r2'])).to.equal(true);
    expect(g.activeCount()).to.equal(2);
  });

  it('refuses atomically when adding would exceed the limit and takes nothing', () => {
    const g = new ConcurrencyGate(2);
    g.tryAcquire(['r1']);
    expect(g.tryAcquire(['r2', 'r3'])).to.equal(false);
    expect(g.activeCount()).to.equal(1);
  });

  it('release decrements active count', () => {
    const g = new ConcurrencyGate(2);
    g.tryAcquire(['r1', 'r2']);
    g.release('r1');
    expect(g.activeCount()).to.equal(1);
  });

  it('exposes the limit', () => {
    const g = new ConcurrencyGate(7);
    expect(g.getLimit()).to.equal(7);
  });
});
