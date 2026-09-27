import { prisma } from '../../prisma';

// Compute the request-scoped team-id set. Returns undefined for admin-tier
// callers (unscoped). For member-tier callers without a narrowing apiKey,
// fetches TeamMember rows. For member-tier callers with a team-narrowed
// apiKey, returns just [apiKey.teamId] (the token's narrow always wins).
//
// authMiddleware uses it for every REST request, and createSession for a
// session that names a lease, so a phone a caller could lease is one their
// session can then use.
export async function computeTeamIds(opts: {
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
  userId: string;
  apiKeyTeamId?: string | null;
}): Promise<string[] | undefined> {
  if (opts.role === 'SUPER_ADMIN' || opts.role === 'ADMIN') return undefined;
  if (opts.apiKeyTeamId) return [opts.apiKeyTeamId];
  const rows = await prisma.teamMember.findMany({
    where: { userId: opts.userId },
    select: { teamId: true },
  });
  return rows.map((r: { teamId: string }) => r.teamId);
}
