import { prisma } from '../../prisma';

const LEGACY_NODE_EMAIL = 'legacy-node@xenon.local';
// Bcrypt-shaped string that won't match any password (cost 04 prefix + the
// rest is intentionally not a real hash). Mirrors Phase 1's Legacy Admin row.
const UNUSABLE_HASH =
  '$2b$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid';

let cachedId: string | undefined;

// For tests only — drops the module-scope cache between cases.
export function resetLegacyNodeUserCache(): void {
  cachedId = undefined;
}

// Ensures the synthetic "Legacy Node" user row exists and returns its id.
// Lazily created on first request that authenticates via the legacy
// x-xenon-node-secret header (Phase 4B). Marked INACTIVE so /login can
// never succeed for it; passwordHash is unusable so even if status flips
// to ACTIVE, bcrypt-compare fails. Concurrent-create race (P2002) handled
// by re-fetching.
export async function ensureLegacyNodeUser(): Promise<{ id: string }> {
  if (cachedId) return { id: cachedId };

  const existing = await prisma.user.findUnique({
    where: { email: LEGACY_NODE_EMAIL },
    select: { id: true },
  });
  if (existing) {
    cachedId = existing.id;
    return { id: existing.id };
  }

  try {
    const created = await prisma.user.create({
      data: {
        email: LEGACY_NODE_EMAIL,
        name: 'Legacy Node Channel',
        passwordHash: UNUSABLE_HASH,
        accessKey: `xen_legacynode${Date.now().toString(36).slice(-8)}`,
        role: 'ADMIN',
        status: 'INACTIVE',
      },
      select: { id: true },
    });
    cachedId = created.id;
    return { id: created.id };
  } catch (e: any) {
    if (e?.code === 'P2002') {
      const row = await prisma.user.findUnique({
        where: { email: LEGACY_NODE_EMAIL },
        select: { id: true },
      });
      if (row) {
        cachedId = row.id;
        return { id: row.id };
      }
    }
    throw e;
  }
}
