import { Router, type Request, type Response } from 'express';
import { APP_SERVICE } from '../../dashboard/services/app-service';
import log from '../../logger';
import fs from 'fs-extra';
import { mutationScopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();

// MEMBER-tier baseline: device app visibility requires authenticated user
router.use(roleGuard('MEMBER'));

// Uploading an APK/IPA or deleting one from the fleet requires devices scope.
// App listings stay readable to any authenticated key.
router.use(mutationScopeGuard(['devices']));

router.get('/', async (req, res) => {
  try {
    const apps = await APP_SERVICE.getApps();
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

export async function downloadApp(req: Request, res: Response): Promise<void> {
  try {
    const app = await APP_SERVICE.getAppById(req.params.id);
    if (app && (await fs.exists(app.filepath))) {
      res.download(app.filepath, app.filename, DOWNLOAD_OPTIONS);
    } else {
      res.status(404).json({ error: 'App not found' });
    }
  } catch (err: any) {
    log.error(`Failed to download app ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

router.get('/:id/download', downloadApp);

router.post('/upload', roleGuard('ADMIN'), async (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: 'No files were uploaded.' });
  }

  const appFile = req.files.app;
  if (!appFile) {
    return res.status(400).json({ error: 'Field "app" is required.' });
  }

  try {
    const app = await APP_SERVICE.uploadApp(appFile);
    log.audit('APP_UPLOAD', req.ip, { appId: app.id, name: app.name });
    res.json(app);
  } catch (err: any) {
    log.error(`Failed to upload app: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', roleGuard('ADMIN'), async (req, res) => {
  try {
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
