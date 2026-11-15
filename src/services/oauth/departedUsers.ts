import { Container } from 'typedi';
import log from '../../logger';
import { prisma } from '../../prisma';
import { onIdentityChanged } from '../identity/identityChanges';
import { UserService } from '../UserService';
import { GrantStore } from './grantStore';

const logger = log.scope('OAuthGrants');

/**
 * What a user leaving (made Inactive, or deleted) ends of their agents:
 *
 * - every sign-in grant of theirs is revoked (GrantStore.revokeAllOf, each
 *   through `revoke`), so its tokens stop at once and its leases end
 *   (`grant_revoked`);
 * - the agents' leases taken under no grant (a key pair on /xenon/mcp:
 *   heartbeat-free, no `grantId`) end too (`user_not_active`). Their
 *   `actorId` is the creating key's id or the user's id; for a deleted user
 *   the keys are gone with them, so a lease whose creator is now neither a
 *   user nor a key ends then too (LeaseService.endAgentLeasesOf `orphans`).
 *
 * Their credentials are refused without this (REST checks the user on every
 * request): it is the grants and leases that would otherwise stay, holding
 * phones until their own end.
 *
 * Called for every identity change (identityChanged): a user who is still
 * ACTIVE (a role, team or key change, a sign-out) keeps everything.
 */
export async function endAgentsOfDepartedUser(userId: string): Promise<void> {
  const user = await Container.get(UserService).findById(userId);
  if (user && user.status === 'ACTIVE') return;
  const revoked = await Container.get(GrantStore).revokeAllOf(userId, 'user_not_active');
  const keys = user
    ? await prisma.apiKey.findMany({ where: { userId }, select: { id: true } })
    : [];
  // Loaded here, not imported: LeaseService imports most of the server.
  const { LeaseService } = await import('../lease/LeaseService');
  const ended = await Container.get(LeaseService).endAgentLeasesOf(
    [userId, ...keys.map((k: { id: string }) => k.id)],
    'user_not_active',
    { orphans: !user },
  );
  if (revoked > 0 || ended > 0) {
    logger.info(
      `user ${userId} is ${user ? 'not active' : 'deleted'}: revoked ${revoked} agent sign-in(s), ended ${ended} agent lease(s) without one`,
    );
  }
}

/**
 * Listen for users leaving (endAgentsOfDepartedUser), from where the server
 * starts its socket server (ServerManager). Returns the function that stops
 * listening.
 */
export function watchDepartedUsers(): () => void {
  return onIdentityChanged(endAgentsOfDepartedUser);
}
