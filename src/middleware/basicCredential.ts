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
  | { kind: 'pair'; accessKey: string; token: string }
  /** The user SESSION_TOKEN_BASIC_USER: the password is a `xenon-session` token. */
  | { kind: 'session-token'; token: string };

/**
 * The Basic user that says the password is a `xenon-session` token (the
 * `xe:options.sessionToken` capability), not an access key's token. It is
 * what xenon_session_capabilities puts in the `remoteServerUrl` it gives an
 * agent when per-command auth is on: appium-mcp sends no headers after the
 * create, only the URL's user info, so the session token rides there. No
 * access key is spelled this way (they are generated), so the two can't be
 * confused.
 */
export const SESSION_TOKEN_BASIC_USER = 'xenon-session';

const BASIC = /^Basic\s+(\S+)\s*$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The key pair, or session token, in an `Authorization` header, if it is a Basic one. */
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
  const user = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  if (user === SESSION_TOKEN_BASIC_USER) return { kind: 'session-token', token: password };
  return { kind: 'pair', accessKey: user, token: password };
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
  constructor(readonly reason: 'unreadable' | 'invalid' | 'invalid-session-token') {
    super(
      reason === 'unreadable'
        ? "The hub URL's credentials can't be read: give it as http://ACCESS_KEY:TOKEN@host:port/..."
        : reason === 'invalid'
          ? "The access key and token in the hub URL aren't valid, or their user isn't active."
          : "The session token in the hub URL isn't valid or has expired, or its user isn't " +
            'active. Get a new one from xenon_session_capabilities.',
    );
    this.name = 'BasicCredentialRefused';
  }
}
