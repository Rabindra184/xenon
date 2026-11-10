import { Router, type Request, type Response } from 'express';
import { APP_SERVICE, AppAlreadyInTeam, AppFilter } from '../../dashboard/services/app-service';
import log from '../../logger';
import fs from 'fs-extra';
import { mutationScopeGuard, scopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';
import { canSeeApp } from '../../services/device-access/appVisibility';
import { prisma } from '../../prisma';
import { xenonAppRef } from '../../services/session/appCapability';

const router = Router();

// MEMBER-tier baseline: device app visibility requires authenticated user
router.use(roleGuard('MEMBER'));

// Uploading an APK/IPA or deleting one needs the `apps` scope, or `devices`
// as before 2.27 (ENH-16: a CI key may carry `apps` alone, and control no
// phone). App listings stay readable to any authenticated key.
router.use(mutationScopeGuard(['apps', 'devices']));

// Uploaded apps follow the device team rule on the app's team (canSeeApp):
// admins see every app, members shared apps and their teams'. An app the
// caller can't see answers every route exactly as an unknown id.
const UNKNOWN_APP = { error: 'App not found' } as const;

const MD5 = /^[0-9a-f]{32}$/;

/**
 * An app as the API answers it: its row, plus `appUrl`, the `appium:app`
 * value that names it (`xenon://<id>`, parseXenonAppRef). Every field the row
 * has stays.
 */
function withAppUrl<T extends { id: string }>(app: T): T & { appUrl: string } {
  return { ...app, appUrl: xenonAppRef(app.id) };
}

const PLATFORMS = ['android', 'ios'] as const;

type ListQuery =
  | { ok: true; filter: AppFilter; latest: boolean }
  | { ok: false; error: string; message: string };

/**
 * GET /apps's filters, each optional and all of them applied together:
 * - `md5`: the apps holding those bytes (ENH-16), so CI can ask whether a
 *   build is uploaded without uploading it;
 * - `packageName`: an APK's package or an iOS app's bundle id;
 * - `platform`: `android` or `ios`;
 * - `latest=true`: only the newest that matches, so CI can find the build to
 *   test without knowing its id. Still an array, of one app or none.
 * A query parameter given twice, or with a value that can't be one of
 * these, is refused rather than read as no filter.
 */
function readListQuery(query: Request['query']): ListQuery {
  const one = (name: string): string | undefined | null => {
    const value = query[name];
    if (value === undefined) return undefined;
    return typeof value === 'string' ? value : null;
  };
  const md5 = one('md5');
  const packageName = one('packageName');
  const platform = one('platform');
  const latest = one('latest');
  if (md5 === null || (md5 !== undefined && !MD5.test(md5.toLowerCase()))) {
    return { ok: false, error: 'invalid_md5', message: 'md5 must be 32 hexadecimal characters' };
  }
  if (packageName === null || (packageName !== undefined && !packageName.trim())) {
    return {
      ok: false,
      error: 'invalid_package_name',
      message: 'packageName must be one non-empty value',
    };
  }
  if (platform === null || (platform !== undefined && !PLATFORMS.includes(platform as any))) {
    return { ok: false, error: 'invalid_platform', message: 'platform must be android or ios' };
  }
  if (latest === null || (latest !== undefined && latest !== 'true' && latest !== 'false')) {
    return { ok: false, error: 'invalid_latest', message: 'latest must be true or false' };
  }
  return {
    ok: true,
    filter: {
      ...(md5 ? { md5: md5.toLowerCase() } : {}),
      ...(packageName ? { packageName: packageName.trim() } : {}),
      ...(platform ? { platform: platform as AppFilter['platform'] } : {}),
    },
    latest: latest === 'true',
  };
}

router.get('/', async (req, res) => {
  try {
    const query = readListQuery(req.query);
    if (!query.ok) return res.status(400).json({ error: query.error, message: query.message });
    const apps = await APP_SERVICE.findApps(req.auth?.teamIds, query.filter, {
      latest: query.latest,
    });
    res.json(apps.map(withAppUrl));
  } catch (err: any) {
    log.error(`Failed to get apps: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Options every app download must be sent with.
 *
 * Uploaded apps live under `~/.cache/xenon/apps/`, and `.cache` is a
 * dot-segment. `send` — which backs `res.download` — refuses those unless told
 * otherwise, so without this every download 404s with an HTML error page
 * instead of the file.
 *
 * It only started failing when Appium 3 moved to Express 5. `send` 0.19 read an
 * unspecified `dotfiles` as "legacy", and its legacy branch looked at the LAST
 * path segment alone: `9adc….ipa` is not a dotfile, so the file was served.
 * `send` 1.2.0 dropped that branch, so `dotfiles` now defaults to `ignore` and
 * `containsDotFile` rejects a dot anywhere in the path. Measured against the
 * same 6,579,953-byte .ipa: Express 4.22.1 → 200, Express 5.1.0 → 404, and
 * Express 5.1.0 with this option → 200.
 *
 * `allow` is not a traversal hole: the path comes from the App row Xenon wrote
 * at upload time, never from the request. The id in the URL selects a row; it
 * is not joined onto a path.
 */
export const DOWNLOAD_OPTIONS = { dotfiles: 'allow' } as const;

/**
 * Whether this request may see the app. A download ticket (authMiddleware's
 * app-ticket path) was team-checked when it was minted and is bound to one
 * app, so it sees that app and nothing else; everyone else by the team rule.
 */
function canRequestSeeApp(req: Request, app: { id: string; teamId?: string | null } | null) {
  if (!app) return false;
  if (req.auth?.kind === 'app-ticket') return req.auth.appId === app.id;
  return canSeeApp(app, req.auth?.teamIds);
}

export async function downloadApp(req: Request, res: Response): Promise<void> {
  try {
    const app = await APP_SERVICE.getAppById(req.params.id);
    // The ticket path sends with DOWNLOAD_OPTIONS too: it is this same call.
    if (app && canRequestSeeApp(req, app) && (await fs.exists(app.filepath))) {
      res.download(app.filepath, app.filename, DOWNLOAD_OPTIONS);
    } else {
      res.status(404).json(UNKNOWN_APP);
    }
  } catch (err: any) {
    log.error(`Failed to download app ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

router.get('/:id/download', downloadApp);

/**
 * The team an upload or a move names: a string id, or null for the shared
 * pool. Undefined, null and '' all mean shared; anything else that is not a
 * string is refused.
 */
function parseTeamId(value: unknown): { ok: true; teamId: string | null } | { ok: false } {
  if (value === undefined || value === null || value === '') return { ok: true, teamId: null };
  if (typeof value === 'string') return { ok: true, teamId: value };
  return { ok: false };
}

async function teamExists(teamId: string): Promise<boolean> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
  return !!team;
}

/**
 * The team a member's upload goes into (ENH-16), or the refusal to send. An
 * admin (or a server with sign-in off: `teamIds` undefined) uploads anywhere,
 * as before. A member uploads into one of their teams, the only one when the
 * request names none; the shared pool, which everyone sees, stays an admin's
 * to fill. A key narrowed to a team has that team alone in `teamIds`. A team
 * that doesn't exist and one that isn't theirs get the same answer.
 */
function memberUploadTeam(
  teamIds: string[],
  requested: unknown,
): { ok: true; teamId: string } | { ok: false; status: number; body: object } {
  if (requested === undefined) {
    if (teamIds.length === 1) return { ok: true, teamId: teamIds[0] };
    if (teamIds.length === 0) {
      return {
        ok: false,
        status: 403,
        body: {
          error: 'no_team',
          message: 'Uploading an app needs a team. Ask an admin to add you to one.',
        },
      };
    }
    return {
      ok: false,
      status: 400,
      body: { error: 'team_required', message: 'Name the team to upload into: one of yours.' },
    };
  }
  if (requested === '' || requested === null) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'shared_admin_only',
        message: 'Only an admin can share an app with everyone.',
      },
    };
  }
  if (typeof requested === 'string' && teamIds.includes(requested)) {
    return { ok: true, teamId: requested };
  }
  return {
    ok: false,
    status: 403,
    body: { error: 'not_your_team', message: 'You can upload only into one of your teams.' },
  };
}

// A member uploads into their own teams (ENH-16); through 2.26 uploading
// was admin-only, so a CI key that uploaded each build was an admin's.
router.post('/upload', async (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: 'No files were uploaded.' });
  }

  const appFile = req.files.app;
  if (!appFile) {
    return res.status(400).json({ error: 'Field "app" is required.' });
  }

  // Optional multipart field. Checked before anything is written, so a bad
  // team stores nothing.
  const teamIds = req.auth?.teamIds;
  let teamId: string | null;
  if (teamIds === undefined) {
    const team = parseTeamId(req.body?.teamId);
    if (!team.ok) return res.status(400).json({ error: 'teamId must be a string' });
    teamId = team.teamId;
  } else {
    const team = memberUploadTeam(teamIds, req.body?.teamId);
    if (!team.ok) return res.status(team.status).json(team.body);
    teamId = team.teamId;
  }

  try {
    if (teamIds === undefined && teamId && !(await teamExists(teamId))) {
      return res.status(400).json({ error: 'team not found' });
    }
    // Bytes an app the uploader can see holds return that app, in its own
    // team; bytes only others' apps hold are stored again in `teamId`.
    const app = await APP_SERVICE.uploadApp(appFile, teamId, teamIds);
    log.audit('APP_UPLOAD', req.ip, { appId: app.id, name: app.name, teamId: app.teamId });
    res.json(withAppUrl(app));
  } catch (err: any) {
    log.error(`Failed to upload app: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Moves an app to a team, or back to the shared pool with `{ teamId: null }`.
 * Shaped like PUT /grid/device/:udid/team: admin role and scope, 404 for an
 * unknown team or app, `{ ok, updated }`.
 */
router.put('/:id/team', roleGuard('ADMIN'), scopeGuard(['admin']), async (req, res) => {
  const team = parseTeamId(req.body?.teamId);
  if (!team.ok) return res.status(400).json({ error: 'teamId must be a string or null' });
  try {
    if (team.teamId && !(await teamExists(team.teamId))) {
      return res.status(404).json({ error: 'team not found' });
    }
    const updated = await APP_SERVICE.setAppTeam(req.params.id, team.teamId);
    if (updated === 0) return res.status(404).json(UNKNOWN_APP);
    log.audit('APP_TEAM', req.ip, { appId: req.params.id, teamId: team.teamId });
    res.json({ ok: true, updated });
  } catch (err: any) {
    // The team already has an app with these bytes (one app per file per team).
    if (err instanceof AppAlreadyInTeam) {
      return res.status(409).json({
        error: 'conflict',
        message: 'That team already has an app with the same file.',
      });
    }
    log.error(`Failed to move app ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', roleGuard('ADMIN'), async (req, res) => {
  try {
    // Unknown and hidden alike: 404 with the unknown body, nothing deleted.
    const app = await APP_SERVICE.getAppById(req.params.id);
    if (!canRequestSeeApp(req, app)) return res.status(404).json(UNKNOWN_APP);
    await APP_SERVICE.deleteApp(req.params.id);
    log.audit('APP_DELETE', req.ip, { appId: req.params.id });
    res.sendStatus(204);
  } catch (err: any) {
    log.error(`Failed to delete app ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default {
  register: (apiRouter: Router) => {
    const fileUpload = require('express-fileupload');
    apiRouter.use('/apps', fileUpload(), router);
  },
};
