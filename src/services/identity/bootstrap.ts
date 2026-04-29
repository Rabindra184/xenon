import { Container } from 'typedi';
import { prisma } from '../../prisma';
import { UserService } from '../UserService';
import { ApiKeyService } from '../ApiKeyService';
import { config } from '../../config';
import log from '../../logger';

const LEGACY_EMAIL = 'legacy-admin@xenon.local';

export async function bootstrapIdentity() {
  const userSvc = Container.get(UserService);
  const apiKeySvc = Container.get(ApiKeyService);
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

  // 2) Create the bootstrap super-admin.
  const superAdmin = await userSvc.createUser({
    email: config.bootstrapAdminEmail,
    name: 'Bootstrap Super Admin',
    password: config.bootstrapAdminPassword,
    role: 'SUPER_ADMIN',
  });
  l.warn(`Bootstrap super-admin "${config.bootstrapAdminEmail}" created. Sign in and rotate the password.`);

  // 3) If ApiKey rows already exist (legacy install), create Legacy Admin and
  //    backfill all existing keys to it. Then re-tag any 'bootstrap'-named key
  //    to the real super-admin we just created.
  const apiKeyCount = await prisma.apiKey.count();
  if (apiKeyCount > 0) {
    const legacy = await userSvc.createUser({
      email: LEGACY_EMAIL,
      name: 'Legacy Admin',
      password: 'unset-' + Math.random().toString(36).slice(2), // hash exists; status INACTIVE prevents login
      role: 'SUPER_ADMIN',
      status: 'INACTIVE',
    });
    // Defensive: post-Task-16 the schema makes userId NOT NULL, but if a
    // partial upgrade leaves legacy rows with NULL we still want to backfill
    // them on the next boot. Prisma's typed `where` no longer allows
    // { userId: null }, so use a raw UPDATE for this safety net.
    await prisma.$executeRaw`UPDATE "ApiKey" SET "userId" = ${legacy.id} WHERE "userId" IS NULL`;
    await prisma.apiKey.updateMany({
      where: { name: 'bootstrap' },
      data: { userId: superAdmin.id },
    });
    l.warn(`Backfilled existing API keys to Legacy Admin (${legacy.id}). Reassign via Phase 2 user-management UI.`);
  } else {
    // 4) Fresh DB: write a bootstrap key owned by the super-admin.
    await apiKeySvc.bootstrapIfEmpty(config.bootstrapKeyPath, superAdmin.id);
  }
}
