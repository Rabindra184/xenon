/**
 * An access key and token sent as HTTP Basic auth: the hub URL a WebDriver
 * client is given, `http://ACCESS_KEY:TOKEN@host:4723/wd/hub`, which the
 * client sends on every request as `Authorization: Basic base64(key:token)`.
 * It is the same key pair as `xe:options.accessKey` / `token` and the
 * `x-xenon-access-key` / `x-xenon-token` headers, verified by the same rule
 * (verifyKeyPairCredential).
 *
 * Nothing here logs or returns the decoded values except as the pair: a
 * caller that refuses one names the header, never what it held.
 */
export type BasicCredential =
  | { kind: 'none' }
  /** A Basic header that isn't `base64(key:token)` with both parts. */
  | { kind: 'unreadable' }
  | { kind: 'pair'; accessKey: string; token: string };

const BASIC = /^Basic\s+(\S+)\s*$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The key pair in an `Authorization` header, if it is a Basic one. */
export function readBasicCredential(authorization: unknown): BasicCredential {
  if (typeof authorization !== 'string') return { kind: 'none' };
  if (!/^Basic(\s|$)/i.test(authorization)) return { kind: 'none' };
  const match = BASIC.exec(authorization);
  if (!match) return { kind: 'unreadable' };
  const encoded = match[1];
  // Strict: Buffer.from skips characters that aren't base64 and decodes the
  // rest, so a mangled header would otherwise read as some other pair.
  if (!BASE64.test(encoded) || encoded.length % 4 !== 0) return { kind: 'unreadable' };
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon <= 0 || colon === decoded.length - 1) return { kind: 'unreadable' };
  return { kind: 'pair', accessKey: decoded.slice(0, colon), token: decoded.slice(colon + 1) };
}

/**
 * A session create's Basic credential that can't be read or doesn't verify.
 * The create is refused with `401` (the session gateway's create layer): a
 * client that put a key and token in its hub URL meant them to be used, and
 * a session started without them would run unattributed and hide the typo.
 * A wrong `xe:options` pair is ignored instead, as it always was.
 */
export class BasicCredentialRefused extends Error {
  readonly status = 401;
  constructor(readonly reason: 'unreadable' | 'invalid') {
    super(
      reason === 'unreadable'
        ? "The hub URL's credentials can't be read: give it as http://ACCESS_KEY:TOKEN@host:port/..."
        : "The access key and token in the hub URL aren't valid, or their user isn't active.",
    );
    this.name = 'BasicCredentialRefused';
  }
}
