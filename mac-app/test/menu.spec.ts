import { describe, expect, it, vi } from 'vitest';
import { buildMenuTemplate } from '../src/main/menu';

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
});
