import { z } from 'zod';
import { prisma } from '../../prisma';
import { defineTool, mcpScopesOf } from '../tool';
import { effectiveRole } from '../../middleware/callerRole';

/**
 * `xenon_lab_info`: the hub's version and what `/capabilities` reports, who
 * the caller is, their teams and the MCP scopes they hold. Any signed-in
 * caller.
 *
 * `role` is the user's; `actsAs` is what Xenon judges this caller as, which
 * for an agent's browser sign-in is MEMBER whatever the role.
 *
 * `teams` are the teams the caller's devices come from, as `/auth/me` gives
 * them; an admin sees every team's phones, so theirs is empty and
 * `seesEveryTeam` is true.
 */
export const labInfoTool = defineTool({
  name: 'xenon_lab_info',
  scope: null,
  description:
    "What this Xenon lab is and who you are in it: the hub's version and features, " +
    'your user id, your role, the role you act as here, your teams and the scopes your sign-in grants.',
  params: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false },
  async run(_args, caller) {
    // Loaded here, not at the top: `/capabilities` lists the tools, so a
    // static import would make this module and the tool list load each other.
    const { buildCapabilities } = await import('../../app/routers/capabilities');
    const { auth } = caller;
    const teamIds = auth.teamIds;
    const teams =
      teamIds && teamIds.length > 0
        ? await prisma.team.findMany({
            where: { id: { in: teamIds } },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          })
        : [];
    return {
      ...buildCapabilities(),
      userId: auth.userId,
      role: auth.role,
      // What Xenon judges the caller as: MEMBER for an agent's browser sign-in
      // whatever its user's role (effectiveRole).
      actsAs: effectiveRole(auth) ?? null,
      teams,
      seesEveryTeam: teamIds === undefined,
      scopes: mcpScopesOf(caller),
    };
  },
});
