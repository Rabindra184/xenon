import { randomBytes, createHash, timingSafeEqual } from 'crypto';

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(cleartext: string): string {
  return createHash('sha256').update(cleartext).digest('hex');
}

export function verifyToken(cleartext: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(cleartext), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, 'hex');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
