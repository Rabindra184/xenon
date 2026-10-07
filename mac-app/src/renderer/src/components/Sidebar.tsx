import { House, ScrollText, SlidersHorizontal, Wrench } from 'lucide-react';
import { SHELL } from '../copy/shell';
import { Badge } from './ui/Badge';
import { TabList, TabTrigger } from './ui/Tabs';
import { ProfileSwitcher } from './ProfileSwitcher';
import { SidebarStatus, type SidebarStatusProps } from './SidebarStatus';

export interface SidebarProps {
  /** The profile on screen; null until the profiles have loaded (or when there are none). */
  profileName: string | null;
  /** Setup's "!": a check needs attention. */
  setupAttention: boolean;
  /** Logs' dot: the server stopped unexpectedly and Logs hasn't been opened since. */
  logsAlert: boolean;
  status: SidebarStatusProps;
}

/**
 * The slim sidebar, top to bottom: the profile switcher, the four places (the
 * tab list of the window's Tabs, so arrow keys move between them) and the
 * server's status with Start or Stop. Its top is the title bar's drag area,
 * under the traffic lights.
 */
export function Sidebar({ profileName, setupAttention, logsAlert, status }: SidebarProps) {
  return (
    <div className="flex w-44 shrink-0 flex-col border-r border-line bg-surface">
      <div className="titlebar-drag h-10 shrink-0" />
      <div className="shrink-0 px-2 pb-3">{profileName !== null && <ProfileSwitcher name={profileName} />}</div>
      <nav className="min-h-0 flex-1 px-2">
        <TabList aria-label={SHELL.places.label}>
          <TabTrigger value="home" icon={<House size={16} />}>
            {SHELL.places.home}
          </TabTrigger>
          <TabTrigger
            value="setup"
            icon={<Wrench size={16} />}
            badge={
              setupAttention ? (
                <Badge tone="attention" role="img" aria-label={SHELL.places.needsAttention}>
                  !
                </Badge>
              ) : undefined
            }
          >
            {SHELL.places.setup}
          </TabTrigger>
          <TabTrigger value="settings" icon={<SlidersHorizontal size={16} />}>
            {SHELL.places.settings}
          </TabTrigger>
          <TabTrigger
            value="logs"
            icon={<ScrollText size={16} />}
            badge={
              logsAlert ? (
                <span role="img" aria-label={SHELL.places.newProblem} className="block h-2 w-2 rounded-full bg-danger" />
              ) : undefined
            }
          >
            {SHELL.places.logs}
          </TabTrigger>
        </TabList>
      </nav>
      <SidebarStatus {...status} />
    </div>
  );
}
