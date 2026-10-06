import { describe, expect, it, vi } from 'vitest';

// paths.ts reads Electron's `app`; the supervisor only needs it when launching.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { ProcessSupervisor, type SupervisorDeps } from '../src/main/ProcessSupervisor';

const deps: SupervisorDeps = {
  resolveAppiumHome: () => '/tmp',
  resolveConfigYamlPath: () => '/tmp/config.yml',
  resolveSecrets: () => ({}),
  requiredDefaults: () => ({})
};

type Internals = { child: unknown; state: { status: string } };

function withFakeChild(status: string) {
  const supervisor = new ProcessSupervisor(deps);
  const kill = vi.fn();
  const internals = supervisor as unknown as Internals;
  internals.child = { kill };
  internals.state = { ...supervisor.getState(), status };
  return { supervisor, kill };
}

describe('ProcessSupervisor.forceStop', () => {
  it('marks a running child as stopping before the SIGKILL, so the exit reads as Stopped', () => {
    const { supervisor, kill } = withFakeChild('running');
    const seen: string[] = [];
    supervisor.on('state', (s) => seen.push(s.status));
    supervisor.forceStop();
    expect(seen).toEqual(['stopping']);
    expect(supervisor.getState().status).toBe('stopping');
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not re-announce stopping when a stop is already in progress', () => {
    const { supervisor, kill } = withFakeChild('stopping');
    const seen: string[] = [];
    supervisor.on('state', (s) => seen.push(s.status));
    supervisor.forceStop();
    expect(seen).toEqual([]);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does nothing when no child is running', () => {
    const supervisor = new ProcessSupervisor(deps);
    supervisor.forceStop();
    expect(supervisor.getState().status).toBe('stopped');
  });
});
