// Keys & accounts' words: every Keychain secret in plain words, a label and
// one line saying what it is for, and what the tab says about each. The
// secrets' environment names and Xenon's own descriptions of them
// (shared/secrets.ts) show only with technical details on.
import type { SecretKey } from '@shared/types';

export interface KeyWords {
  label: string;
  purpose: string;
  /** What the empty box says, when "Paste a key" doesn't fit. */
  placeholder?: string;
}

export const KEYS = {
  intro:
    'Keys and passwords are kept in this Mac’s Keychain, never in a file. The cloud access key and the proxy password belong to this profile alone; the others are shared, and a profile uses the ones it has turned on.',
  saved: 'Saved',
  notSet: 'Not set',
  /** A profile's own secret (the cloud key, the proxy password, R54): its heading and its saved state. */
  forThisProfile: (label: string): string => `${label} — for this profile`,
  savedForProfile: 'Saved for this profile',
  usedByProfile: 'Used by this profile',
  /** Each switch's own name, so a screen reader can tell them apart: it starts with the words on screen. */
  usedByProfileName: (label: string): string => `Used by this profile: ${label}`,
  clearConfirm: (label: string): string => `Clear the ${label}?`,
  clearConfirmHelp: 'Every profile that uses it starts without it until a new one is saved.',
  clearConfirmHelpOwn: 'This profile starts without it until a new one is saved.',
  savedToast: (label: string): string => `${label} saved.`,
  clearedToast: (label: string): string => `${label} cleared.`,
  saveFailed: (label: string): string => `Couldn’t save the ${label}. Try again.`,
  /** Saving failed because this Mac's Keychain can't take a value now. */
  keychainUnavailable: (label: string): string =>
    `Couldn’t save the ${label}: this Mac’s Keychain isn’t available, so it wasn’t saved anywhere. Try again later.`,
  clearFailed: (label: string): string => `Couldn’t clear the ${label}. Try again.`,

  secrets: {
    XENON_GEMINI_API_KEY: { label: 'Gemini key', purpose: 'Lets AI repair broken element lookups with Gemini.' },
    XENON_OPENAI_API_KEY: { label: 'OpenAI key', purpose: 'Lets AI repair broken element lookups with OpenAI.' },
    XENON_ANTHROPIC_API_KEY: { label: 'Claude key', purpose: 'Lets AI repair broken element lookups with Claude.' },
    XENON_HUB_ACCESS_KEY: { label: 'Hub access key', purpose: 'Lets this Mac join a lab hub. Used with the hub token.' },
    XENON_HUB_TOKEN: { label: 'Hub token', purpose: 'Lets this Mac join a lab hub. Used with the access key.' },
    XENON_SMTP_URL: {
      label: 'Email for password resets',
      purpose: 'Sends password-reset emails to people who sign in.',
      placeholder: 'Paste the mail server’s address'
    },
    CLOUD_KEY: { label: 'Cloud access key', purpose: 'Lets Xenon use phones from your cloud provider.' },
    PROXY_PASSWORD: {
      label: 'Proxy password',
      purpose: 'The password for the proxy this server uses.',
      placeholder: 'Type the password'
    },
    DATABASE_URL: {
      label: 'Database file',
      purpose: 'Where Xenon keeps its data.',
      placeholder: 'Paste the database file’s address'
    }
  } satisfies Record<SecretKey, KeyWords> as Record<SecretKey, KeyWords>
} as const;
