import { Container } from 'typedi';
import { prisma } from '../../prisma';
import { UserService } from '../UserService';
import { config } from '../../config';
import log from '../../logger';

export async function bootstrapIdentity() {
  const userSvc = Container.get(UserService);
  const l = log.scope('Identity-Bootstrap');

  // 1) Reset super-admin password (env-driven; works on any populated DB).
  if (config.bootstrapResetPassword) {
    const sa = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (sa) {
      const passwordHash = await userSvc.hashPassword(config.bootstrapAdminPassword);
      await prisma.user.update({
        where: { id: sa.id },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await prisma.userSession.deleteMany({ where: { userId: sa.id } });
      l.warn(`Bootstrap super-admin password reset via XENON_BOOTSTRAP_RESET_PASSWORD.`);
    }
  }

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return; // already bootstrapped
  }

  // 2) Create the bootstrap super-admin. Sign in via /api/auth/login with
  //    XENON_BOOTSTRAP_ADMIN_EMAIL / XENON_BOOTSTRAP_ADMIN_PASSWORD, then
  //    rotate the password via the dashboard.
  await userSvc.createUser({
    email: config.bootstrapAdminEmail,
    name: 'Bootstrap Super Admin',
    password: config.bootstrapAdminPassword,
    role: 'SUPER_ADMIN',
  });
  l.warn(`Bootstrap super-admin "${config.bootstrapAdminEmail}" created. Sign in and rotate the password.`);
}
