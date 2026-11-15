import dns from 'dns';
import https from 'https';
import net from 'net';
import type { Readable } from 'stream';
import { OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';

/**
 * Client ID metadata documents: an agent whose `client_id` is an https URL
 * names its own registration, a JSON document the hub fetches from there.
 *
 * Anyone can make the hub fetch one (an authorize request naming the URL), so
 * the fetch must never be a way into the hub's own network (Review Focus 2):
 *
 * - https only, no credentials or fragment in the URL, and a path.
 * - Every address the name resolves to must be public: not loopback, private,
 *   link-local, unique-local, shared (CGNAT), multicast or reserved, nor an
 *   IPv4 address inside an IPv6 one that is. An address literal is checked
 *   the same way, without a lookup.
 * - The connection goes to the address that was checked (`openPinned`'s
 *   `lookup`), never to a second lookup a DNS rebinding answer could change,
 *   and the certificate is still checked against the name.
 * - No redirects: anything but a 200 is refused.
 * - At most 64 KB, counted as it arrives, whatever `Content-Length` says.
 * - 5 s for the whole of it, lookup included.
 * - No HTTP proxy: Node's `https` reads none, and a proxy would resolve the
 *   name itself, past the address check.
 *
 * A document that passes is kept for 10 minutes. The store judges what it
 * says about redirect URIs and secrets (ClientStore.getClient).
 */

export const METADATA_FETCH_TIMEOUT_MS = 5_000;
export const METADATA_MAX_BYTES = 64 * 1024;
export const METADATA_CACHE_MS = 10 * 60_000;
const METADATA_CACHE_MAX = 500;

export type ClientMetadata = OAuthClientMetadata & { client_id: string };

export type RefusalReason =
  | 'bad_url'
  | 'not_https'
  | 'unresolvable'
  | 'private_address'
  | 'redirect'
  | 'status'
  | 'too_large'
  | 'timeout'
  | 'unreachable'
  | 'invalid_document'
  | 'client_id_mismatch';

/** A document the hub won't use, and why. */
export class ClientMetadataRefused extends Error {
  constructor(
    public readonly reason: RefusalReason,
    message: string,
  ) {
    super(message);
    this.name = 'ClientMetadataRefused';
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** What the transport answers: the status, the headers and the body, unread. */
export interface MetadataResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
}

/** The two seams a spec replaces: the name lookup and the connection. */
export interface MetadataFetchDeps {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  open?: (url: URL, target: ResolvedAddress, signal: AbortSignal) => Promise<MetadataResponse>;
}

// --- Which addresses are public ----------------------------------------------

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network", unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared address space (CGNAT)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata services live here)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];

const BLOCKED_V6: Array<[string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::ffff:0:0:0', 96], // IPv4-translated (SIIT)
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo among them)
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
];

const blocked = new net.BlockList();
for (const [network, prefix] of BLOCKED_V4) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of BLOCKED_V6) blocked.addSubnet(network, prefix, 'ipv6');

/** An IPv6 address as its eight 16-bit groups, or null if it isn't one. */
function ipv6Groups(address: string): number[] | null {
  if (net.isIPv6(address) === false) return null;
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  // A dotted IPv4 tail (::ffff:1.2.3.4) is two groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const parts = tail.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((parts[0] << 8) | parts[1]).toString(16)}:${(
      (parts[2] << 8) |
      parts[3]
    ).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const restGroups = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const missing = 8 - headGroups.length - restGroups.length;
  const groups =
    rest === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(Math.max(missing, 0)).fill('0'), ...restGroups];
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g, 16));
}

function ipv4Of(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * The IPv4 address an IPv6 one carries, where the packet would really go:
 * IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64
 * (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::).
 */
function embeddedIpv4(groups: number[]): string | null {
  const zeros = (from: number, to: number) => groups.slice(from, to).every((g) => g === 0);
  if (zeros(0, 5) && groups[5] === 0xffff) return ipv4Of(groups[6], groups[7]);
  if (zeros(0, 6) && (groups[6] !== 0 || groups[7] > 1)) return ipv4Of(groups[6], groups[7]);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6))
    return ipv4Of(groups[6], groups[7]);
  if (groups[0] === 0x2002) return ipv4Of(groups[1], groups[2]);
  return null;
}

/**
 * Whether `address` is an address on the public internet: not loopback,
 * private, link-local, unique-local, shared, multicast, documentation or
 * reserved, nor an IPv6 address carrying an IPv4 one that is. Anything that
 * isn't an IP address is not public.
 */
export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) return !blocked.check(address, 'ipv4');
  const groups = ipv6Groups(address);
  if (!groups) return false;
  const v4 = embeddedIpv4(groups);
  if (v4 !== null) return isPublicAddress(v4);
  const canonical = groups.map((g) => g.toString(16)).join(':');
  return !blocked.check(canonical, 'ipv6');
}

// --- The fetch -----------------------------------------------------------------

async function lookupAll(hostname: string): Promise<ResolvedAddress[]> {
  const found = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return found.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

/**
 * GET `url` from `target`, the address already checked for it: the socket
 * goes there, and TLS still checks the certificate against the URL's name.
 * `tls.ca` is for specs, which serve a certificate of their own.
 */
export function openPinned(
  url: URL,
  target: ResolvedAddress,
  signal: AbortSignal,
  tls: { ca?: string } = {},
): Promise<MetadataResponse> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'xenon-hub' },
        // A fresh agent: no pooled socket from another name, no proxy.
        agent: false,
        signal,
        ...(net.isIP(hostname) ? {} : { servername: hostname }),
        ...(tls.ca ? { ca: tls.ca } : {}),
        lookup: ((
          _name: string,
          options: { all?: boolean },
          callback: (...args: unknown[]) => void,
        ) => {
          if (options?.all) callback(null, [{ address: target.address, family: target.family }]);
          else callback(null, target.address, target.family);
        }) as unknown as net.LookupFunction,
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }),
    );
    req.on('error', reject);
    req.end();
  });
}

/** The URL as a client_id can name it, or the reason it can't. */
function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ClientMetadataRefused('bad_url', 'the client_id is not a URL');
  }
  // The WHATWG parser drops tabs and newlines and rewrites some spellings,
  // so a client_id must be the URL exactly as the parser writes it: nothing
  // else is ever logged or stored as one.
  if (/\p{Cc}/u.test(raw) || url.href !== raw) {
    throw new ClientMetadataRefused(
      'bad_url',
      'a client_id URL must be written exactly as its normalized form, with no control characters',
    );
  }
  if (url.protocol !== 'https:') {
    throw new ClientMetadataRefused('not_https', 'a client_id document must be served over https');
  }
  if (
    url.username ||
    url.password ||
    raw.includes('#') ||
    url.pathname === '/' ||
    /\/\.\.?(\/|$)/.test(raw)
  ) {
    throw new ClientMetadataRefused(
      'bad_url',
      'a client_id URL needs a path, and no credentials, fragment or dot segments',
    );
  }
  return url;
}

function withinTime<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(
        new ClientMetadataRefused('timeout', 'the client_id document did not arrive within 5 s'),
      );
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

async function readBody(body: Readable, contentLength: unknown): Promise<Buffer> {
  const declared = Number(Array.isArray(contentLength) ? contentLength[0] : contentLength);
  const tooLarge = () =>
    new ClientMetadataRefused(
      'too_large',
      `a client_id document may be at most ${METADATA_MAX_BYTES} bytes`,
    );
  if (Number.isFinite(declared) && declared > METADATA_MAX_BYTES) {
    body.destroy();
    throw tooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > METADATA_MAX_BYTES) {
      body.destroy();
      throw tooLarge();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function parseDocument(raw: string, bytes: Buffer): ClientMetadata {
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ClientMetadataRefused('invalid_document', 'the client_id document is not JSON');
  }
  const parsed = OAuthClientMetadataSchema.safeParse(json);
  if (!parsed.success) {
    throw new ClientMetadataRefused(
      'invalid_document',
      'the client_id document is not client metadata (it needs redirect_uris)',
    );
  }
  const clientId = (json as { client_id?: unknown }).client_id;
  if (clientId !== raw) {
    throw new ClientMetadataRefused(
      'client_id_mismatch',
      'the client_id document names another client_id than its own URL',
    );
  }
  return { ...parsed.data, client_id: raw };
}

async function fetchFresh(raw: string, url: URL, deps: MetadataFetchDeps): Promise<ClientMetadata> {
  const resolve = deps.resolve ?? lookupAll;
  const open = deps.open ?? ((u, t, s) => openPinned(u, t, s));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS);
  try {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const family = net.isIP(hostname);
    const targets: ResolvedAddress[] = family
      ? [{ address: hostname, family: family === 6 ? 6 : 4 }]
      : await withinTime(
          resolve(hostname).catch(() => [] as ResolvedAddress[]),
          controller.signal,
        );
    if (targets.length === 0) {
      throw new ClientMetadataRefused('unresolvable', `${hostname} does not resolve`);
    }
    if (!targets.every((t) => isPublicAddress(t.address))) {
      throw new ClientMetadataRefused(
        'private_address',
        `${hostname} resolves to a loopback, private or link-local address`,
      );
    }
    const answer = await withinTime(
      open(url, targets[0], controller.signal).catch((err) => {
        if (err instanceof ClientMetadataRefused) throw err;
        throw new ClientMetadataRefused(
          'unreachable',
          'the client_id document could not be fetched',
        );
      }),
      controller.signal,
    );
    if (answer.status >= 300 && answer.status < 400) {
      answer.body.destroy();
      throw new ClientMetadataRefused(
        'redirect',
        'the client_id URL redirects; it must answer itself',
      );
    }
    if (answer.status !== 200) {
      answer.body.destroy();
      throw new ClientMetadataRefused('status', `the client_id URL answered ${answer.status}`);
    }
    const bytes = await withinTime(
      readBody(answer.body, answer.headers['content-length']),
      controller.signal,
    );
    return parseDocument(raw, bytes);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

const cache = new Map<string, { metadata: ClientMetadata; until: number }>();
const inflight = new Map<string, Promise<ClientMetadata>>();

/**
 * Whether this hub reads client ID metadata documents: unless
 * `XENON_MCP_CLIENT_DOCUMENTS` is `off` (read on every call). A lab on a
 * closed network can't fetch an agent's document from the internet, so it
 * turns them off: the authorization-server metadata then says so
 * (`client_id_metadata_document_supported: false`), an agent registers
 * instead, and a URL `client_id` is refused without a fetch.
 */
export function clientDocumentsAccepted(): boolean {
  return (process.env.XENON_MCP_CLIENT_DOCUMENTS ?? '').trim().toLowerCase() !== 'off';
}

/** Forget every document kept. For specs. */
export function clearClientMetadataCache(): void {
  cache.clear();
  inflight.clear();
}

/**
 * The client metadata document at `url`, fetched under the rules above and
 * kept for 10 minutes. Throws ClientMetadataRefused for one the hub won't
 * use. Two asks for one URL at once share one fetch.
 */
export async function fetchClientMetadataDocument(
  url: string,
  deps: MetadataFetchDeps = {},
): Promise<ClientMetadata> {
  const parsed = checkUrl(url);
  const kept = cache.get(url);
  if (kept && kept.until > Date.now()) return kept.metadata;
  cache.delete(url);
  const running = inflight.get(url);
  if (running) return running;
  const work = fetchFresh(url, parsed, deps)
    .then((metadata) => {
      if (cache.size >= METADATA_CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(url, { metadata, until: Date.now() + METADATA_CACHE_MS });
      return metadata;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, work);
  return work;
}
