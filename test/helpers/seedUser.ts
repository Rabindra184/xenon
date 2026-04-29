import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { prisma } from '../../src/prisma';
import type { UserRole } from '../../src/types/identity';

const TEST_EMAIL_DOMAIN = '@xenon.local';

export interface SeededUser {
  user: { id: string; email: string; name: string; role: UserRole; accessKey: string };
  cookie: string;
  cleanup: () => Promise<void>;
}

let counter = 0;

export async function seedUser(role: UserRole, opts?: { name?: string }): Promise<SeededUser> {
  counter += 1;
  const email = `role-${role.toLowerCase()}-${Date.now()}-${counter}${TEST_EMAIL_DOMAIN}`;
  await prisma.userSession.deleteMany({ where: { user: { email } } });
  await prisma.user.deleteMany({ where: { email } });
  const u = await Container.get(UserService).createUser({
    email,
    name: opts?.name ?? `Test ${role}`,
    password: 'role-test-12',
    role,
  });
  const session = await Container.get(UserSessionService).create(u.id);
  const cookie = `xenon_dashboard_session=${session.id}`;
  return {
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role as UserRole,
      accessKey: u.accessKey,
    },
    cookie,
    cleanup: async () => {
      await prisma.apiKey.deleteMany({ where: { userId: u.id } });
      await prisma.userSession.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    },
  };
}
