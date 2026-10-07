// Words for choosing, managing and sharing profiles: the switcher in the
// sidebar and the Profiles sheet. The switcher's own fallback, when there is no
// profile at all, is SHELL.switcher.noProfile.

export const PROFILES = {
  /** What a profile with no name is called, wherever it is listed. */
  untitled: 'Untitled profile',
  switcher: {
    /** Names the popover for a screen reader. */
    panel: 'Switch profile',
    /** Names the list of profiles (a radio group, so arrow keys move between them). */
    list: 'Profiles',
    newProfile: 'New profile…',
    manage: 'Manage profiles…'
  },
  sheet: {
    title: 'Profiles',
    description: 'Rename, copy, remove, import and export the profiles on this Mac.',
    /** Beside the profile that is open. */
    current: 'Current',
    rename: 'Rename',
    /** The rename box's label, which stays off screen: the row already shows the name. */
    renameLabel: 'Profile name',
    duplicate: 'Duplicate',
    delete: 'Delete',
    /** The accessible name of the red Delete that confirms. */
    confirmDelete: 'Confirm delete',
    deleteQuestion: (name: string) => `Delete “${name}”? Its settings can’t be recovered.`,
    import: 'Import…',
    export: 'Export…',
    exportHint: 'Export saves the profile marked Current.',
    empty: 'No profiles yet.',
    newProfile: 'New profile',
    /** Names the list of rows. */
    list: 'Profiles'
  },
  exported: 'Profile exported',
  /** What an export says it left out: secret values are never written to the file. */
  exportNotice: {
    one: '1 secret value was left out — enter it again after importing',
    many: (n: number) => `${n} secret values were left out — enter them again after importing`
  }
} as const;
