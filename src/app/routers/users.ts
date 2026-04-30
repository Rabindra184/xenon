/// <reference path="../../types/express.d.ts" />
import { Router } from 'express';
import { Container } from 'typedi';
import crypto from 'crypto';
import { UserService } from '../../services/UserService';
import { roleGuard } from '../../middleware/roleGuard';
import {
  canActOn,
  assertNotSelf,
  assertNotLastSuperAdmin,
} from '../../services/identity/userAuthorization';
import { prisma } from '../../prisma';
import type { UserRole } from '../../types/identity';

function isUserRole(v: unknown): v is UserRole {
  return v === 'SUPER_ADMIN' || v === 'ADMIN' || v === 'MEMBER';
}

function makeTempPassword(): string {
  // 9 random bytes -> 12 base64url chars; URL-safe, no special characters.
  return crypto.randomBytes(9).toString('base64url');
}

export function usersRouter(): Router {
  const r = Router();
  r.use(roleGuard('ADMIN'));
  const userSvc = Container.get(UserService);

  function getAuth(req: any) {
    return req.auth as { userId: string; role: UserRole };
  }

  r.get('/', async (req, res) => {
    const auth = getAuth(req);
    const users = await userSvc.listUsers(auth.role);
    res.json(users);
  });

  r.post('/', async (req, res) => {
    const auth = getAuth(req);
    const { email, name, role, password } = req.body as {
      email?: string;
      name?: string;
      role?: string;
      password?: string;
    };
    if (!email || !name || !role) {
      return res.status(400).json({ error: 'email, name, role required' });
    }
    if (!isUserRole(role)) {
      return res.status(400).json({ error: 'role must be SUPER_ADMIN | ADMIN | MEMBER' });
    }
    if (!canActOn(auth.role, role)) {
      return res.status(403).json({ error: `cannot create user with role ${role}` });
    }
    const tempPw = password ?? makeTempPassword();
    if (tempPw.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    const created = await userSvc.createUser({ email, name, role, password: tempPw });
    return res.status(201).json({
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
      status: created.status,
      accessKey: created.accessKey,
      // Only echo the temp password back when the server generated it; if the
      // caller passed an explicit password, they already have it.
      temporaryPassword: password ? undefined : tempPw,
    });
  });

  r.patch('/:id', async (req, res) => {
    const auth = getAuth(req);
    const targetId = req.params.id;

    const { name, role, status } = req.body as {
      name?: string;
      role?: string;
      status?: string;
    };

    // Self role-change check happens first (matches test expectation that
    // self role-change is rejected before any DB lookup).
    if (role !== undefined) {
      try {
        assertNotSelf(auth.userId, targetId, 'role-change');
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (!canActOn(auth.role, target.role as UserRole)) {
      return res.status(403).json({ error: 'insufficient permissions for this target' });
    }

    if (role !== undefined) {
      if (!isUserRole(role)) {
        return res.status(400).json({ error: 'role must be SUPER_ADMIN | ADMIN | MEMBER' });
      }
      if (!canActOn(auth.role, role)) {
        return res.status(403).json({ error: `cannot promote to role ${role}` });
      }
      // If demoting away from SUPER_ADMIN, ensure target wasn't the last one.
      if (target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
        try {
          await assertNotLastSuperAdmin(targetId);
        } catch (e: any) {
          return res.status(400).json({ error: e.message });
        }
      }
    }

    if (status === 'INACTIVE' && target.role === 'SUPER_ADMIN') {
      try {
        await assertNotLastSuperAdmin(targetId);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }

    const updated = await userSvc.updateUser(targetId, {
      name,
      role: role as UserRole | undefined,
      status: status as 'ACTIVE' | 'INACTIVE' | undefined,
    });
    if (status === 'INACTIVE') {
      // updateUser sets status; we additionally revoke sessions.
      await prisma.userSession.deleteMany({ where: { userId: targetId } });
    }
    res.json({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      status: updated.status,
    });
  });

  r.delete('/:id', async (req, res) => {
    const auth = getAuth(req);
    const targetId = req.params.id;
    try {
      assertNotSelf(auth.userId, targetId, 'delete');
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (!canActOn(auth.role, target.role as UserRole)) {
      return res.status(403).json({ error: 'insufficient permissions for this target' });
    }
    if (target.role === 'SUPER_ADMIN') {
      try {
        await assertNotLastSuperAdmin(targetId);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }
    await userSvc.deleteUser(targetId);
    res.status(204).end();
  });

  return r;
}
