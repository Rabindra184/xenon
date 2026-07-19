import { expect } from 'chai';
import {
  formatManualLock,
  isManualLock,
  resolveBlockSessionId,
} from '../../src/services/recording/manualLock';

const UDID = 'iphone-udid-1';
const MANUAL = formatManualLock('actor-7', UDID); // manual_actor-7_iphone-udid-1
const MANUAL_OTHER = formatManualLock('actor-9', UDID);
const LEGACY_MANUAL = `manual_${UDID}`;
const APPIUM = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'; // a real session UUID

describe('manualLock.isManualLock', () => {
  it('recognizes actor and legacy manual locks', () => {
    expect(isManualLock(MANUAL)).to.equal(true);
    expect(isManualLock(LEGACY_MANUAL)).to.equal(true);
  });
  it('rejects Appium session ids and empties', () => {
    expect(isManualLock(APPIUM)).to.equal(false);
    expect(isManualLock(null)).to.equal(false);
    expect(isManualLock(undefined)).to.equal(false);
    expect(isManualLock('')).to.equal(false);
  });
});

describe('manualLock.resolveBlockSessionId (#149 — manual lock must not stomp a live session)', () => {
  it('preserves a real Appium session_id when a manual lock is applied over it', () => {
    // The core coexistence bug: viewer opens the stream while a session owns the device.
    expect(resolveBlockSessionId(MANUAL, APPIUM)).to.equal(APPIUM);
    expect(resolveBlockSessionId(LEGACY_MANUAL, APPIUM)).to.equal(APPIUM);
  });

  it('lets a real Appium session_id win over an existing manual lock', () => {
    // Session start over a device that only had a manual stream: the real allocation is authoritative.
    expect(resolveBlockSessionId(APPIUM, MANUAL)).to.equal(APPIUM);
  });

  it('keeps the incoming manual lock when the device has no owner or only a manual owner', () => {
    expect(resolveBlockSessionId(MANUAL, null)).to.equal(MANUAL);
    expect(resolveBlockSessionId(MANUAL, undefined)).to.equal(MANUAL);
    expect(resolveBlockSessionId(MANUAL, MANUAL_OTHER)).to.equal(MANUAL);
  });

  it('keeps the incoming session id in the normal session-block path', () => {
    expect(resolveBlockSessionId(APPIUM, null)).to.equal(APPIUM);
    expect(resolveBlockSessionId(APPIUM, APPIUM)).to.equal(APPIUM);
  });

  it('normalizes an absent incoming id to null', () => {
    expect(resolveBlockSessionId(undefined, null)).to.equal(null);
    expect(resolveBlockSessionId(null, undefined)).to.equal(null);
  });
});
