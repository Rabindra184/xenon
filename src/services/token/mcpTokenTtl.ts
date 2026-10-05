import log from '../../logger';

export const DEFAULT_MCP_TOKEN_TTL_SEC = 86400;

/**
 * The lifetime of the xenon-mcp tokens and session tokens POST /auth/token
 * mints, in seconds: XENON_MCP_TOKEN_TTL_SEC, a whole number above 0, else a
 * day. Through 2.15 any other value (`abc`) gave every such token a NaN
 * lifetime; it now warns and keeps the default.
 */
export function mcpTokenTtlSec(
  raw: string | undefined = process.env.XENON_MCP_TOKEN_TTL_SEC,
  warn: (message: string) => void = (message) => log.warn(message),
): number {
  const text = raw?.trim() ?? '';
  if (text === '') return DEFAULT_MCP_TOKEN_TTL_SEC;
  const seconds = /^\d+$/.test(text) ? Number(text) : NaN;
  if (Number.isSafeInteger(seconds) && seconds > 0) return seconds;
  warn(
    `XENON_MCP_TOKEN_TTL_SEC is "${raw}", not a whole number of seconds above 0. ` +
      `The tokens it sets the lifetime of last ${DEFAULT_MCP_TOKEN_TTL_SEC} s, the default.`,
  );
  return DEFAULT_MCP_TOKEN_TTL_SEC;
}
