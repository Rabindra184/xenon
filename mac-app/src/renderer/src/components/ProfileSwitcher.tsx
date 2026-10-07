import { ChevronsUpDown } from 'lucide-react';

/**
 * The profile on screen, at the top of the sidebar. It will open a popover
 * that lists every profile, with New profile… and Manage profiles…; for now it
 * shows the name.
 */
export function ProfileSwitcher({ name }: { name: string }) {
  return (
    <button
      type="button"
      data-testid="profile-switcher"
      title={name}
      className="focus-ring titlebar-no-drag flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-semibold text-ink hover:bg-surface2"
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <ChevronsUpDown size={14} aria-hidden="true" className="shrink-0 text-dim" />
    </button>
  );
}
