import 'reflect-metadata';
import { expect } from 'chai';
import { errors } from '@appium/base-driver';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';

/**
 * Appium's createSession answers a failure as `{ error: <Error> }`. The old
 * message JSON.stringify'd that Error, which is `{}`, so a create Appium
 * refused (no driver for the automationName, bad capabilities) reached the
 * client as "Failed to create session on node <host>. Error: {}" with a 500,
 * instead of Appium's own reason and status.
 */
describe('SessionLifecycleService.throwProperError', () => {
  const throwProperError = (session: unknown) =>
    SessionLifecycleService.prototype.throwProperError.call({}, session, 'http://node:4723');

  function thrown(session: unknown): any {
    try {
      throwProperError(session);
    } catch (error) {
      return error;
    }
    throw new Error('expected throwProperError to throw');
  }

  it("rethrows the Error in Appium's `{ error }` answer, keeping its type and reason", () => {
    const cause = new errors.SessionNotCreatedError(
      "Could not find a driver for automationName 'NoSuchDriver'",
    );
    const error = thrown({ error: cause });
    expect(error).to.equal(cause);
    expect(error.message).to.include("automationName 'NoSuchDriver'");
  });

  it('keeps a string reason, naming the node', () => {
    const error = thrown({ error: 'no device' });
    expect(error.message).to.equal(
      'Failed to create session on node http://node:4723. Error: no device',
    );
  });

  it('keeps a plain object reason as JSON', () => {
    const error = thrown({ error: { code: 'X' } });
    expect(error.message).to.include('{"code":"X"}');
  });

  it('rethrows an Error it is given directly', () => {
    const cause = new Error('boom');
    expect(thrown(cause)).to.equal(cause);
  });
});
