import { prisma } from '../../prisma';
import type { UserRole } from '../../types/identity';

// Returns true when the caller's role permits acting on a target with `targetRole`.
// SUPER_ADMIN can act on any role; ADMIN can only act on MEMBER; MEMBER can act on no one.
// (ADMIN cannot act on another ADMIN — explicit choice; matches device-farm-pro matrix.)
export function canActOn(callerRole: UserRole, targetRole: UserRole): boolean {
  if (callerRole === 'MEMBER') return false;
  if (callerRole === 'SUPER_ADMIN') return true;
  // ADMIN: only MEMBER
  return targetRole === 'MEMBER';
}

// Throws when actor and target are the same user. The `verb` shows up in the
// error message: "cannot role-change yourself", "cannot delete yourself", etc.
export function assertNotSelf(actorId: string, targetId: string, verb: string): void {
  if (actorId === targetId) {
    throw new Error(`cannot ${verb} yourself; use a different super-admin to manage your own account`);
  }
}

// Throws when removing/demoting the target would leave zero active SUPER_ADMINs.
// Counts OTHER active SAs (not including target). If target isn't an SA at all,
// caller should still be safe to call this — count comes back >= 0 either way.
export async function assertNotLastSuperAdmin(targetUserId: string): Promise<void> {
  const others = await prisma.user.count({
    where: {
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      NOT: { id: targetUserId },
    },
  });
  if (others < 1) {
    throw new Error(
      'cannot remove or demote the last active super-admin; promote another user first',
    );
  }
}
