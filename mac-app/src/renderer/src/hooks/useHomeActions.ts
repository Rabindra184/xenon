import { useEffect, useState } from 'react';
import type { PreflightResult, Profile, ServerState } from '@shared/types';
import { testAddressSource } from '../addresses';
import { copyAddress } from '../components/AddressCard';
import { toast } from '../components/ui/toastStore';
import { HOME } from '../copy/home';
import type { Place } from '../navigation';
import type { FixAction } from '../quickFix';
import type { HomeActionId } from '../screens/Home';

export interface HomeActionsInput {
  server: ServerState;
  /** The open profile, as edited on screen. */
  draft: Profile | null;
  /** Every profile, as shown. */
  profiles: readonly Profile[];
  requestStart(): Promise<void>;
  stop(): Promise<void>;
  /** Looks at this Mac again now. */
  refreshNow(): Promise<PreflightResult | null>;
  runSetup(): Promise<void>;
  /** Puts a port in the port box and the profile. */
  setPort(port: number): void;
  /** Writes a pending edit of the profile now. */
  flush(): void;
  select(profileId: string): void;
  go(place: Place): void;
  /** "See what happened": Logs, at the line Home quotes (useLogsFocus). */
  seeWhatHappened(): void;
  /** Puts the cursor in a setting, once Settings is drawn. */
  focus(path: string): void;
}

export interface HomeActions {
  onAction(id: HomeActionId): void;
  onQuickFix(action: FixAction): void;
  /** Copy Test Address, from the Server menu, ⇧⌘C and the menu-bar icon. */
  copyTestAddress(): Promise<void>;
}

/** What Home's buttons, its quick fix on "Can’t start yet", and Copy Test Address do. */
export function useHomeActions(i: HomeActionsInput): HomeActions {
  // "Use port N" looks again at once, rather than after the pause an edit waits out. The look
  // reads the profile as drawn, so it runs once the new port is drawn.
  const [lookAgainAt, setLookAgainAt] = useState<number | null>(null);
  const { refreshNow } = i;
  const drawnPort = i.draft?.server.port;
  useEffect(() => {
    if (lookAgainAt === null || drawnPort !== lookAgainAt) return;
    setLookAgainAt(null);
    void refreshNow();
  }, [lookAgainAt, drawnPort, refreshNow]);

  const onAction = (id: HomeActionId) => {
    switch (id) {
      case 'start':
        void i.requestStart();
        return;
      case 'stop':
        void i.stop();
        return;
      case 'open-dashboard':
        if (i.server.dashboardUrl) void window.xenon.server.openDashboard(i.server.dashboardUrl);
        return;
      case 'try-again':
        void i.refreshNow();
        return;
      case 'see-logs':
        i.seeWhatHappened();
        return;
      case 'switch-profile':
        if (i.server.profileId) i.select(i.server.profileId);
        return;
      case 'setup':
        void i.runSetup();
        return;
      default: {
        const unhandled: never = id;
        return unhandled;
      }
    }
  };

  const onQuickFix = (action: FixAction) => {
    switch (action.kind) {
      case 'set-port':
        i.setPort(action.port);
        i.flush();
        setLookAgainAt(action.port);
        return;
      case 'setup':
        void i.runSetup();
        return;
      case 'focus':
        i.go('settings');
        i.focus(action.path);
        return;
      case 'link':
        void window.xenon.app.openLink(action.link);
        return;
      case 'go':
        i.go(action.place);
        return;
      default: {
        const unhandled: never = action;
        return unhandled;
      }
    }
  };

  // The running profile's address while a server is active, which may not be the open profile,
  // else the open profile's (Review Focus 1). No address to give (no profile, or main gave none for
  // the port) says so; a clipboard that refuses it is copyAddress's to say.
  const copyTestAddress = async () => {
    const source = testAddressSource(i.server, i.draft, i.profiles);
    let test: string;
    try {
      if (source === null) throw new Error('There is no test address to copy.');
      ({ test } = await window.xenon.share.addresses({ server: source }));
    } catch {
      toast(HOME.address.noAddress, 'error');
      return;
    }
    await copyAddress(test);
  };

  return { onAction, onQuickFix, copyTestAddress };
}
