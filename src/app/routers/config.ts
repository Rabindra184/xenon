import { Router } from 'express';

import { AI_SERVICE } from '../../services/AIService';
import { mutationScopeGuard } from '../../middleware/scopeGuard';
import { roleGuard, superAdminGuard } from '../../middleware/roleGuard';

export default class ConfigRouter {
  public static register(router: Router) {
    const configRouter = Router();

    // GET and POST /config, and /config/reset-metrics, are the dashboard
    // router's (dashboard.ts), which is registered first. This router's own
    // GET and POST were never reached, and are gone. What is left: testing an
    // AI provider, SUPER_ADMIN with the admin scope.
    configRouter.use(roleGuard('ADMIN'));
    configRouter.use(mutationScopeGuard(['admin']));

    configRouter.post(
      '/test-ai',
      superAdminGuard('Only a super admin can test an AI provider.'),
      async (req, res) => {
        const testConfig = (req as any).unredactedBody || req.body;
        try {
          const result = await AI_SERVICE.testConnection(testConfig);
          res.json(result);
        } catch (err: any) {
          res.status(500).json({ success: false, message: err.message });
        }
      },
    );

    router.use('/config', configRouter);
  }
}
