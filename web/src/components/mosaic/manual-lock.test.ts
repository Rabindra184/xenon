import { describe, expect, it } from 'vitest';
import { busyReason, holdOf, isRehydratableTile, isSelfManualLock } from './manual-lock';

const UDID = 'DEV-1';
const ME = 'usr_me';
const OTHER = 'usr_other';

describe('isSelfManualLock', () => {
  it('recognises my own lock', () => {
    expect(isSelfManualLock(`manual_${ME}_${UDID}`, UDID, ME)).toBe(true);
  });

  it('rejects another user’s lock', () => {
    expect(isSelfManualLock(`manual_${OTHER}_${UDID}`, UDID, ME)).toBe(false);
  });

  it('rejects a legacy ownerless lock — ownership cannot be proven', () => {
    expect(isSelfManualLock(`manual_${UDID}`, UDID, ME)).toBe(false);
  });

  it('rejects everything when we do not know who we are', () => {
    expect(isSelfManualLock(`manual_${ME}_${UDID}`, UDID, null)).toBe(false);
  });
});

// Mount-time rehydration re-adopts tiles after a refresh so a device is not
// left busy with no UI to release it. It must only re-adopt devices THIS user
// holds: the filter used to be `busy && session_id.startsWith('manual_')`,
// which adopted a device another user was streaming. The victim got a live
// tile, complete with an × button whose stream/stop returns 403 because the
// lock is not theirs.
describe('isRehydratableTile', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    udid: UDID,
    busy: true,
    session_id: `manual_${ME}_${UDID}`,
    ...over,
  });

  it('re-adopts a device I hold', () => {
    expect(isRehydratableTile(row(), ME)).toBe(true);
  });

  it('does NOT re-adopt a device another user holds', () => {
    expect(isRehydratableTile(row({ session_id: `manual_${OTHER}_${UDID}` }), ME)).toBe(false);
  });

  it('does NOT re-adopt a legacy ownerless lock', () => {
    expect(isRehydratableTile(row({ session_id: `manual_${UDID}` }), ME)).toBe(false);
  });

  it('does NOT re-adopt an idle device', () => {
    expect(isRehydratableTile(row({ busy: false }), ME)).toBe(false);
  });

  it('does NOT re-adopt a device running an Appium session', () => {
    expect(isRehydratableTile(row({ session_id: 'appium-session-1' }), ME)).toBe(false);
  });

  it('does NOT re-adopt anything when the identity probe has not resolved', () => {
    expect(isRehydratableTile(row(), null)).toBe(false);
  });

  it('tolerates a missing session_id', () => {
    expect(isRehydratableTile(row({ session_id: undefined }), ME)).toBe(false);
  });
});

// On a hub, a node's phone is held by the node's own preview hold, which the
// hub keeps as nodeHold: session_id is the hub's, and stays empty for it.
describe('a node’s phone on a hub', () => {
  const mine = { udid: UDID, busy: true, session_id: null, nodeHold: `manual_${ME}_${UDID}` };
  const theirs = { ...mine, nodeHold: `manual_${OTHER}_${UDID}` };

  it('holdOf reads session_id first, then nodeHold', () => {
    expect(holdOf(mine)).toBe(`manual_${ME}_${UDID}`);
    expect(holdOf({ ...mine, session_id: 'hub-session-1' })).toBe('hub-session-1');
    expect(holdOf({})).toBe(null);
  });

  it('is re-adopted after a reload when I hold it', () => {
    expect(isRehydratableTile(mine, ME)).toBe(true);
    expect(isRehydratableTile(theirs, ME)).toBe(false);
  });

  it('shows in the picker as held by me or by someone else', () => {
    expect(busyReason(mine, ME)).toBe('manual_self');
    expect(busyReason(theirs, ME)).toBe('manual_other');
    expect(busyReason({ udid: UDID, busy: true, session_id: 'appium-1' }, ME)).toBe('automation');
    expect(busyReason({ udid: UDID, busy: true }, ME)).toBe('unknown');
    expect(busyReason({ udid: UDID, busy: false }, ME)).toBe(undefined);
  });
});
