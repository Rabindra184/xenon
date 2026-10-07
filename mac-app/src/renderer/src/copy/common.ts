// Words that mean the same on every screen. A screen's own words live in
// copy/<screen>.ts; main-process text that reaches the window lives in
// src/main/copy.ts.
export const COMMON = {
  copy: 'Copy',
  copied: 'Copied',
  save: 'Save',
  clear: 'Clear',
  cancel: 'Cancel',
  tryAgain: 'Try again',
  close: 'Close'
} as const;
