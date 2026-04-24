import { fuzzyScore } from './fuzzy';

export type CommandKind = 'nav' | 'device' | 'session' | 'team' | 'key' | 'app';

export interface CommandItem {
  id: string;
  kind: CommandKind;
  label: string;
  sub?: string;
  path: string;
}

const NAV_ITEMS: CommandItem[] = [
  { id: 'nav:overview', kind: 'nav', label: 'Overview', path: '/overview' },
  { id: 'nav:devices', kind: 'nav', label: 'Devices', path: '/devices' },
  { id: 'nav:builds', kind: 'nav', label: 'Sessions', path: '/builds' },
  { id: 'nav:apps', kind: 'nav', label: 'Apps', path: '/apps' },
  { id: 'nav:notifications', kind: 'nav', label: 'Notifications', path: '/notifications' },
  { id: 'nav:settings', kind: 'nav', label: 'Settings', path: '/settings' },
  { id: 'nav:ai-settings', kind: 'nav', label: 'AI Engine', path: '/ai-settings' },
  { id: 'nav:maintenance', kind: 'nav', label: 'Maintenance', path: '/maintenance' },
  { id: 'nav:teams', kind: 'nav', label: 'Teams', path: '/teams' },
  { id: 'nav:api-keys', kind: 'nav', label: 'API Keys', path: '/api-keys' },
];

export class CommandIndex {
  private devices: CommandItem[] = [];
  private sessions: CommandItem[] = [];
  private teams: CommandItem[] = [];
  private keys: CommandItem[] = [];
  private apps: CommandItem[] = [];

  setDevices(list: Array<{ udid: string; name?: string }>): void {
    this.devices = list.map((d) => ({
      id: `device:${d.udid}`,
      kind: 'device',
      label: d.name || d.udid,
      sub: d.udid,
      path: `/devices/${d.udid}/control`,
    }));
  }

  setSessions(list: Array<{ id: string; name?: string | null }>): void {
    this.sessions = list.map((s) => ({
      id: `session:${s.id}`,
      kind: 'session',
      label: s.name || s.id,
      sub: s.id,
      path: `/builds?session=${encodeURIComponent(s.id)}`,
    }));
  }

  setTeams(list: Array<{ id: string; name?: string }>): void {
    this.teams = list.map((t) => ({
      id: `team:${t.id}`,
      kind: 'team',
      label: t.name || t.id,
      sub: t.id,
      path: `/teams?team=${encodeURIComponent(t.id)}`,
    }));
  }

  setKeys(list: Array<{ id: string; name?: string }>): void {
    this.keys = list.map((k) => ({
      id: `key:${k.id}`,
      kind: 'key',
      label: k.name || k.id,
      sub: k.id,
      path: `/api-keys?key=${encodeURIComponent(k.id)}`,
    }));
  }

  setApps(list: Array<{ id: string; name?: string }>): void {
    this.apps = list.map((a) => ({
      id: `app:${a.id}`,
      kind: 'app',
      label: a.name || a.id,
      sub: a.id,
      path: `/apps?app=${encodeURIComponent(a.id)}`,
    }));
  }

  search(query: string, max = 8): CommandItem[] {
    if (!query.trim()) return NAV_ITEMS.slice(0, max);
    const all = [
      ...NAV_ITEMS,
      ...this.devices,
      ...this.sessions,
      ...this.teams,
      ...this.keys,
      ...this.apps,
    ];
    return all
      .map((it) => {
        const a = fuzzyScore(query, it.label);
        const b = it.sub ? fuzzyScore(query, it.sub) : 0;
        return { it, score: Math.max(a, b) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((x) => x.it);
  }
}
