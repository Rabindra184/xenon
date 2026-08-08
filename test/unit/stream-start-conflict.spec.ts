import { expect } from 'chai';
import {
  decideStreamStartConflict,
  StreamStartConflictInput,
} from '../../src/app/routers/streamStartConflict';

// Guards the lock steal at control.ts:530. The old shape was:
//
//   const isCurrentlyControlledManually = hasActiveManualStream(udid);
//   if (device.busy && !isCurrentlyControlledManually) { …reclaim or 409… }
//
// When a manual stream WAS live the busy check was skipped entirely, so
// execution fell through to blockDevice(udid, host, manual_<B>_<udid>).
// resolveBlockSessionId only shields a real Appium session id from manual
// overwrite — manual-over-manual keeps the incoming id. So B's start silently
// took A's lock, and A's own stream/stop then 403'd.

const UDID = 'DEV-1';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';

function input(over: Partial<StreamStartConflictInput> = {}): StreamStartConflictInput {
  return {
    udid: UDID,
    busy: true,
    sessionId: `manual_${ALICE}_${UDID}`,
    hasLiveManualStream: true,
    sessionOwnerUserId: null,
    actorUserId: ALICE,
    actorApiKeyId: undefined,
    isAdmin: false,
    ...over,
  };
}

describe('decideStreamStartConflict', () => {
  it('proceeds when the device is free', () => {
    expect(decideStreamStartConflict(input({ busy: false }))).to.deep.equal({
      action: 'proceed',
    });
  });

  it('REFUSES to steal a live manual stream held by another user', () => {
    expect(decideStreamStartConflict(input({ actorUserId: BOB }))).to.deep.equal({
      action: 'deny',
      code: 'device_held_by_another_user',
      holderId: ALICE,
    });
  });

  it('lets the holder restart their own live stream', () => {
    expect(decideStreamStartConflict(input())).to.deep.equal({ action: 'proceed' });
  });

  it('recognises the holder through a lock written with their apiKeyId', () => {
    const d = decideStreamStartConflict(
      input({ sessionId: `manual_key_abc_${UDID}`, actorUserId: ALICE, actorApiKeyId: 'key_abc' }),
    );
    expect(d).to.deep.equal({ action: 'proceed' });
  });

  it('lets an admin take over a live foreign stream', () => {
    const d = decideStreamStartConflict(input({ actorUserId: BOB, isAdmin: true }));
    expect(d).to.deep.equal({ action: 'proceed' });
  });

  it('takes over a live stream behind a legacy ownerless lock', () => {
    const d = decideStreamStartConflict(input({ sessionId: `manual_${UDID}`, actorUserId: BOB }));
    expect(d).to.deep.equal({ action: 'proceed' });
  });

  it('reclaims a manual lock with no live stream, whoever owned it', () => {
    const d = decideStreamStartConflict(input({ actorUserId: BOB, hasLiveManualStream: false }));
    expect(d).to.deep.equal({ action: 'reclaim' });
  });

  it('denies a foreign Appium session', () => {
    const d = decideStreamStartConflict(
      input({
        sessionId: 'appium-1',
        hasLiveManualStream: false,
        sessionOwnerUserId: ALICE,
        actorUserId: BOB,
      }),
    );
    expect(d).to.deep.equal({
      action: 'deny',
      code: 'device_in_use_by_session',
      holderId: ALICE,
    });
  });

  it('allows previewing an Appium session you started yourself', () => {
    const d = decideStreamStartConflict(
      input({
        sessionId: 'appium-1',
        hasLiveManualStream: false,
        sessionOwnerUserId: ALICE,
        actorUserId: ALICE,
      }),
    );
    expect(d).to.deep.equal({ action: 'proceed' });
  });

  it('denies an unattributable Appium session (fail closed)', () => {
    const d = decideStreamStartConflict(
      input({ sessionId: 'appium-1', hasLiveManualStream: false, sessionOwnerUserId: null }),
    );
    expect(d).to.deep.equal({
      action: 'deny',
      code: 'device_in_use_by_session',
      holderId: '',
    });
  });
});
