// Words the UI kit (components/ui) speaks on its own: accessible names for its
// built-in buttons, and the status words a screen reader hears.
export const UI_COPY = {
  closeDialog: 'Close dialog',
  closePanel: 'Close panel',
  dismiss: 'Dismiss',
  secretSaved: '•••••••• saved',
  secretEmpty: 'Paste a key',
  /** A secret field's buttons, named for the secret so each field's are told apart: "Save Gemini key". */
  saveNamed: (name: string): string => `Save ${name}`,
  clearNamed: (name: string): string => `Clear ${name}`,
  status: {
    ok: 'Ready',
    attention: 'Needs attention',
    info: 'Note',
    checking: 'Checking'
  }
} as const;
