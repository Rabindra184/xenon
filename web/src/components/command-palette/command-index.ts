import { fuzzyScore } from './fuzzy';
import { deviceControlPath } from '../../lib/deviceControlPath';
import { phoneKey, serverLabel } from '../../lib/phone';

export type CommandKind = 'nav' | 'device' | 'build' | 'session' | 'team' | 'key' | 'app';

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
  { id: 'nav:live', kind: 'nav', label: 'Live devices', path: '/devices/live' },
  { id: 'nav:builds', kind: 'nav', label: 'Sessions', path: '/builds' },
  { id: 'nav:apps', kind: 'nav', label: 'Apps', path: '/apps' },
  { id: 'nav:selector-health', kind: 'nav', label: 'Selector health', path: '/selector-health' },
  { id: 'nav:notifications', kind: 'nav', label: 'Notifications', path: '/settings/notifications' },
  { id: 'nav:settings', kind: 'nav', label: 'Settings', path: '/settings' },
  { id: 'nav:ai-settings', kind: 'nav', label: 'AI engine', path: '/settings/ai' },
  { id: 'nav:maintenance', kind: 'nav', label: 'Maintenance', path: '/settings/maintenance' },
  { id: 'nav:teams', kind: 'nav', label: 'Teams', path: '/settings/teams' },
  { id: 'nav:api-keys', kind: 'nav', label: 'API keys', path: '/settings/api-keys' },
  { id: 'nav:users', kind: 'nav', label: 'Users', path: '/settings/users' },
  { id: 'nav:profile', kind: 'nav', label: 'Profile', path: '/profile' },
];

export class CommandIndex {
  private devices: CommandItem[] = [];
  private builds: CommandItem[] = [];
  private sessions: CommandItem[] = [];
  private teams: CommandItem[] = [];
  private keys: CommandItem[] = [];
  private apps: CommandItem[] = [];

  // One entry per phone: two servers can each list `emulator-5554`.
  // Two phones of one udid also say which server each is on.
  setDevices(list: Array<{ udid: string; host: string; name?: string }>): void {
    const servers = new Map<string, number>();
    list.forEach((d) => servers.set(d.udid, (servers.get(d.udid) ?? 0) + 1));
    this.devices = list.map((d) => ({
      id: `device:${phoneKey(d)}`,
      kind: 'device',
      label: d.name || d.udid,
      sub: (servers.get(d.udid) ?? 0) > 1 ? `${d.udid} · ${serverLabel(d.host)}` : d.udid,
      path: deviceControlPath(d),
    }));
  }

  // Builds are what the Sessions page lists, and what people remember by name.
  // Only `sessions` (currently running ones, from GET /session) used to be
  // indexed, so searching a build from the Sessions page found nothing even
  // though the placeholder promises "Search devices, sessions…".
  setBuilds(
    list: Array<{ id: string; name?: string | null; sessionCount?: number; failedCount?: number }>,
  ): void {
    this.builds = list.map((b) => ({
      id: `build:${b.id}`,
      kind: 'build',
      label: b.name || b.id,
      sub:
        typeof b.sessionCount === 'number'
          ? `${b.sessionCount} session${b.sessionCount === 1 ? '' : 's'}${
              b.failedCount ? ` · ${b.failedCount} failed` : ''
            }`
          : b.id,
      path: `/builds/${encodeURIComponent(b.id)}`,
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
      path: `/settings/teams?team=${encodeURIComponent(t.id)}`,
    }));
  }

  setKeys(list: Array<{ id: string; name?: string }>): void {
    this.keys = list.map((k) => ({
      id: `key:${k.id}`,
      kind: 'key',
      label: k.name || k.id,
      sub: k.id,
      path: `/settings/api-keys?key=${encodeURIComponent(k.id)}`,
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
      ...this.builds,
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
