import { z } from 'zod';
import { prisma } from '../../prisma';
import { buildCapabilities } from '../../app/routers/capabilities';
import { defineTool, mcpScopesOf } from '../toolRegistry';

/**
 * `xenon_lab_info`: the hub's version and what `/capabilities` reports, who
 * the caller is, their teams and the MCP scopes they hold. Any signed-in
 * caller.
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
    'your user id, role, teams and the scopes your sign-in grants.',
  params: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false },
  async run(_args, caller) {
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
      teams,
      seesEveryTeam: teamIds === undefined,
      scopes: mcpScopesOf(caller),
    };
  },
});
