import crypto from 'crypto';
import log from '../logger';

// Outcome tells the caller not just pass/fail but *which* secret matched, so
// it can log or surface a warning when a client is still on the old secret
// during a rotation window. That signal is what lets operators know the
// rollout is done and they can drop XENON_NODE_SECRET_PREVIOUS.
export type NodeSecretCheck = 'current' | 'previous' | 'reject';

interface NodeSecretPair {
  current?: string;
  previous?: string;
}

function timingSafeEqStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

let lastPreviousWarnAt = 0;

// Single source of truth for validating an inbound node secret. Returns
// 'reject' when no expected secret is configured — callers decide whether
// that should 401 or fall through. Timing-safe compare so the hub can't be
// probed by measuring response time differences.
export function validateNodeSecret(given: string, expected: NodeSecretPair): NodeSecretCheck {
  if (!given) return 'reject';
  if (expected.current && timingSafeEqStr(given, expected.current)) return 'current';
  if (expected.previous && timingSafeEqStr(given, expected.previous)) {
    const now = Date.now();
    if (now - lastPreviousWarnAt > 60_000) {
      log.warn(
        '[nodeSecret] A caller authenticated with XENON_NODE_SECRET_PREVIOUS. Rotate the remaining callers to the new secret and drop PREVIOUS.',
      );
      lastPreviousWarnAt = now;
    }
    return 'previous';
  }
  return 'reject';
}
