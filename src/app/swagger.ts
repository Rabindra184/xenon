import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express, Router, Request, Response } from 'express';

const swaggerDefinition = {
  openapi: '3.0.0',
  servers: [
    {
      url: '/xenon',
      description: 'Local Grid Node Registry',
    },
  ],
  info: {
    title: 'Xenon API',
    version: '1.0.0',
    description: `
# Xenon Edge • Intelligent Infrastructure API
**The foundation for autonomous mobile device orchestration.**

Xenon's high-performance API provides programmatic access to the core orchestration engine, enabling complex automation workflows for distributed device farms.

### Key Capabilities:
*   **Elastic Device Grid**: Real-time discovery and state management of physical nodes.
*   **Autonomous Sessions**: Self-healing Appium session management with automated retries.
*   **Deep Control**: Direct low-latency interaction logic (Input injection, thermal monitoring).
*   **Security Protocol**: Industrial-grade isolation for sensitive test environments.

---
### Authentication
Most endpoints require an **API key** sent as the \`x-xenon-api-key\` header. Keys carry one of four scopes — \`read\`, \`sessions\`, \`devices\`, or \`admin\` — and \`admin\` always satisfies any scope check. Hub-node endpoints (\`/api/register\`, \`/api/unblock\`) prefer the per-node \`(x-xenon-access-key, x-xenon-token)\` pair — the same shape used by SDK / CLI clients. The legacy \`x-xenon-node-secret\` shared header is still accepted while \`XENON_ACCEPT_LEGACY_NODE_SECRET=true\` (default for one minor); operators flip it to \`false\` once every node has migrated. See the node-provisioning ops doc for the migration plan.

### Rate limiting
Every authenticated response carries \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, and \`X-RateLimit-Reset\` headers. Requests beyond the configured budget receive \`429 Too Many Requests\`.
        `,
    contact: {
      name: 'Xenon Architecture Team',
      url: 'https://github.com/xenon-platform/xenon',
    },
    license: {
      name: 'ISC License',
      url: 'https://opensource.org/licenses/ISC',
    },
  },

  tags: [
    { name: 'Health & Ops', description: 'Liveness, version, metrics, runtime args' },
    { name: 'Authentication', description: 'Browser dashboard login' },
    { name: 'Devices', description: 'Real-time grid discovery' },
    { name: 'Sessions', description: 'Orchestration & Logs' },
    { name: 'Builds', description: 'Telemetry tracking' },
    { name: 'Control', description: 'Direct interaction engine' },
    { name: 'Reservations', description: 'Resource locking' },
    { name: 'Applications', description: 'Artifact management' },
    { name: 'Grid', description: 'Cluster topology' },
    { name: 'Webhooks', description: 'Event propagation' },
    { name: 'Configuration', description: 'Edge node parameters' },
    { name: 'Selector Health', description: 'Heal-rate analytics & lifecycle' },
    { name: 'Network Interceptor', description: 'Per-session HTTP capture, mocks, HAR export' },
    { name: 'Admin', description: 'API keys, teams, process snapshots' },
    { name: 'Hub-Node', description: 'Hub↔node device registration channel' },
  ],
  components: {
    schemas: {
      Device: {
        type: 'object',
        properties: {
          udid: {
            type: 'string',
            description: 'Unique identity',
            example: '00008110-00084CE80E51401E',
          },
          name: { type: 'string', example: 'iPhone 14 Pro' },
          platform: { type: 'string', enum: ['ios', 'android'] },
          host: { type: 'string', example: '192.168.1.100' },
          busy: { type: 'boolean' },
          session_id: { type: 'string', nullable: true },
          state: { type: 'string' },
          sdk: { type: 'string', example: '17.0' },
          deviceType: { type: 'string' },
        },
      },
      // ... (rest of schemas remain same for internal completeness)
      Session: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['running', 'success', 'failed'] },
          device_udid: { type: 'string' },
          device_name: { type: 'string' },
          device_platform: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Build: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          sessionCount: { type: 'integer' },
          passedCount: { type: 'integer' },
          failedCount: { type: 'integer' },
          runningCount: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Reservation: {
        type: 'object',
        properties: {
          udid: { type: 'string' },
          host: { type: 'string' },
          reservedBy: { type: 'string' },
          reservedUntil: { type: 'integer' },
          reservationReason: { type: 'string' },
          remainingMs: { type: 'integer' },
        },
      },
      App: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          filename: { type: 'string' },
          filepath: { type: 'string' },
          platform: { type: 'string', enum: ['ios', 'android'] },
          uploadedAt: { type: 'string', format: 'date-time' },
        },
      },
      WebhookConfig: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          type: { type: 'string', enum: ['slack', 'webhook'] },
        },
      },
      LocatorSuggestion: {
        type: 'object',
        properties: {
          strategy: { type: 'string' },
          value: { type: 'string' },
          priority: { type: 'integer' },
          isUnique: { type: 'boolean' },
        },
      },
      InspectorNode: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          text: { type: 'string' },
          path: { type: 'string' },
          rect: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          attributes: { type: 'object', additionalProperties: true },
          locators: {
            type: 'array',
            items: { $ref: '#/components/schemas/LocatorSuggestion' },
          },
          children: {
            type: 'array',
            items: { $ref: '#/components/schemas/InspectorNode' },
          },
        },
      },
      InspectorSnapshot: {
        type: 'object',
        properties: {
          udid: { type: 'string' },
          platform: { type: 'string' },
          screenshot: { type: 'string', description: 'Base64 encoded screenshot' },
          root: { $ref: '#/components/schemas/InspectorNode' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'boolean', example: true },
          message: { type: 'string' },
        },
      },
      Success: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
        },
      },
    },
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-xenon-api-key',
        description:
          'Per-user API key. Carries one of four scopes — `read`, `sessions`, `devices`, or `admin` (admin always satisfies any scope check). Mint and rotate keys via `/api/apikeys` (admin scope required).',
      },
      NodeSecretAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-xenon-node-secret',
        description:
          'DEPRECATED (Phase 4B): use the (accessKey, token) header pair instead — set `x-xenon-access-key` and `x-xenon-token` on `/api/register` and `/api/unblock`. The legacy header is accepted while `XENON_ACCEPT_LEGACY_NODE_SECRET=true` (default for one minor); operators flip to `false` once every node has migrated. See the node-provisioning ops doc for the migration plan.',
      },
    },
    headers: {
      'X-RateLimit-Limit': {
        description: 'Maximum requests allowed in the current window for the matched bucket (read / heavy / control).',
        schema: { type: 'integer' },
      },
      'X-RateLimit-Remaining': {
        description: 'Remaining requests in the current window.',
        schema: { type: 'integer' },
      },
      'X-RateLimit-Reset': {
        description: 'Unix epoch seconds at which the window resets.',
        schema: { type: 'integer' },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Missing or invalid API key / node secret.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { error: true, message: 'Unauthorized' },
          },
        },
      },
      Forbidden: {
        description: "API key lacks the required scope, or CSRF check failed for a browser caller.",
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { error: true, message: 'Forbidden: scope `admin` required' },
          },
        },
      },
      RateLimited: {
        description: 'Per-key rate limit exceeded for this bucket.',
        headers: {
          'X-RateLimit-Limit': { $ref: '#/components/headers/X-RateLimit-Limit' },
          'X-RateLimit-Remaining': { $ref: '#/components/headers/X-RateLimit-Remaining' },
          'X-RateLimit-Reset': { $ref: '#/components/headers/X-RateLimit-Reset' },
        },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { error: true, message: 'Too Many Requests' },
          },
        },
      },
    },
  },
  security: [{ ApiKeyAuth: [] }],
};

import path from 'path';

// @ts-ignore - Types will be available after package install
const options: any = {
  swaggerDefinition,
  apis: [
    // Load from compiled JS (execution runtime)
    path.join(__dirname, 'swagger-docs.js'),
    path.join(__dirname, 'routers', '*.js'),
    // Fallback to TS source (development environment)
    path.join(__dirname, '..', '..', '..', 'src', 'app', 'swagger-docs.ts'),
    path.join(__dirname, '..', '..', '..', 'src', 'app', 'routers', '*.ts'),
  ],
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: Express | Router, basePath = '/xenon') {
  // Serve Swagger UI at /xenon/api-docs
  (app as any).use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: `
        /* Xenon Ultimate V2 • High-Integrity API Documentation */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');

        :root {
          --xenon-bg: #020617;
          --xenon-surface: #0f172a;
          --xenon-surface-hover: #1e293b;
          --xenon-border: rgba(255, 255, 255, 0.05);
          --xenon-border-bright: rgba(255, 255, 255, 0.12);
          --xenon-emerald: #22c55e;
          --xenon-emerald-glow: rgba(34, 197, 94, 0.2);
          --xenon-blue: #38bdf8;
          --xenon-blue-glow: rgba(56, 189, 248, 0.2);
          --xenon-amber: #fbbf24;
          --xenon-amber-glow: rgba(251, 191, 36, 0.2);
          --xenon-crimson: #f43f5e;
          --xenon-crimson-glow: rgba(244, 63, 94, 0.2);
          --xenon-text: #f8fafc;
          --xenon-text-dim: #94a3b8;
          --xenon-text-dark: #475569;
        }

        body { background: var(--xenon-bg) !important; margin: 0; font-family: 'Inter', sans-serif !important; -webkit-font-smoothing: antialiased; }
        .swagger-ui { background: var(--xenon-bg) !important; color: var(--xenon-text) !important; padding-bottom: 80px; }
        
        /* Layout & Spacing */
        .swagger-ui .wrapper { max-width: 1100px; padding: 0 40px; }
        .swagger-ui .topbar { display: none; }
        
        /* Header & Info */
        .swagger-ui .info { margin: 80px 0 40px 0; }
        .swagger-ui .info .title { 
            font-family: 'Outfit', sans-serif; 
            font-size: 52px; 
            font-weight: 800; 
            color: #fff !important; 
            letter-spacing: -0.04em; 
            margin-bottom: 24px;
            background: linear-gradient(to bottom right, #fff 30%, var(--xenon-text-dim));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .swagger-ui .info p { font-size: 18px; color: var(--xenon-text-dim) !important; line-height: 1.8; max-width: 700px; margin-bottom: 32px; }
        .swagger-ui .info code { background: #18181b; color: var(--xenon-emerald); padding: 4px 8px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 14px; }
        
        /* Server Selection Card */
        .swagger-ui .scheme-container { 
            background: var(--xenon-surface) !important; 
            border: 1px solid var(--xenon-border); 
            border-radius: 20px; 
            padding: 32px; 
            box-shadow: 0 20px 40px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.05);
            margin: 40px 0;
        }
        .swagger-ui .servers-title { color: #fff !important; font-family: 'Outfit', sans-serif; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.5; margin-bottom: 12px; }
        .swagger-ui .servers select { background: #000 !important; border: 1px solid var(--xenon-border-bright) !important; color: var(--xenon-text) !important; border-radius: 10px !important; padding: 12px !important; width: 100%; max-width: 400px; }

        /* Operations & Methods */
        .swagger-ui .opblock-tag { 
            font-family: 'Outfit', sans-serif; 
            border: none; 
            color: #fff !important; 
            font-size: 24px; 
            font-weight: 700; 
            margin: 60px 0 24px 0; 
            padding: 0; 
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .swagger-ui .opblock-tag small { color: var(--xenon-text-dim) !important; font-size: 14px; font-weight: 400; text-transform: none; letter-spacing: 0; margin-left: auto; }
        
        .swagger-ui .opblock { 
            border: 1px solid var(--xenon-border) !important; 
            background: var(--xenon-surface) !important; 
            border-radius: 16px !important; 
            margin-bottom: 16px !important; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.2); 
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            overflow: hidden;
        }
        .swagger-ui .opblock:hover { 
            border-color: var(--xenon-border-bright) !important; 
            transform: translateY(-2px); 
            box-shadow: 0 12px 24px rgba(0,0,0,0.4); 
            background: var(--xenon-surface-hover) !important;
        }
        .swagger-ui .opblock-summary { padding: 16px 24px; border-bottom: none !important; }
        
        /* Semantic Method Glows */
        .swagger-ui .opblock-summary-method { 
            border-radius: 8px !important; 
            border: none !important; 
            font-family: 'JetBrains Mono', monospace !important; 
            font-weight: 800 !important; 
            font-size: 13px !important; 
            min-width: 85px !important; 
            padding: 6px 0 !important;
            box-shadow: inset 0 1px 1px rgba(255,255,255,0.2) !important;
        }
        
        /* GET */
        .swagger-ui .opblock.opblock-get .opblock-summary-method { background: var(--xenon-blue) !important; box-shadow: 0 0 15px var(--xenon-blue-glow), inset 0 1px 1px rgba(255,255,255,0.2) !important; }
        .swagger-ui .opblock.opblock-get:hover { border-color: var(--xenon-blue) !important; }
        /* POST */
        .swagger-ui .opblock.opblock-post .opblock-summary-method { background: var(--xenon-emerald) !important; box-shadow: 0 0 15px var(--xenon-emerald-glow), inset 0 1px 1px rgba(255,255,255,0.2) !important; }
        .swagger-ui .opblock.opblock-post:hover { border-color: var(--xenon-emerald) !important; }
        /* PUT */
        .swagger-ui .opblock.opblock-put .opblock-summary-method { background: var(--xenon-amber) !important; box-shadow: 0 0 15px var(--xenon-amber-glow), inset 0 1px 1px rgba(255,255,255,0.2) !important; }
        .swagger-ui .opblock.opblock-put:hover { border-color: var(--xenon-amber) !important; }
        /* DELETE */
        .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: var(--xenon-crimson) !important; box-shadow: 0 0 15px var(--xenon-crimson-glow), inset 0 1px 1px rgba(255,255,255,0.2) !important; }
        .swagger-ui .opblock.opblock-delete:hover { border-color: var(--xenon-crimson) !important; }

        .swagger-ui .opblock-summary-path { color: #fff !important; font-family: 'JetBrains Mono', monospace !important; font-size: 16px !important; font-weight: 600 !important; }
        .swagger-ui .opblock-summary-description { color: var(--xenon-text-dim) !important; font-size: 14px; margin-left: 12px; }

        /* Forms & Interactive */
        .swagger-ui .btn.authorize { color: var(--xenon-emerald) !important; border-color: var(--xenon-emerald) !important; background: transparent !important; border-radius: 12px; font-weight: 600; padding: 10px 24px; transition: all 0.2s; }
        .swagger-ui .btn.authorize:hover { background: var(--xenon-emerald-glow) !important; transform: scale(1.02); }
        .swagger-ui .btn.authorize svg { fill: var(--xenon-emerald) !important; }
        
        .swagger-ui .btn.execute { background-color: var(--xenon-emerald) !important; border: none !important; border-radius: 12px !important; padding: 12px 32px !important; font-weight: 700 !important; letter-spacing: 0.1em; text-transform: uppercase; box-shadow: 0 8px 16px var(--xenon-emerald-glow) !important; }
        .swagger-ui .btn.cancel { border-radius: 12px !important; border: 1px solid var(--xenon-border-bright) !important; color: var(--xenon-text) !important; }
        
        .swagger-ui input[type=text], .swagger-ui select, .swagger-ui textarea { background: #000 !important; border: 1px solid var(--xenon-border-bright) !important; color: #fff !important; border-radius: 12px !important; padding: 14px !important; }
        
        /* Models / Schemas */
        .swagger-ui section.models { border: 1px solid var(--xenon-border); border-radius: 20px; background: var(--xenon-surface); margin-top: 80px; padding: 20px; }
        .swagger-ui section.models h4 { color: #fff !important; font-family: 'Outfit', sans-serif; font-size: 20px; margin-bottom: 24px; border-bottom: 1px solid var(--xenon-border); padding-bottom: 12px; }
        .swagger-ui .model-box { background: transparent !important; }
        .swagger-ui .model-title { color: var(--xenon-emerald) !important; font-family: 'JetBrains Mono', monospace; font-size: 14px; }
        .swagger-ui .prop-type { color: var(--xenon-blue) !important; }
        .swagger-ui .prop-format { color: var(--xenon-text-dim) !important; font-size: 11px; }

        /* Modal Overhaul */
        .swagger-ui .dialog-ux .modal-ux { background: var(--xenon-bg) !important; border: 1px solid var(--xenon-border-bright) !important; border-radius: 28px; box-shadow: 0 80px 160px rgba(0,0,0,0.9); padding: 40px; }
        .swagger-ui .dialog-ux .modal-ux-header h3 { font-family: 'Outfit', sans-serif; font-size: 28px; color: #fff !important; margin-bottom: 16px; }
        .swagger-ui .dialog-ux .modal-ux-content h4 { color: var(--xenon-text-dim) !important; margin-top: 24px; }
        
        /* Custom Scrollbar */
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: var(--xenon-bg); }
        ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 5px; border: 2px solid var(--xenon-bg); }
        ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
      `,
      customSiteTitle: 'Xenon API Documentation',
      customfavIcon: '/xenon/favicon.png',
    }),
  );

  // Serve raw OpenAPI spec as JSON
  (app as any).get('/api-docs.json', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

export { swaggerSpec };
