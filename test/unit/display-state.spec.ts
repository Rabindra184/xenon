import 'reflect-metadata';
import { expect } from 'chai';
import { parseDisplayState } from '../../src/device-managers/android/displayState';
import { DisplayStateService, DISPLAY_STATE_TTL_MS } from '../../src/services/DisplayStateService';

/**
 * A sleeping device streams a perfectly black frame, indistinguishable from a
 * broken stream or a black-themed app. This is the read that tells them apart,
 * so its failure mode matters more than its happy path: a wrong 'off' puts
 * "your display is off" over a screen the user is looking at.
 */
describe('parseDisplayState', () => {
  // Trimmed from a real Galaxy S9 `dumpsys power`. Note the wakefulness line:
  // with the panel off it reads Dozing, not Asleep, which is exactly why this
  // keys on Display Power instead.
  const awake = `
Power Manager State:
  mWakefulness=Awake
  mWakefulnessChanging=false
Display Power: state=ON
  mHoldingDisplaySuspendBlocker=true
`;
  const asleep = `
Power Manager State:
  mWakefulness=Dozing
  mWakefulnessChanging=false
Display Power: state=OFF
  mHoldingDisplaySuspendBlocker=false
`;

  it('reads a lit panel as on', () => {
    expect(parseDisplayState(awake)).to.equal('on');
  });

  it('reads a dark panel as off', () => {
    expect(parseDisplayState(asleep)).to.equal('off');
  });

  it('does not take Dozing wakefulness as evidence the panel is off', () => {
    // The same device reports mWakefulness=Dozing in both states. Reading
    // that line instead would call a lit screen asleep.
    expect(parseDisplayState(asleep.replace('state=OFF', 'state=ON'))).to.equal('on');
  });

  it('keeps always-on display distinct from off', () => {
    // AOD is showing a clock — the frame is not black, so an overlay saying
    // "display is off" would be its own small lie.
    expect(parseDisplayState('Display Power: state=DOZE')).to.equal('doze');
    expect(parseDisplayState('Display Power: state=DOZE_SUSPEND')).to.equal('doze');
  });

  it('answers unknown rather than guessing', () => {
    ['', 'Power Manager State:\n  mWakefulness=Awake', 'Display Power: state=WAT'].forEach((s) =>
      expect(parseDisplayState(s)).to.equal('unknown'),
    );
  });

  it('tolerates the spacing and casing varying between vendors', () => {
    expect(parseDisplayState('display power:state=off')).to.equal('off');
    expect(parseDisplayState('Display Power:   state=On')).to.equal('on');
  });
});

describe('DisplayStateService', () => {
  it('serves a second caller from cache instead of a second adb call', async () => {
    const svc = new DisplayStateService();
    let calls = 0;
    const read = async () => {
      calls++;
      return 'off' as const;
    };
    expect(await svc.get('udid', read, 1000)).to.equal('off');
    expect(await svc.get('udid', read, 1000 + DISPLAY_STATE_TTL_MS - 1)).to.equal('off');
    expect(calls).to.equal(1);
  });

  it('reads again once the reading is stale', async () => {
    const svc = new DisplayStateService();
    let calls = 0;
    const read = async () => {
      calls++;
      return calls === 1 ? ('off' as const) : ('on' as const);
    };
    await svc.get('udid', read, 1000);
    // The cache stamps its own Date.now() on write, so step well past the TTL
    // rather than relying on the injected clock for expiry.
    await new Promise((r) => setTimeout(r, DISPLAY_STATE_TTL_MS + 20));
    expect(await svc.get('udid', read)).to.equal('on');
    expect(calls).to.equal(2);
  });

  it('collapses concurrent callers onto one read', async () => {
    // Every open preview polls this. Without sharing the in-flight promise a
    // mosaic of tiles watching one device is one adb spawn per tile.
    const svc = new DisplayStateService();
    let calls = 0;
    const read = () =>
      new Promise<'on'>((resolve) => {
        calls++;
        setTimeout(() => resolve('on'), 20);
      });
    const results = await Promise.all([
      svc.get('udid', read),
      svc.get('udid', read),
      svc.get('udid', read),
    ]);
    expect(results).to.deep.equal(['on', 'on', 'on']);
    expect(calls).to.equal(1);
  });

  it('reports unknown and does not raise when the read fails', async () => {
    const svc = new DisplayStateService();
    const state = await svc.get('udid', async () => {
      throw new Error('device offline');
    });
    expect(state).to.equal('unknown');
  });

  it('survives a reader that throws synchronously', async () => {
    const svc = new DisplayStateService();
    const state = await svc.get('udid', (() => {
      throw new Error('adb missing');
    }) as any);
    expect(state).to.equal('unknown');
  });

  it('retries after a failure rather than caching it for the TTL', async () => {
    const svc = new DisplayStateService();
    let calls = 0;
    const read = async () => {
      calls++;
      if (calls === 1) throw new Error('transient');
      return 'on' as const;
    };
    expect(await svc.get('udid', read, 1000)).to.equal('unknown');
    expect(await svc.get('udid', read, 1000)).to.equal('on');
    expect(calls).to.equal(2);
  });
});
