import { describe, expect, it, vi } from 'vitest';
import { buildMenuTemplate, stopServerEnabled, trayStatusLabel } from '../src/main/menu';

/* eslint-disable @typescript-eslint/no-explicit-any */
function flat(items: any[]): any[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);
}

describe('buildMenuTemplate', () => {
  it('wires shortcuts to menu actions', () => {
    const send = vi.fn();
    const items = flat(buildMenuTemplate({ serverStatus: 'stopped', hasDashboard: false, send }) as any[]);
    const byLabel = Object.fromEntries(items.filter((i) => i.label).map((i) => [i.label, i]));
    expect(byLabel['New Profile'].accelerator).toBe('Cmd+N');
    expect(byLabel['Start Server'].accelerator).toBe('Cmd+Return');
    expect(byLabel['Settings'].accelerator).toBe('Cmd+1');
    expect(byLabel['Logs'].accelerator).toBe('Cmd+4');
    byLabel['New Profile'].click();
    expect(send).toHaveBeenCalledWith('new-profile');
  });

  it('disables dashboard when not running and flips Start/Stop label', () => {
    const send = vi.fn();
    const stopped = flat(buildMenuTemplate({ serverStatus: 'stopped', hasDashboard: false, send }) as any[]);
    expect(stopped.find((i) => i.label === 'Open Dashboard').enabled).toBe(false);
    expect(stopped.find((i) => i.label === 'Start Server')).toBeTruthy();

    const running = flat(buildMenuTemplate({ serverStatus: 'running', hasDashboard: true, send }) as any[]);
    expect(running.find((i) => i.label === 'Stop Server')).toBeTruthy();
    expect(running.find((i) => i.label === 'Open Dashboard').enabled).toBe(true);
    expect(running.find((i) => i.label === 'Launch Preview').enabled).toBe(false);
  });

  it('keeps the Start/Stop item enabled except while a stop is already under way', () => {
    const item = (serverStatus: Parameters<typeof buildMenuTemplate>[0]['serverStatus']) =>
      flat(buildMenuTemplate({ serverStatus, hasDashboard: false, send: vi.fn() }) as any[]).find(
        (i) => i.label === 'Start Server' || i.label === 'Stop Server'
      );
    expect(item('stopped')).toMatchObject({ label: 'Start Server', enabled: true });
    expect(item('crashed')).toMatchObject({ label: 'Start Server', enabled: true });
    expect(item('starting')).toMatchObject({ label: 'Stop Server', enabled: true });
    expect(item('running')).toMatchObject({ label: 'Stop Server', enabled: true });
    expect(item('stopping')).toMatchObject({ label: 'Stop Server', enabled: false });
  });
});

describe('stopServerEnabled (tray)', () => {
  it('is on while starting or running and off otherwise, including while stopping', () => {
    expect(stopServerEnabled('starting')).toBe(true);
    expect(stopServerEnabled('running')).toBe(true);
    expect(stopServerEnabled('stopping')).toBe(false);
    expect(stopServerEnabled('stopped')).toBe(false);
    expect(stopServerEnabled('crashed')).toBe(false);
  });
});

describe('trayStatusLabel', () => {
  it('names every server state, including stopping', () => {
    expect(trayStatusLabel({ status: 'running', port: 4723 })).toBe('Xenon: running (:4723)');
    expect(trayStatusLabel({ status: 'starting', port: 4723 })).toBe('Xenon: starting…');
    expect(trayStatusLabel({ status: 'stopping', port: 4723 })).toBe('Xenon: stopping…');
    expect(trayStatusLabel({ status: 'crashed', port: null })).toBe('Xenon: crashed');
    expect(trayStatusLabel({ status: 'stopped', port: null })).toBe('Xenon: stopped');
  });
});
