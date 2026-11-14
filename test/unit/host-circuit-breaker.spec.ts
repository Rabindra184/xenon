import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { CircuitBreaker } from '../../src/data-service/CircuitBreaker';

/**
 * The breaker a hub keeps per node host: three failed session creates on a
 * node take its phones out of allocation for a minute. After that minute it
 * lets one session through to try the node (`beginTrial`, taken when a phone
 * there is allocated), and that session decides.
 *
 * Through 2.36 reading it (`isOpen`, from every device listing) turned it
 * half-open, and a half-open breaker let every allocation through, so a node
 * that was still down got every create waiting.
 */
describe('the node host circuit breaker', () => {
  const HOST = 'http://node.lab:4723';
  const MINUTE = 60_000;
  let clock: sinon.SinonFakeTimers;
  let breaker: CircuitBreaker;

  const trip = () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure(HOST);
  };

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['Date'] });
    breaker = new CircuitBreaker();
  });

  afterEach(() => clock.restore());

  it('is closed for a host it has heard nothing about, and opens after three failures', () => {
    expect(breaker.isOpen(HOST)).to.equal(false);
    breaker.recordFailure(HOST);
    breaker.recordFailure(HOST);
    expect(breaker.isOpen(HOST)).to.equal(false);
    breaker.recordFailure(HOST);
    expect(breaker.isOpen(HOST)).to.equal(true);
  });

  it('changes nothing when read', () => {
    trip();
    clock.tick(MINUTE + 1);
    for (let i = 0; i < 5; i++) expect(breaker.isOpen(HOST)).to.equal(false);
    expect(breaker.stateOf(HOST)).to.equal('HALF_OPEN');
    // Reading didn't take the trial: the first allocation still gets it.
    expect(breaker.beginTrial(HOST)).to.equal(true);
  });

  it('lets one session try the host after the cooldown, and holds the host back meanwhile', () => {
    trip();
    clock.tick(MINUTE + 1);
    expect(breaker.beginTrial(HOST)).to.equal(true);
    expect(breaker.isOpen(HOST), 'the other allocations wait for the trial').to.equal(true);
    expect(breaker.beginTrial(HOST)).to.equal(false);
  });

  it('closes when the trial works, and a single failure then does not reopen it', () => {
    trip();
    clock.tick(MINUTE + 1);
    breaker.beginTrial(HOST);
    breaker.recordSuccess(HOST);
    expect(breaker.isOpen(HOST)).to.equal(false);
    expect(breaker.stateOf(HOST)).to.equal('CLOSED');
    breaker.recordFailure(HOST);
    expect(breaker.isOpen(HOST)).to.equal(false);
  });

  it('opens again for another minute when the trial fails', () => {
    trip();
    clock.tick(MINUTE + 1);
    breaker.beginTrial(HOST);
    breaker.recordFailure(HOST);
    expect(breaker.isOpen(HOST)).to.equal(true);
    clock.tick(MINUTE - 1);
    expect(breaker.isOpen(HOST)).to.equal(true);
    clock.tick(2);
    expect(breaker.isOpen(HOST)).to.equal(false);
    expect(breaker.beginTrial(HOST)).to.equal(true);
  });

  it('lets another trial through when one never reports back', () => {
    trip();
    clock.tick(MINUTE + 1);
    breaker.beginTrial(HOST);
    clock.tick(MINUTE + 1);
    expect(breaker.isOpen(HOST)).to.equal(false);
    expect(breaker.beginTrial(HOST)).to.equal(true);
  });

  it('takes no trial on a host that is closed or still cooling down', () => {
    expect(breaker.beginTrial(HOST)).to.equal(false);
    trip();
    expect(breaker.beginTrial(HOST)).to.equal(false);
    expect(breaker.isOpen(HOST)).to.equal(true);
  });
});
