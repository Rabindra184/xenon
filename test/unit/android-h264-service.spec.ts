import 'reflect-metadata';
import { expect } from 'chai';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';

// Lifecycle/state only — the capture seam (openCapture) is stubbed so the test
// drives packet flow without a real device or screenrecord process.
function make(): any {
  const svc: any = Object.create(AndroidH264StreamService.prototype);
  svc.sessions = new Map();
  svc.startPromises = new Map();
  return svc;
}

describe('AndroidH264StreamService', () => {
  it('start() creates a multiplexer, seeds it with the config packet, and resolves', async () => {
    const svc = make();
    svc.openCapture = async (_udid: string, onPacket: any) => {
      onPacket({ type: 'config', data: Buffer.from([0]), ptsMs: 0 });
      return { kill: () => undefined };
    };
    const mux = await svc.start('udid-x');
    expect(mux).to.equal(svc.getMultiplexer('udid-x'));
    expect(mux.clientCount).to.equal(0);
  });

  it('start() is idempotent per udid (concurrent starts share one capture)', async () => {
    const svc = make();
    let opens = 0;
    svc.openCapture = async (_udid: string, onPacket: any) => {
      opens++;
      onPacket({ type: 'config', data: Buffer.from([0]), ptsMs: 0 });
      return { kill: () => undefined };
    };
    const [a, b] = await Promise.all([svc.start('udid-y'), svc.start('udid-y')]);
    expect(a).to.equal(b);
    expect(opens).to.equal(1);
  });

  it('cleans up the session (no zombie) when openCapture throws', async () => {
    const svc = make();
    svc.openCapture = async () => {
      throw new Error('ADB is not available');
    };
    let threw = false;
    try {
      await svc.start('udid-fail');
    } catch {
      threw = true;
    }
    expect(threw, 'start() should reject when capture fails').to.equal(true);
    // The failed session must not linger — else later start()/getMultiplexer
    // hand back a mux that never produces frames.
    expect(svc.getMultiplexer('udid-fail')).to.equal(undefined);
    expect(svc.sessions.has('udid-fail')).to.equal(false);
  });

  it('stop() kills the capture and clears the session', async () => {
    const svc = make();
    let killed = false;
    svc.openCapture = async (_udid: string, onPacket: any) => {
      onPacket({ type: 'config', data: Buffer.from([0]), ptsMs: 0 });
      return {
        kill: () => {
          killed = true;
        },
      };
    };
    await svc.start('udid-z');
    await svc.stop('udid-z');
    expect(killed).to.equal(true);
    expect(svc.getMultiplexer('udid-z')).to.equal(undefined);
  });

  it('start({source:"scrcpy"}) uses the scrcpy capture seam', async () => {
    const svc = make();
    let used = '';
    svc.openScrcpyCapture = async (_u: string, onPacket: any) => {
      used = 'scrcpy';
      onPacket({ type: 'config', data: Buffer.from([0]), ptsMs: 0 });
      return { kill: () => undefined };
    };
    svc.openScreenrecordCapture = async () => { used = 'screenrecord'; return { kill: () => undefined }; };
    await svc.start('udid-s', { source: 'scrcpy' });
    expect(used).to.equal('scrcpy');
  });

  it('start({source:"screenrecord"}) uses the legacy capture seam', async () => {
    const svc = make();
    let used = '';
    svc.openScrcpyCapture = async () => { used = 'scrcpy'; return { kill: () => undefined }; };
    svc.openScreenrecordCapture = async (_u: string, onPacket: any) => {
      used = 'screenrecord';
      onPacket({ type: 'config', data: Buffer.from([0]), ptsMs: 0 });
      return { kill: () => undefined };
    };
    await svc.start('udid-r', { source: 'screenrecord' });
    expect(used).to.equal('screenrecord');
  });
});
