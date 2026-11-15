import { randomBytes } from 'crypto';
import { Service } from 'typedi';
import { TooManyRequestsError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

/** An authorize request waits this long for the user's Allow or Deny. */
export const PENDING_AUTHORIZATION_TTL_MS = 10 * 60_000;
/** Authorize requests waiting at once, at most: anyone can start one. */
const MAX_PENDING = 1000;

export interface PendingAuthorizationInput {
  clientId: string;
  /** The agent's name, as its registration or metadata document gives it. */
  clientName: string;
  /** The redirect URI the request named (or the client's only one). */
  redirectUri: string;
  /** The PKCE S256 challenge. */
  codeChallenge: string;
  /** The scopes the agent asked for, as sent. */
  scopes: string[];
  state?: string;
  /** This hub's MCP URL (the request's `resource`, checked). */
  resource: string;
}

export interface PendingAuthorization extends PendingAuthorizationInput {
  id: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Authorize requests waiting for the signed-in user's consent, in memory for
 * 10 minutes: the dashboard's consent page reads one and posts Allow or Deny,
 * once. A restart drops them; the agent starts its sign-in again.
 */
@Service()
export class PendingAuthorizations {
  private pending = new Map<string, PendingAuthorization>();

  /** The clock; a spec replaces it. */
  now: () => number = () => Date.now();

  /** Keep a new request. `too_many_requests` while 1,000 are waiting. */
  add(input: PendingAuthorizationInput): PendingAuthorization {
    const now = this.now();
    this.prune(now);
    if (this.pending.size >= MAX_PENDING) {
      throw new TooManyRequestsError('Too many sign-ins are waiting for consent; try again later');
    }
    const entry: PendingAuthorization = {
      ...input,
      scopes: [...input.scopes],
      id: randomBytes(24).toString('base64url'),
      createdAt: now,
      expiresAt: now + PENDING_AUTHORIZATION_TTL_MS,
    };
    this.pending.set(entry.id, entry);
    return entry;
  }

  /** The request, still waiting, without answering it. */
  get(id: string): PendingAuthorization | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.pending.delete(id);
      return undefined;
    }
    return entry;
  }

  /**
   * Answer the request: it is gone at once, so two answers can't both find
   * it. `putBack` returns one whose answer could not be given.
   */
  take(id: string): PendingAuthorization | undefined {
    const entry = this.get(id);
    if (entry) this.pending.delete(id);
    return entry;
  }

  /** Return a taken request whose answer failed, while it is still in time. */
  putBack(entry: PendingAuthorization): void {
    if (entry.expiresAt > this.now()) this.pending.set(entry.id, entry);
  }

  private prune(now: number): void {
    for (const [id, entry] of this.pending) if (entry.expiresAt <= now) this.pending.delete(id);
  }
}
