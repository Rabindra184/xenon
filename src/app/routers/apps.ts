import { Router, type Request, type Response } from 'express';
import { APP_SERVICE } from '../../dashboard/services/app-service';
import log from '../../logger';
import fs from 'fs-extra';
import { mutationScopeGuard, scopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';
import { canSeeApp } from '../../services/device-access/appVisibility';
import { prisma } from '../../prisma';

const router = Router();

// MEMBER-tier baseline: device app visibility requires authenticated user
router.use(roleGuard('MEMBER'));

// Uploading an APK/IPA or deleting one from the fleet requires devices scope.
// App listings stay readable to any authenticated key.
router.use(mutationScopeGuard(['devices']));

// Uploaded apps follow the device team rule on the app's team (canSeeApp):
// admins see every app, members shared apps and their teams'. An app the
// caller can't see answers every route exactly as an unknown id.
const UNKNOWN_APP = { error: 'App not found' } as const;

router.get('/', async (req, res) => {
  try {
    const apps = await APP_SERVICE.getApps(req.auth?.teamIds);
    res.json(apps);
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

router.post('/upload', roleGuard('ADMIN'), async (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: 'No files were uploaded.' });
  }

  const appFile = req.files.app;
  if (!appFile) {
    return res.status(400).json({ error: 'Field "app" is required.' });
  }

  // Optional multipart field. Checked before anything is written, so a bad
  // team stores nothing.
  const team = parseTeamId(req.body?.teamId);
  if (!team.ok) return res.status(400).json({ error: 'teamId must be a string' });

  try {
    if (team.teamId && !(await teamExists(team.teamId))) {
      return res.status(400).json({ error: 'team not found' });
    }
    // An upload of bytes already stored returns that app, in its own team.
    const app = await APP_SERVICE.uploadApp(appFile, team.teamId);
    log.audit('APP_UPLOAD', req.ip, { appId: app.id, name: app.name, teamId: app.teamId });
    res.json(app);
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
