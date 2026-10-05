import 'reflect-metadata';
import { expect } from 'chai';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { PrismaClient } from '../../src/generated/client';
import { UserService } from '../../src/services/UserService';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'prisma', 'migrations');
/** The migration that backfills TeamMember from ApiKey.teamId. */
const BACKFILL = '20260430001747_phase_3_team_members';

/**
 * `prisma migrate deploy` into `url` of the repository's migrations that
 * `include` names, from a copy of the schema in `dir`. Run again with more
 * of them, it applies only the ones not yet applied.
 */
function deploy(dir: string, url: string, include: (name: string) => boolean) {
  const target = path.join(dir, 'migrations');
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(
    path.join(MIGRATIONS, 'migration_lock.toml'),
    path.join(target, 'migration_lock.toml'),
  );
  for (const name of fs.readdirSync(MIGRATIONS)) {
    const sql = path.join(MIGRATIONS, name, 'migration.sql');
    if (!include(name) || !fs.existsSync(sql)) continue;
    fs.mkdirSync(path.join(target, name), { recursive: true });
    fs.copyFileSync(sql, path.join(target, name, 'migration.sql'));
  }
  fs.copyFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), path.join(dir, 'schema.prisma'));
  execSync(`npx prisma migrate deploy --schema "${path.join(dir, 'schema.prisma')}"`, {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

describe('team-membership migration backfill (integration)', function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });

  // Through 2.14 this read the developer's own database, and returned early
  // unless an old Legacy Admin happened to be in it. It runs the migration
  // itself now, on a database migrated up to it and seeded as such a lab was.
  it('backfills TeamMember from team keys, and gives Legacy Admin no membership', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-team-backfill-'));
    const url = `file:${path.join(dir, 'xenon.db')}`;
    try {
      deploy(dir, url, (name) => name < BACKFILL);
      const before = new PrismaClient({ datasources: { db: { url } } });
      try {
        await before.$executeRawUnsafe(
          'INSERT INTO "Team" ("id", "name") VALUES (?, ?)',
          'team-1',
          'Team 1',
        );
        for (const [id, email] of [
          ['legacy', 'legacy-admin@xenon.local'],
          ['alice', 'alice@xenon.local'],
        ]) {
          await before.$executeRawUnsafe(
            `INSERT INTO "User" ("id", "email", "name", "passwordHash", "accessKey", "updatedAt")
             VALUES (?, ?, ?, 'x', ?, CURRENT_TIMESTAMP)`,
            id,
            email,
            id,
            `ak-${id}`,
          );
          await before.$executeRawUnsafe(
            `INSERT INTO "ApiKey" ("id", "name", "keyHash", "scopes", "teamId", "userId")
             VALUES (?, ?, ?, 'devices', 'team-1', ?)`,
            `key-${id}`,
            id,
            `hash-${id}`,
            id,
          );
        }
      } finally {
        await before.$disconnect();
      }

      deploy(dir, url, () => true);
      const after = new PrismaClient({ datasources: { db: { url } } });
      try {
        const members = await after.teamMember.findMany({ select: { teamId: true, userId: true } });
        expect(members).to.deep.equal([{ teamId: 'team-1', userId: 'alice' }]);
      } finally {
        await after.$disconnect();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('addMember / removeMember round-trip an arbitrary user', async () => {
    const u = await Container.get(UserService).createUser({
      email: `tm-rt-${Date.now()}@xenon.local`,
      name: 'TM Round Trip',
      password: 'tm-rt-pass-1',
      role: 'MEMBER',
    });
    const t = await Container.get(TeamService).create(`tm-rt-${Date.now()}`);
    try {
      await Container.get(TeamService).addMember(t.id, u.id);
      const members = await Container.get(TeamService).listMembers(t.id);
      expect(members.find((m) => m.userId === u.id)).to.exist;
      await Container.get(TeamService).removeMember(t.id, u.id);
      const after = await Container.get(TeamService).listMembers(t.id);
      expect(after.find((m) => m.userId === u.id)).to.not.exist;
    } finally {
      await prisma.teamMember.deleteMany({ where: { userId: u.id } });
      await prisma.team.delete({ where: { id: t.id } }).catch(() => undefined);
      await prisma.userSession.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});
