import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';

/**
 * The stream services start their watchdogs in their constructors. On a
 * server the HTTP listener keeps the process alive, so those intervals only
 * need to fire while it runs; referenced, they also kept a test run (or any
 * script that merely constructs a service) alive after its work was done.
 */
describe('stream service watchdogs', () => {
  let created: NodeJS.Timeout[];

  beforeEach(() => {
    created = [];
    const realSetInterval = global.setInterval;
    sinon.stub(global, 'setInterval').callsFake(((fn: () => void, ms?: number) => {
      const timer = realSetInterval(fn, ms);
      created.push(timer);
      return timer;
    }) as any);
  });

  afterEach(() => {
    sinon.restore();
    for (const timer of created) clearInterval(timer);
  });

  for (const [name, Service] of [
    ['AndroidStreamService', AndroidStreamService],
    ['AndroidH264StreamService', AndroidH264StreamService],
    ['IOSStreamService', IOSStreamService],
  ] as const) {
    it(`${name}'s intervals don't keep the process alive`, () => {
      new (Service as any)();

      expect(created.length, 'the constructor starts its watchdog').to.be.greaterThan(0);
      for (const timer of created) expect(timer.hasRef(), 'unref()ed').to.equal(false);
    });
  }
});
