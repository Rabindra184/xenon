import { useEffect, useId, useRef, useState } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { Check, ChevronsUpDown, Plus, Settings2 } from 'lucide-react';
import type { Profile } from '@shared/types';
import { PROFILES } from '../copy/profiles';
import { SHELL } from '../copy/shell';
import { profileName, profileSummary } from '../profileSummary';
import { Button } from './ui/Button';
import { Popover } from './ui/Popover';

export interface ProfileSwitcherProps {
  profiles: Profile[];
  /** The profile on screen; null when there is none. */
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Opens the Profiles sheet. */
  onManage: () => void;
}

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/**
 * The profile on screen, at the top of the sidebar. Most people have one, so
 * it is a button with its name; it opens a popover that lists every profile
 * (name and a one-line summary, a check on the one chosen) with New profile…
 * and Manage profiles….
 *
 * The list is a radio group, so arrow keys move between the profiles, but
 * moving only moves the check: switching profiles re-reads the whole app (the
 * checks, the option list, the plugin version), so it waits for Enter, Space or
 * a click, which switch and close. Escape or a click outside closes with the
 * profile unchanged.
 */
export function ProfileSwitcher({ profiles, activeId, onSelect, onNew, onManage }: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false);
  // The check in the list. It starts on the open profile each time the list opens, and moves with the arrow keys.
  const [pending, setPending] = useState<string | null>(activeId);
  const trigger = useRef<HTMLButtonElement>(null);
  const arrowHeld = useRef(false);
  const active = profiles.find((p) => p.id === activeId);
  // Never an empty name: a profile with no name, or no profile at all, still reads as something.
  const label = active ? profileName(active.name) : SHELL.switcher.noProfile;

  // A radio group "clicks" the radio an arrow key moves to, to check it. That click is only a move here;
  // every other click (a pointer, Space, a screen reader's press) is a choice. Tracked as the radio group does.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (ARROW_KEYS.includes(event.key)) arrowHeld.current = true;
    };
    const up = () => {
      arrowHeld.current = false;
    };
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('keyup', up);
    };
  }, []);

  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setPending(activeId);
        setOpen(next);
      }}
      label={PROFILES.switcher.panel}
      trigger={
        <button
          ref={trigger}
          type="button"
          data-testid="profile-switcher"
          title={label}
          className="focus-ring titlebar-no-drag flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-semibold text-ink hover:bg-surface2"
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronsUpDown size={14} aria-hidden="true" className="shrink-0 text-dim" />
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        {profiles.length > 0 ? (
          <RadioGroup.Root
            aria-label={PROFILES.switcher.list}
            value={pending ?? ''}
            onValueChange={setPending}
            className="flex flex-col gap-0.5"
          >
            {profiles.map((p) => (
              <ProfileOption key={p.id} profile={p} onChoose={choose} arrowHeld={arrowHeld} />
            ))}
          </RadioGroup.Root>
        ) : (
          <p className="px-2 py-1 text-sm text-muted">{SHELL.noProfiles}</p>
        )}
        <div className="flex flex-col gap-0.5 border-t border-line pt-2">
          <Button
            variant="quiet"
            className="w-full justify-start"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => {
              setOpen(false);
              onNew();
            }}
          >
            {PROFILES.switcher.newProfile}
          </Button>
          <Button
            variant="quiet"
            className="w-full justify-start"
            icon={<Settings2 size={14} aria-hidden="true" />}
            onClick={() => {
              // The sheet notes what has focus as it opens, to give it back when it closes. This
              // button is about to go, so hand focus to the switcher first: that is what the sheet
              // should return to.
              trigger.current?.focus();
              setOpen(false);
              onManage();
            }}
          >
            {PROFILES.switcher.manage}
          </Button>
        </div>
      </div>
    </Popover>
  );
}

/** One profile in the list: its name and summary, and a check when it is the one chosen. */
function ProfileOption({
  profile,
  onChoose,
  arrowHeld
}: {
  profile: Profile;
  onChoose: (id: string) => void;
  arrowHeld: { current: boolean };
}) {
  const nameId = useId();
  const summaryId = useId();
  return (
    <RadioGroup.Item
      value={profile.id}
      data-testid="profile-option"
      // The name is the radio's name and the summary its description, so a screen reader hears them apart.
      aria-labelledby={nameId}
      aria-describedby={summaryId}
      onClick={() => {
        if (!arrowHeld.current) onChoose(profile.id);
      }}
      // A radio group leaves Enter alone (it only prevents the default), so Enter chooses here.
      onKeyDown={(event) => {
        if (event.key === 'Enter') onChoose(profile.id);
      }}
      className="focus-ring flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface data-[state=checked]:bg-surface"
    >
      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <RadioGroup.Indicator>
          <Check size={16} aria-hidden="true" className="text-accent" />
        </RadioGroup.Indicator>
      </span>
      <span className="min-w-0 flex-1">
        <span id={nameId} className="block truncate text-sm font-medium text-ink">
          {profileName(profile.name)}
        </span>
        <span id={summaryId} className="block truncate text-xs text-muted">
          {profileSummary(profile)}
        </span>
      </span>
    </RadioGroup.Item>
  );
}
