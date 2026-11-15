import { createHash, randomBytes } from 'crypto';
import { Service } from 'typedi';

/** An authorization code lasts this long. */
export const AUTH_CODE_TTL_MS = 60_000;
/**
 * How long a used code is remembered, from its issue: a replay inside it
 * revokes the grant the first use made (RFC 9700 §4.5). A code replayed later
 * is simply unknown.
 */
const USED_CODE_MEMORY_MS = 10 * 60_000;
/** Codes held at once, at most: each is one consented sign-in. */
const MAX_CODES = 10_000;
/** An S256 challenge: the base64url SHA-256 of the verifier, 43 characters. */
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export interface AuthCodeInput {
  userId: string;
  clientId: string;
  redirectUri: string;
  /** The PKCE S256 challenge the authorize request sent. */
  codeChallenge: string;
  /** The granular MCP scopes asked for; cut to the user's role at the exchange. */
  scopes: string[];
  /** The MCP URL the authorize request named (RFC 8707). */
  resource: string;
}

export interface AuthCode extends AuthCodeInput {
  issuedAt: number;
  expiresAt: number;
}

interface Entry extends AuthCode {
  /** Set when the code is exchanged: the grant that use made, once made. */
  used?: Promise<string | undefined>;
}

/** What taking a code found. */
export type TakenCode =
  | { kind: 'fresh'; code: AuthCode; settle: (grantId: string | undefined) => void }
  | { kind: 'used'; grantId: Promise<string | undefined> }
  | { kind: 'unknown' };

function hashOf(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Authorization codes: single use, 60 s, in memory. A restart drops the
 * sign-ins waiting on a code; the agent starts again. Codes are kept by
 * their SHA-256, never in clear.
 */
@Service()
export class AuthCodes {
  private codes = new Map<string, Entry>();

  /** A new code for a consented sign-in. Throws for a challenge that is no S256 hash. */
  issue(input: AuthCodeInput): string {
    if (!S256_CHALLENGE.test(input.codeChallenge)) {
      throw new Error('the code challenge must be an S256 challenge');
    }
    const now = Date.now();
    this.prune(now);
    if (this.codes.size >= MAX_CODES) throw new Error('too many sign-ins in progress');
    const code = randomBytes(32).toString('base64url');
    this.codes.set(hashOf(code), {
      ...input,
      scopes: [...input.scopes],
      issuedAt: now,
      expiresAt: now + AUTH_CODE_TTL_MS,
    });
    return code;
  }

  /** The code, unused and unexpired, without using it. */
  peek(code: string): AuthCode | undefined {
    const entry = this.codes.get(hashOf(code));
    if (!entry || entry.used || entry.expiresAt <= Date.now()) return undefined;
    return entry;
  }

  /**
   * Use the code. Synchronous, so two exchanges of one code can't both find
   * it fresh. A fresh code is marked used at once, whatever the exchange
   * then decides: a failed try uses it up. The caller calls `settle` with the
   * grant the use made (or undefined), which a later replay revokes.
   */
  take(code: string): TakenCode {
    const entry = this.codes.get(hashOf(code));
    if (!entry) return { kind: 'unknown' };
    if (entry.used) return { kind: 'used', grantId: entry.used };
    if (entry.expiresAt <= Date.now()) return { kind: 'unknown' };
    let settle!: (grantId: string | undefined) => void;
    entry.used = new Promise((resolve) => (settle = resolve));
    return { kind: 'fresh', code: { ...entry, scopes: [...entry.scopes] }, settle };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.codes) {
      if (entry.issuedAt + USED_CODE_MEMORY_MS <= now) this.codes.delete(key);
      else if (!entry.used && entry.expiresAt <= now) this.codes.delete(key);
    }
  }
}
