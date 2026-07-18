/// <reference path="../../types/express.d.ts" />
import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../../services/ApiKeyService';
import { UserService } from '../../services/UserService';
import { UserSessionService } from '../../services/UserSessionService';
import { PasswordResetService } from '../../services/PasswordResetService';
import { EmailService } from '../../services/EmailService';
import {
  LoginRateLimiter,
  loginRateLimitMiddleware,
  ipHashOf,
} from '../../middleware/loginRateLimiter';
import { config } from '../../config';
import { prisma } from '../../prisma';
import { JwtKeyService } from '../../services/token/JwtKeyService';
import { resolveMcpGrant, McpScopeError } from '../../services/token/mcpScopes';

const SESSION_COOKIE = 'xenon_dashboard_session';
const isSecureFromReq = (req: any) =>
  req.secure || (req.headers['x-forwarded-proto'] as string | undefined) === 'https';

const MCP_TTL_SEC = Number(process.env.XENON_MCP_TOKEN_TTL_SEC || 86400);
const REST_TTL_SEC = 3600;
const MINTABLE_AUDIENCES = ['xenon-rest', 'xenon-mcp'] as const;

export async function issueToken(
  auth: { userId: string; role: string; scopes: string; teamId?: string | null },
  body: { audience?: string; scopes?: string[] },
): Promise<{
  token: string;
  expiresIn: number;
  audience: string;
  scopes?: string[];
  sessionToken?: string;
}> {
  const audience = body.audience ?? 'xenon-rest';
  if (!MINTABLE_AUDIENCES.includes(audience as any)) {
    throw new Error(`unsupported audience: ${audience}`);
  }
  const expiresIn = audience === 'xenon-mcp' ? MCP_TTL_SEC : REST_TTL_SEC;
  const svc = Container.get(JwtKeyService);

  if (audience === 'xenon-mcp') {
    // Validate the untrusted `scopes` body field before it reaches the mapper:
    // a non-array truthy value (e.g. `"appium:use"`) would otherwise throw a
    // raw TypeError inside resolveMcpGrant, leaking an internal message as the
    // 400 detail. A typed McpScopeError gives a clean 400 instead.
    if (body.scopes !== undefined && !Array.isArray(body.scopes)) {
      throw new McpScopeError('unknown_scope', 'scopes must be an array of scope strings');
    }
    // Granular MCP claims (spec §4.2): `scope` (space-joined, the gateway's
    // scopeClaim) + `roles` for the gateway's admin bypass, and a DOWN-MAPPED
    // flat `scopes` claim so this token's REST power matches its MCP grant
    // (least privilege — an mcp token no longer carries the key's full flat set).
    const grant = resolveMcpGrant(auth.scopes, body.scopes);
    const token = await svc.sign(
      {
        sub: auth.userId,
        role: auth.role,
        scopes: grant.flat.join(','),
        teamId: auth.teamId ?? null,
        scope: grant.granular.join(' '),
        roles: grant.roles,
      },
      { audience, ttlSeconds: expiresIn },
    );
    // Session-token capability (spec §3 item 6 / R9): a sibling credential the
    // client injects as `xenon:options.sessionToken` so the Appium createSession
    // interceptor can refuse tokenless direct-connect sessions when the gate is on.
    const sessionToken = await svc.sign(
      { sub: auth.userId, teamId: auth.teamId ?? null },
      { audience: 'xenon-session', ttlSeconds: expiresIn },
    );
    return { token, expiresIn, audience, scopes: grant.granular, sessionToken };
  }

  const token = await svc.sign(
    { sub: auth.userId, role: auth.role, scopes: auth.scopes, teamId: auth.teamId ?? null },
    { audience, ttlSeconds: expiresIn },
  );
  return { token, expiresIn, audience };
}

// Public — anonymous-callable. Mounted before authMiddleware.
export function authPublicRouter(): Router {
  const r = Router();
  const userSvc = Container.get(UserService);
  const sessionSvc = Container.get(UserSessionService);
  const limiter = new LoginRateLimiter();
  const resetLimiter = new LoginRateLimiter({
    attempts: (config as any).resetRateLimitAttempts ?? 3,
    windowMs: (config as any).resetRateLimitWindowMs ?? 15 * 60 * 1000,
  });

  r.post('/login', loginRateLimitMiddleware(limiter), async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = await userSvc.findByEmail(email);
    // Always run bcrypt to keep timing constant whether or not the user exists.
    const ok = await userSvc.verifyPassword(
      password,
      user?.passwordHash ?? '$2b$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid',
    );
    if (!user || user.status !== 'ACTIVE' || !ok) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const ipKey = (req as any).loginRateLimitKey ?? ipHashOf(req as any);
    limiter.clearOnSuccess(ipKey);

    const session = await sessionSvc.create(user.id, {
      userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 200),
      ipHash: ipKey,
    });
    await userSvc.setLastLoginAt(user.id);

    res.cookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      secure: isSecureFromReq(req),
      sameSite: 'strict',
      maxAge: config.userSessionTtlMs,
    });
    return res.status(204).end();
  });

  r.post('/logout', async (req, res) => {
    const cookie = (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(`${SESSION_COOKIE}=`.length);
    if (cookie) await sessionSvc.revoke(cookie);
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict' });
    return res.status(204).end();
  });

  r.post('/forgot-password', loginRateLimitMiddleware(resetLimiter), async (req, res) => {
    const { email } = req.body as { email?: string };
    // Always 204 — no enumeration. Run the work in the background.
    res.status(204).end();
    if (!email) return;

    // Constant 50ms delay regardless of branch, to keep timing flat.
    const t0 = Date.now();
    try {
      const user = await userSvc.findByEmail(email);
      if (user && user.status === 'ACTIVE') {
        const resetSvc = Container.get(PasswordResetService);
        const emailSvc = Container.get(EmailService);
        const { raw } = await resetSvc.createToken(user.id);
        const proto =
          req.secure || (req.headers['x-forwarded-proto'] as string) === 'https' ? 'https' : 'http';
        const host = req.headers.host || 'localhost';
        const link = `${proto}://${host}/xenon/reset-password/${raw}`;
        await emailSvc.send({
          to: user.email,
          subject: 'Reset your Xenon password',
          text:
            `Hi ${user.name},\n\n` +
            `Someone requested a password reset for your Xenon account. ` +
            `If that was you, click the link below to choose a new password:\n\n` +
            `${link}\n\n` +
            `This link expires in 1 hour. If you did not request this, ignore this email — no action is needed.\n`,
        });
      }
    } catch (e) {
      // Swallow — anti-enumeration. The operator log catches the cause.
    }
    const elapsed = Date.now() - t0;
    if (elapsed < 50) await new Promise((res2) => setTimeout(res2, 50 - elapsed));
  });

  r.get('/jwks.json', (_req, res) => {
    res.json(Container.get(JwtKeyService).jwks());
  });

  r.get('/reset-password/check/:token', async (req, res) => {
    const resetSvc = Container.get(PasswordResetService);
    const row = await resetSvc.verifyToken(req.params.token);
    if (!row) return res.status(404).json({ error: 'invalid or expired token' });
    return res.json({ ok: true });
  });

  r.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body as { token?: string; newPassword?: string };
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'token and newPassword required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const resetSvc = Container.get(PasswordResetService);
    const row = await resetSvc.verifyToken(token);
    if (!row) return res.status(404).json({ error: 'invalid or expired token' });

    const passwordHash = await userSvc.hashPassword(newPassword);
    // Update password + consume token + revoke all sessions.
    await prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
    await resetSvc.consume(row.id);
    await sessionSvc.revokeAllForUser(row.userId);

    return res.status(204).end();
  });

  return r;
}

// Authenticated — mounted after authMiddleware.
export function authAuthedRouter(): Router {
  const r = Router();
  const apiKeySvc = Container.get(ApiKeyService);
  const userSvc = Container.get(UserService);
  const sessionSvc = Container.get(UserSessionService);

  r.post('/change-password', async (req, res) => {
    const auth = (req as any).auth as { userId: string; sessionId?: string } | undefined;
    if (!auth) return res.status(401).json({ error: 'unauthenticated' });
    const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
    if (!oldPassword || !newPassword)
      return res.status(400).json({ error: 'oldPassword and newPassword required' });
    if (newPassword.length < 8)
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    try {
      await userSvc.changePassword(auth.userId, oldPassword, newPassword);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    if (auth.sessionId) await sessionSvc.revokeAllForUserExcept(auth.userId, auth.sessionId);
    return res.status(204).end();
  });

  r.get('/me', async (req, res) => {
    const auth = (req as any).auth as
      | {
          userId: string;
          scopes: string;
          role?: string;
          teamId?: string | null;
          teamIds?: string[];
          kind: string;
        }
      | undefined;
    if (!auth) return res.status(401).json({ error: 'unauthenticated' });

    // authDisabled fabricates a synthetic SUPER_ADMIN (authMiddleware.ts) whose
    // userId has no User row. Resolving it would 401 and strand the dashboard on
    // /login — on a server that has auth switched off. Answer from the synthetic
    // identity instead of the database.
    if (config.authDisabled === true) {
      return res.json({
        userId: auth.userId,
        email: 'auth-disabled@xenon.local',
        name: 'Auth Disabled',
        role: auth.role ?? 'SUPER_ADMIN',
        accessKey: null,
        scopes: auth.scopes,
        teamId: auth.teamId ?? null,
        kind: auth.kind,
        teams: [],
      });
    }

    const user = await userSvc.findById(auth.userId);
    if (!user) return res.status(401).json({ error: 'unauthenticated' });

    // Phase 4A: include the caller's teams so the dashboard can render
    // "Your Teams" on /profile. Admins (teamIds undefined) get an empty
    // array — they're unscoped, so a "your teams" listing isn't meaningful.
    let teams: { id: string; name: string }[] = [];
    if (auth.teamIds && auth.teamIds.length > 0) {
      const rows = await prisma.team.findMany({
        where: { id: { in: auth.teamIds } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      teams = rows;
    }

    return res.json({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      accessKey: user.accessKey,
      scopes: auth.scopes,
      teamId: auth.teamId ?? null,
      kind: auth.kind,
      teams,
    });
  });

  r.post('/token', async (req, res) => {
    try {
      const out = await issueToken(req.auth!, req.body ?? {});
      res.json(out);
    } catch (err: any) {
      if (err instanceof McpScopeError) {
        const status = err.code === 'scope_exceeds_key' ? 403 : 400;
        return res.status(status).json({ error: err.code, details: err.message });
      }
      res.status(400).json({ error: 'bad_request', details: err.message });
    }
  });

  r.post('/dashboard-session', async (req, res) => {
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey) return res.status(400).json({ error: 'apiKey required' });
    const row = await apiKeySvc.verify(apiKey);
    if (!row || !row.userId) return res.status(401).json({ error: 'invalid key' });
    const owner = await userSvc.findById(row.userId);
    if (!owner || owner.role !== 'SUPER_ADMIN') {
      return res
        .status(403)
        .json({ error: 'super-admin scope required for dashboard-session exchange' });
    }
    res.cookie(SESSION_COOKIE, apiKey, {
      httpOnly: true,
      secure: isSecureFromReq(req),
      sameSite: 'strict',
      maxAge: config.userSessionTtlMs,
    });
    res.json({ ok: true, scopes: row.scopes });
  });

  return r;
}

// Back-compat: existing import sites still call `authRouter()`. Keep it as an
// authed-router alias for now; Task 12-style migrations will move call sites.
export function authRouter(): Router {
  return authAuthedRouter();
}
