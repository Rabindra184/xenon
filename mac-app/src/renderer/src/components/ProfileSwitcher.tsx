import { useId, useRef, useState } from 'react';
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

/**
 * The profile on screen, at the top of the sidebar. Most people have one, so
 * it is a button with its name; it opens a popover that lists every profile
 * (name and a one-line summary, a check on the open one) with New profile… and
 * Manage profiles…. The list is a radio group, so arrow keys move between the
 * profiles (and open the one they reach), and Tab goes on to the buttons below.
 */
export function ProfileSwitcher({ profiles, activeId, onSelect, onNew, onManage }: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = profiles.find((p) => p.id === activeId);
  // Never an empty name: a profile with no name, or no profile at all, still reads as something.
  const label = active ? profileName(active.name) : SHELL.switcher.noProfile;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
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
            value={activeId ?? ''}
            onValueChange={onSelect}
            className="flex flex-col gap-0.5"
          >
            {profiles.map((p) => (
              <ProfileOption key={p.id} profile={p} onChosen={() => setOpen(false)} />
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

/** One profile in the list: its name and summary, and a check when it is the one on screen. */
function ProfileOption({ profile, onChosen }: { profile: Profile; onChosen: () => void }) {
  const nameId = useId();
  const summaryId = useId();
  return (
    <RadioGroup.Item
      value={profile.id}
      data-testid="profile-option"
      // The name is the radio's name and the summary its description, so a screen reader hears them apart.
      aria-labelledby={nameId}
      aria-describedby={summaryId}
      // A click or Enter picks the profile and closes the list. An arrow key also "clicks" the radio it
      // moves to (that is how a radio group selects), and must leave the list open to go on.
      onClick={(event) => {
        if (event.detail > 0) onChosen();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onChosen();
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
