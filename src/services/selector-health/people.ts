import { prisma } from '../../prisma';

/** Who did something. `name` is null for a deleted user, or with auth disabled. */
export interface Person {
  id: string;
  name: string | null;
}

/** The people behind these user ids, by id. */
export async function peopleById(
  ids: Array<string | null | undefined>,
): Promise<Map<string, Person>> {
  const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
  if (wanted.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return new Map(wanted.map((id) => [id, { id, name: names.get(id) ?? null }]));
}
