import { randomUUID } from 'crypto';
import { Service } from 'typedi';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  CustomOAuthError,
  InvalidClientError,
  TooManyRequestsError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { Container } from 'typedi';
import { prisma } from '../../prisma';
import log from '../../logger';
import {
  ClientMetadata,
  ClientMetadataRefused,
  RefusalReason,
  clientDocumentsAccepted,
  fetchClientMetadataDocument,
} from './clientMetadataDocument';
import { GrantStore } from './grantStore';

/** A registered agent unused this long is forgotten. */
export const CLIENT_UNUSED_DROP_MS = 30 * 24 * 60 * 60 * 1000;
/** At most this many registered agents, after the unused ones are dropped. */
export const MAX_REGISTERED_CLIENTS = 500;
/**
 * A client registered this recently is never evicted to make room: it holds
 * no grant until its user allows it, and its sign-in (authorize, consent, the
 * code exchange) must find it. The pending request waits 10 minutes.
 */
export const NEW_CLIENT_KEPT_MS = 10 * 60 * 1000;
/**
 * Registrations made from one address in an hour, at most
 * (`registerClient`'s `address`; the route passes it through `forAddress`).
 * Registrations that don't say where they came from share one count.
 */
export const REGISTRATIONS_PER_ADDRESS_PER_HOUR = 20;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
/** Addresses whose registrations are counted at once, at most. */
const MAX_COUNTED_ADDRESSES = 10_000;
const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2000;
const MAX_NAME_LENGTH = 100;
const UNNAMED = 'Unnamed agent';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Schemes no redirect may use: they run code, read files or aren't an app's. */
const FORBIDDEN_SCHEMES = new Set([
  'javascript',
  'data',
  'vbscript',
  'file',
  'blob',
  'about',
  'filesystem',
  'view-source',
  'ws',
  'wss',
  'ftp',
  'mailto',
  'tel',
  'sms',
  'chrome',
  'chrome-extension',
  'moz-extension',
  'intent',
]);

const GRANT_TYPES = ['authorization_code', 'refresh_token'];

/** Refusals that would say something about the hub's network, answered alike. */
const NETWORK_REASONS = new Set<RefusalReason>([
  'unresolvable',
  'private_address',
  'unreachable',
  'timeout',
]);

/**
 * Why a redirect URI can't be registered, or null when it can. Allowed:
 * loopback (`http://127.0.0.1`, `http://[::1]`, `http://localhost`, any
 * port), any `https` URL, and a custom scheme an app owns
 * (`cursor://...`, `com.example.app:/...`). Never a fragment or credentials.
 * The authorize step then matches it exactly, but for a loopback port.
 */
export function redirectUriProblem(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return 'is empty';
  if (raw.length > MAX_REDIRECT_URI_LENGTH) return 'is too long';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'is not a URL';
  }
  if (raw.includes('#')) return 'has a fragment';
  if (url.username || url.password) return 'carries credentials';
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'https') return url.hostname ? null : 'has no host';
  if (scheme === 'http') {
    return LOOPBACK_HOSTS.has(url.hostname)
      ? null
      : 'uses plain http, which is allowed only for 127.0.0.1, [::1] or localhost';
  }
  if (FORBIDDEN_SCHEMES.has(scheme)) return `uses the ${scheme}: scheme`;
  return null;
}

function invalidRedirect(message: string): CustomOAuthError {
  return new CustomOAuthError('invalid_redirect_uri', message);
}

/** The redirect URIs a registration or document gives, checked. */
function checkedRedirectUris(uris: unknown): string[] {
  if (!Array.isArray(uris) || uris.length === 0) {
    throw invalidRedirect('a client needs at least one redirect URI');
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    throw invalidRedirect(`a client may have at most ${MAX_REDIRECT_URIS} redirect URIs`);
  }
  for (const uri of uris) {
    const problem = redirectUriProblem(uri);
    if (problem) throw invalidRedirect(`the redirect URI ${String(uri).slice(0, 200)} ${problem}`);
  }
  return [...new Set(uris as string[])];
}

function cleanName(name: unknown): string {
  const text = typeof name === 'string' ? name.replace(/\p{Cc}/gu, ' ').trim() : '';
  return text.slice(0, MAX_NAME_LENGTH) || UNNAMED;
}

/** A client the hub knows, as the SDK's handlers read it: a public client. */
function publicClient(
  clientId: string,
  name: string,
  redirectUris: string[],
  issuedAt?: Date,
): OAuthClientInformationFull {
  return {
    client_id: clientId,
    client_name: name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: GRANT_TYPES,
    response_types: ['code'],
    ...(issuedAt ? { client_id_issued_at: Math.floor(issuedAt.getTime() / 1000) } : {}),
  };
}

/** Whether a client_id names a metadata document (a URL) rather than a registration. */
export function isClientMetadataDocumentId(clientId: string): boolean {
  return /^https?:\/\//i.test(clientId);
}

/**
 * The agents browser sign-in knows (the SDK's OAuthRegisteredClientsStore):
 * those registered here (RFC 7591), in `McpClient`, and those named by a
 * client ID metadata document (an https `client_id`), read from the document
 * and never stored.
 *
 * Every client is public (`token_endpoint_auth_method: 'none'`): the hub
 * keeps no client secret, so the one the SDK's registration handler makes is
 * dropped, never stored or answered. PKCE proves the agent.
 */
@Service()
export class ClientStore implements OAuthRegisteredClientsStore {
  private log = log.scope('OAuthClients');

  /** When each address registered, in the last hour: address -> times (ms). */
  private registrations = new Map<string, number[]>();

  /** How a metadata document is read; a spec replaces it. */
  fetchDocument: (url: string) => Promise<ClientMetadata> = (url) =>
    fetchClientMetadataDocument(url);

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    if (isClientMetadataDocumentId(clientId)) return this.documentClient(clientId);
    const row = await prisma.mcpClient.findUnique({ where: { id: clientId } });
    if (!row) return undefined;
    const now = Date.now();
    if (now - row.lastUsedAt.getTime() > CLIENT_UNUSED_DROP_MS) {
      await prisma.mcpClient.deleteMany({ where: { id: row.id } });
      return undefined;
    }
    return publicClient(row.id, row.name, JSON.parse(row.redirectUris), row.createdAt);
  }

  /**
   * The client was really used: a code or refresh token of it was exchanged
   * (XenonOAuthProvider). Only this keeps a registration from being
   * forgotten; looking a client up, which anyone can make the hub do, doesn't.
   */
  async noteUsed(clientId: string): Promise<void> {
    if (isClientMetadataDocumentId(clientId)) return;
    await prisma.mcpClient
      .updateMany({ where: { id: clientId }, data: { lastUsedAt: new Date() } })
      .catch((err) => this.log.debug(`could not note a client's use: ${err?.message ?? err}`));
  }

  /**
   * This store as the SDK's registration handler sees it, for one caller:
   * its registrations count against `address` (the route reads the caller's
   * address, with trustProxy behind a reverse proxy).
   */
  forAddress(address: string): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.getClient(clientId),
      registerClient: (client) => this.registerClient(client, address),
    };
  }

  /**
   * Register an agent. Refused (`too_many_requests`) as the 21st from
   * `address` in an hour, or when the hub holds 500 and none can be evicted:
   * clients unused for 30 days go first, then the longest-unused ones that
   * hold no live sign-in and weren't registered in the last 10 minutes.
   */
  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
    address?: string,
  ): Promise<OAuthClientInformationFull> {
    const redirectUris = checkedRedirectUris(client.redirect_uris);
    const name = cleanName(client.client_name);
    const release = this.takeRegistrationSlot(address ?? '');
    try {
      return await this.store(name, redirectUris);
    } catch (err) {
      release();
      throw err;
    }
  }

  /** Count a registration from `key` now, or refuse it; answers how to un-count it. */
  private takeRegistrationSlot(key: string): () => void {
    const now = Date.now();
    const recent = (this.registrations.get(key) ?? []).filter(
      (t) => now - t < REGISTRATION_WINDOW_MS,
    );
    if (recent.length >= REGISTRATIONS_PER_ADDRESS_PER_HOUR) {
      this.registrations.set(key, recent);
      throw new TooManyRequestsError(
        `At most ${REGISTRATIONS_PER_ADDRESS_PER_HOUR} agents may register from one address in an hour`,
      );
    }
    recent.push(now);
    this.registrations.delete(key);
    if (this.registrations.size >= MAX_COUNTED_ADDRESSES) {
      for (const [k, times] of this.registrations) {
        if (times.every((t) => now - t >= REGISTRATION_WINDOW_MS)) this.registrations.delete(k);
      }
      if (this.registrations.size >= MAX_COUNTED_ADDRESSES) {
        this.registrations.delete(this.registrations.keys().next().value as string);
      }
    }
    this.registrations.set(key, recent);
    return () => {
      const times = this.registrations.get(key);
      const i = times ? times.indexOf(now) : -1;
      if (i !== -1) times!.splice(i, 1);
    };
  }

  private async store(name: string, redirectUris: string[]): Promise<OAuthClientInformationFull> {
    const now = new Date();
    await this.dropUnused(now);
    await this.makeRoom();
    // Our own id, never one the request suggested: a registered id must
    // never look like a metadata document URL.
    const row = await prisma.mcpClient.create({
      data: {
        id: randomUUID(),
        name,
        redirectUris: JSON.stringify(redirectUris),
        createdAt: now,
        lastUsedAt: now,
      },
    });
    this.log.info(`registered agent ${row.id} (${name})`);
    return publicClient(row.id, row.name, redirectUris, row.createdAt);
  }

  /** The name to show for a client: its registration's, its document's, or its URL's host. */
  async nameOf(clientId: string): Promise<string> {
    if (isClientMetadataDocumentId(clientId)) {
      if (!clientDocumentsAccepted()) return cleanName(new URL(clientId).host);
      try {
        return cleanName(
          (await this.fetchDocument(clientId)).client_name ?? new URL(clientId).host,
        );
      } catch {
        return cleanName(new URL(clientId).host);
      }
    }
    const row = await prisma.mcpClient.findUnique({ where: { id: clientId } });
    return row?.name ?? UNNAMED;
  }

  /** Forget the registered agents unused for 30 days. */
  async dropUnused(now: Date = new Date()): Promise<number> {
    const r = await prisma.mcpClient.deleteMany({
      where: { lastUsedAt: { lt: new Date(now.getTime() - CLIENT_UNUSED_DROP_MS) } },
    });
    if (r.count > 0) this.log.info(`forgot ${r.count} agents unused for 30 days`);
    return r.count;
  }

  /**
   * At the cap, evict the longest-unused clients holding no live sign-in and
   * registered more than NEW_CLIENT_KEPT_MS ago; refuse if none.
   */
  private async makeRoom(): Promise<void> {
    const over = (await prisma.mcpClient.count()) - MAX_REGISTERED_CLIENTS + 1;
    if (over <= 0) return;
    const signedIn = [...(await Container.get(GrantStore).clientsWithLiveGrants())];
    const evict = await prisma.mcpClient.findMany({
      where: {
        id: { notIn: signedIn },
        createdAt: { lt: new Date(Date.now() - NEW_CLIENT_KEPT_MS) },
      },
      orderBy: { lastUsedAt: 'asc' },
      select: { id: true },
      take: over,
    });
    if (evict.length < over) {
      throw new TooManyRequestsError(
        `This hub already has ${MAX_REGISTERED_CLIENTS} registered agents, each signed in or ` +
          'registered in the last 10 minutes. Try again later.',
      );
    }
    const ids = evict.map((c: { id: string }) => c.id);
    await prisma.mcpClient.deleteMany({ where: { id: { in: ids } } });
    this.log.info(`made room for an agent: forgot ${ids.length} without a sign-in`);
  }

  private async documentClient(url: string): Promise<OAuthClientInformationFull> {
    if (!clientDocumentsAccepted()) {
      throw new InvalidClientError(
        "This hub doesn't read client_id documents. Register the agent with the hub instead.",
      );
    }
    let doc: ClientMetadata;
    try {
      doc = await this.fetchDocument(url);
    } catch (err) {
      if (err instanceof ClientMetadataRefused) {
        // Anyone can name a client_id URL, so the answer never says how the
        // name resolved or whether something answered there: that would map
        // the hub's own network. The log says.
        // JSON.stringify: the URL is the caller's, so it is logged escaped.
        this.log.info(
          `refused the client_id document ${JSON.stringify(url.slice(0, 300))}: ${err.reason} (${err.message})`,
        );
        throw new InvalidClientError(
          NETWORK_REASONS.has(err.reason)
            ? 'The client_id document could not be fetched'
            : `The client_id document was refused: ${err.message}`,
        );
      }
      throw err;
    }
    const method = doc.token_endpoint_auth_method;
    if (method !== undefined && method !== 'none') {
      throw new InvalidClientError(
        'The client_id document names a client secret or key; this hub signs in public clients only',
      );
    }
    let redirectUris: string[];
    try {
      redirectUris = checkedRedirectUris(doc.redirect_uris);
    } catch (err: any) {
      throw new InvalidClientError(`The client_id document was refused: ${err.message}`);
    }
    return publicClient(url, cleanName(doc.client_name ?? new URL(url).host), redirectUris);
  }
}
