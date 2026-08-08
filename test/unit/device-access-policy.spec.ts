import { expect } from 'chai';
import {
  evaluateDeviceAccess,
  denyBody,
  isSelfManualLock,
  isOwnSession,
  DeviceAccessInput,
} from '../../src/services/device-access/deviceAccessPolicy';

// Guards the gap where every /control mutation (tap, swipe, text, install,
// shell, …) reached the device with no ownership check at all: only
// stream/stop consulted the manual lock. See
// docs/superpowers/specs/2026-08-08-device-access-guard-design.md.

const UDID = 'DEV-1';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';

function input(over: Partial<DeviceAccessInput> = {}): DeviceAccessInput {
  return {
    udid: UDID,
    busy: true,
    sessionId: `manual_${ALICE}_${UDID}`,
    sessionOwnerUserId: null,
    actorUserId: ALICE,
    actorApiKeyId: undefined,
    isAdmin: false,
    ...over,
  };
}

describe('evaluateDeviceAccess', () => {
  it('allows an admin regardless of who holds the device', () => {
    const d = evaluateDeviceAccess(input({ actorUserId: BOB, isAdmin: true }));
    expect(d).to.deep.equal({ allow: true });
  });

  it('allows anyone when the device is not busy', () => {
    const d = evaluateDeviceAccess(input({ busy: false, actorUserId: BOB }));
    expect(d).to.deep.equal({ allow: true });
  });

  it('allows the owner of a manual lock', () => {
    expect(evaluateDeviceAccess(input())).to.deep.equal({ allow: true });
  });

  it('allows a lock written with the caller apiKeyId (upgrade tolerance)', () => {
    const d = evaluateDeviceAccess(
      input({
        sessionId: `manual_key_abc_${UDID}`,
        actorUserId: ALICE,
        actorApiKeyId: 'key_abc',
      }),
    );
    expect(d).to.deep.equal({ allow: true });
  });

  it('denies a manual lock owned by another user, naming the holder', () => {
    const d = evaluateDeviceAccess(input({ actorUserId: BOB }));
    expect(d).to.deep.equal({
      allow: false,
      code: 'device_held_by_another_user',
      holderId: ALICE,
    });
  });

  it('allows a legacy ownerless lock', () => {
    const d = evaluateDeviceAccess(input({ sessionId: `manual_${UDID}`, actorUserId: BOB }));
    expect(d).to.deep.equal({ allow: true });
  });

  it('allows the owner of the running Appium session', () => {
    const d = evaluateDeviceAccess(
      input({ sessionId: 'appium-sess-1', sessionOwnerUserId: ALICE }),
    );
    expect(d).to.deep.equal({ allow: true });
  });

  it('denies an Appium session owned by another user', () => {
    const d = evaluateDeviceAccess(
      input({ sessionId: 'appium-sess-1', sessionOwnerUserId: ALICE, actorUserId: BOB }),
    );
    expect(d).to.deep.equal({
      allow: false,
      code: 'device_in_use_by_session',
      holderId: ALICE,
    });
  });

  it('denies when the session owner cannot be attributed (fail closed)', () => {
    const d = evaluateDeviceAccess(input({ sessionId: 'appium-sess-1', sessionOwnerUserId: null }));
    expect(d).to.deep.equal({
      allow: false,
      code: 'device_in_use_by_session',
      holderId: '',
    });
  });

  it('denies a busy device carrying no session id at all', () => {
    const d = evaluateDeviceAccess(input({ sessionId: null }));
    expect(d).to.deep.equal({
      allow: false,
      code: 'device_in_use_by_session',
      holderId: '',
    });
  });
});

describe('denyBody', () => {
  it('names the holder when one resolved', () => {
    const b = denyBody('device_held_by_another_user', ALICE, 'alice@example.com');
    expect(b.success).to.equal(false);
    expect(b.error).to.equal('device_held_by_another_user');
    expect(b.message).to.contain('alice@example.com');
    expect(b.holder).to.deep.equal({ userId: ALICE, name: 'alice@example.com' });
  });

  it('falls back to a generic phrase when the holder does not resolve', () => {
    const b = denyBody('device_held_by_another_user', 'key_abc', null);
    expect(b.message).to.contain('another user');
    expect(b.holder).to.deep.equal({ userId: 'key_abc', name: undefined });
  });

  it('omits holder entirely when there is no holder id', () => {
    const b = denyBody('device_in_use_by_session', '', null);
    expect(b.holder).to.equal(undefined);
    expect(b.message).to.contain('another user');
  });
});

describe('isSelfManualLock', () => {
  it('is true when the lock was written on the actor user id', () => {
    expect(isSelfManualLock(`manual_${ALICE}_${UDID}`, UDID, ALICE, undefined)).to.equal(true);
  });

  it('is true when the lock was written on the actor api key id (upgrade tolerance)', () => {
    expect(isSelfManualLock(`manual_key_abc_${UDID}`, UDID, ALICE, 'key_abc')).to.equal(true);
  });

  it('is false when neither candidate identity matches the lock owner', () => {
    expect(isSelfManualLock(`manual_${ALICE}_${UDID}`, UDID, BOB, 'key_abc')).to.equal(false);
  });

  it('is false for a legacy ownerless lock (never self)', () => {
    expect(isSelfManualLock(`manual_${UDID}`, UDID, ALICE, undefined)).to.equal(false);
  });

  it('is false when sessionId is not a manual lock at all', () => {
    expect(isSelfManualLock('appium-sess-1', UDID, ALICE, undefined)).to.equal(false);
  });

  it('is false when sessionId is null', () => {
    expect(isSelfManualLock(null, UDID, ALICE, undefined)).to.equal(false);
  });
});

describe('isOwnSession', () => {
  it('is true when the session owner matches the actor', () => {
    expect(isOwnSession(ALICE, ALICE)).to.equal(true);
  });

  it('is false when the session owner is a different user', () => {
    expect(isOwnSession(ALICE, BOB)).to.equal(false);
  });

  it('is false when the session owner is null (unattributable)', () => {
    expect(isOwnSession(null, ALICE)).to.equal(false);
  });

  it('is false when the actor is undefined', () => {
    expect(isOwnSession(ALICE, undefined)).to.equal(false);
  });
});
