import { Router } from 'express';
import { APP_SERVICE } from '../../dashboard/services/app-service';
import log from '../../logger';
import fs from 'fs-extra';
import { mutationScopeGuard } from '../../middleware/scopeGuard';

const router = Router();

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

router.get('/:id/download', async (req, res) => {
  try {
    const app = await APP_SERVICE.getAppById(req.params.id);
    if (app && (await fs.exists(app.filepath))) {
      res.download(app.filepath, app.filename);
    } else {
      res.status(404).json({ error: 'App not found' });
    }
  } catch (err: any) {
    log.error(`Failed to download app ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload', async (req, res) => {
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

router.delete('/:id', async (req, res) => {
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
