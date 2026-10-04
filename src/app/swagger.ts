import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express, Router, Request, Response } from 'express';
import pkg from '../../package.json';

/**
 * The API reference served at /xenon/api-docs (and as JSON at
 * /xenon/api-docs.json). The shared parts live here: the introduction,
 * authentication, the error and rate-limit responses, and the tags. Each
 * area's paths live in src/app/openapi/<area>.yaml.
 *
 * test/unit/openapi-coverage.spec.ts keeps it whole: every route the server
 * serves must be documented, every documented route must be served, and the
 * result must be valid OpenAPI 3.
 */

const errorExample = (error: string, message?: string) => ({
  'application/json': {
    schema: { $ref: '#/components/schemas/Error' },
    example: message ? { error, message } : { error },
  },
});

const swaggerDefinition = {
  openapi: '3.0.3',
  servers: [{ url: '/xenon', description: 'This Xenon server' }],
  info: {
    title: 'Xenon API',
    version: pkg.version,
    description: `
The REST API of a Xenon server: the devices in your lab, the Appium sessions that run on them, live device control, recordings, selector health and administration. The dashboard uses this same API.

This reference describes version **${pkg.version}**. Every path below is relative to \`/xenon\`, so \`/api/devices\` is \`https://<your-xenon-host>/xenon/api/devices\`. The raw OpenAPI document is at [\`/xenon/api-docs.json\`](/xenon/api-docs.json).

## Authentication

Every endpoint needs a credential, except the few marked as public (health checks, sign-in, password reset and the JWKS). The four ways to authenticate are:

| Credential | How to send it | Typical use |
|---|---|---|
| **Access key and API token** | \`x-xenon-access-key\` and \`x-xenon-token\` headers | Scripts, CI, SDKs, a node reporting to its hub |
| **Bearer token** | \`Authorization: Bearer <jwt>\` | Short-lived access; mint one with \`POST /api/auth/token\` (audience \`xenon-rest\`, 1 hour) |
| **Dashboard session** | \`xenon_dashboard_session\` cookie, set by \`POST /api/auth/login\` | The browser dashboard |
| **Hub token** | \`x-xenon-hub-token\` header | Hub to node only; Xenon sends it itself |

Find your access key and create API tokens on your profile page (\`/xenon/profile\`, **API tokens**).

**Scopes.** An API token carries scopes: \`read\`, \`sessions\`, \`devices\` and \`admin\`. \`admin\` satisfies any scope. A signed-in dashboard user gets the scopes of their role: members have \`devices\`, \`sessions\` and \`read\`; admins also have \`admin\`. A request without the scope it needs gets \`403\`.

**Roles.** Some endpoints also need a role: \`MEMBER\`, \`ADMIN\` or \`SUPER_ADMIN\`. Each says so in its description.

**Teams.** A member sees only their teams' devices and the shared pool, and the sessions, apps and selectors that go with them. Something outside your teams answers exactly as if it didn't exist: \`404\`.

**Same-origin check.** A state-changing request (POST, PUT, PATCH, DELETE) must carry an \`Origin\` or \`Referer\` header from the same host as the server, or it gets \`403\`. Only requests sent with the access key and token headers (or a hub token) are exempt. So a script that uses a bearer token, or calls a public endpoint such as \`POST /api/auth/login\`, should send an \`Origin\` header.

## Errors

Errors are JSON with an \`error\` field. An unexpected server error is \`500\` with \`{ "error": "internal", "message": "Internal server error" }\`; the details go to the server's log. Newer endpoints put a stable, machine-readable code there (\`not_found\`, \`device_held_by_another_user\`) with a human-readable \`message\`. Older ones put the message itself in \`error\`, or \`true\` with a \`message\`. Branch on the HTTP status first.

## Rate limits

Requests made with an access key and token are rate limited; bearer tokens and dashboard sessions aren't. Each key has three request budgets, refilled every minute:
- \`read\`: GET requests;
- \`heavy\`: AI, healing and visual endpoints (a quarter of the budget, at least 10);
- \`control\`: everything else.

Each such response carries \`X-RateLimit-Category\`, \`X-RateLimit-Remaining\` and \`X-RateLimit-Capacity\`. Past the budget the answer is \`429\` with \`Retry-After\` in seconds.

## Appium sessions

Appium's WebDriver API (\`POST /session\` and the session's commands, under Appium's own base path) is not part of this reference. A session authenticates in its capabilities, under \`xe:options\`, with one of:
- \`accessKey\` and \`token\`;
- \`sessionToken\`, minted by \`POST /api/auth/token\`.

A leased device also takes \`leaseId\` and \`leaseToken\`, which the lease's \`appiumCapabilities\` already carry. Xenon removes these credentials before the driver or any stored record sees them.

## Live streams

Device previews and live logs use WebSockets, outside this reference:
- \`/xenon/api/control/{udid}/stream/h264\`
- \`/xenon/api/control/{udid}/logcat\`

Both are opened with a ticket from \`POST /api/control/{udid}/stream/ticket\`. Socket.IO at \`/socket.io/\` carries the dashboard's live events.
`,
    contact: {
      name: 'Xenon',
      url: 'https://github.com/Rabindra184/xenon',
    },
    license: {
      name: 'ISC',
      url: 'https://opensource.org/licenses/ISC',
    },
  },

  tags: [
    { name: 'Health & Ops', description: 'Liveness, version, metrics and server information.' },
    { name: 'Authentication', description: 'Sign-in, sign-out, password reset and tokens.' },
    { name: 'Profile', description: 'Your own account: API tokens and access key.' },
    { name: 'Users', description: 'User accounts. Admin only.' },
    { name: 'Teams', description: 'Teams, their members and the devices they own.' },
    { name: 'API Keys', description: 'Every API key in the lab. Admin only.' },
    { name: 'Projects', description: 'Projects that group work in the lab.' },
    { name: 'Audit', description: 'Audit events sent in by Xenon services.' },
    { name: 'Devices', description: 'The devices in the lab, and blocking them for maintenance.' },
    {
      name: 'Control',
      description: 'Drive one device: input, screenshots, live preview, apps, logs and inspection.',
    },
    { name: 'Reservations', description: 'Reserving a device for a person for a while.' },
    {
      name: 'Leases',
      description: 'Claiming devices from code (SDKs, MCP tools), with a heartbeat.',
    },
    { name: 'Queue', description: 'Sessions waiting for a free device.' },
    {
      name: 'Hub-Node',
      description: 'How nodes report their devices to a hub, and what a node answers its hub.',
    },
    {
      name: 'Sessions',
      description: 'Appium sessions: their history, commands, logs, assets and performance.',
    },
    { name: 'Builds', description: 'Groups of sessions from one test run.' },
    {
      name: 'Selector Health',
      description: 'Selectors your tests found only with self-healing, and their fixes.',
    },
    {
      name: 'Network Interceptor',
      description: "A session's captured HTTP traffic, mocks and HAR export.",
    },
    {
      name: 'Recordings',
      description: 'Recordings of one or more devices, with marks, bookmarks and proof bundles.',
    },
    { name: 'Applications', description: 'Uploaded app builds and which team sees them.' },
    { name: 'Webhooks', description: 'Where Xenon sends its events.' },
    { name: 'Configuration', description: 'Server settings, including AI providers.' },
    { name: 'Admin', description: 'Operations views for administrators.' },
  ],
  components: {
    schemas: {
      Error: {
        type: 'object',
        description:
          'An error. `error` is a machine-readable code on newer endpoints, otherwise the message itself (or `true`, with `message`).',
        required: ['error'],
        properties: {
          error: {
            oneOf: [{ type: 'string' }, { type: 'boolean', enum: [true] }],
            example: 'not_found',
          },
          message: { type: 'string', example: 'Device not found' },
        },
        additionalProperties: true,
      },
      Success: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true } },
      },
      Device: {
        type: 'object',
        description: 'A device in the lab, as the device list returns it.',
        properties: {
          udid: { type: 'string', example: '00008110-00084CE80E51401E' },
          name: { type: 'string', example: 'iPhone 14 Pro' },
          platform: { type: 'string', enum: ['ios', 'android'] },
          host: {
            type: 'string',
            description: 'The server the device is attached to.',
            example: 'http://192.168.1.100:4723',
          },
          nodeId: {
            type: 'string',
            nullable: true,
            description: 'The node that reported it, on a hub.',
          },
          busy: { type: 'boolean' },
          session_id: {
            type: 'string',
            nullable: true,
            description:
              'The Appium session on it, or a preview or recording hold (`manual_<userId>_<udid>`).',
          },
          state: { type: 'string', example: 'device' },
          sdk: { type: 'string', example: '17.0' },
          deviceType: { type: 'string', enum: ['real', 'simulator', 'emulator'] },
          realDevice: { type: 'boolean' },
          offline: { type: 'boolean' },
          userBlocked: { type: 'boolean', description: 'Blocked for maintenance.' },
          teamId: {
            type: 'string',
            nullable: true,
            description: 'The owning team; null is the shared pool.',
          },
          reservedBy: { type: 'string', nullable: true },
          reservedUntil: { type: 'integer', nullable: true, description: 'Epoch milliseconds.' },
          healthStatus: { type: 'string', example: 'Healthy' },
          batteryLevel: { type: 'integer', nullable: true },
          screenWidth: { type: 'string', nullable: true },
          screenHeight: { type: 'string', nullable: true },
        },
        additionalProperties: true,
      },
      Session: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', nullable: true },
          status: { type: 'string', example: 'success' },
          build_id: { type: 'string', nullable: true },
          device_udid: { type: 'string' },
          device_name: { type: 'string' },
          device_platform: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
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
        additionalProperties: true,
      },
    },
    securitySchemes: {
      AccessKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-xenon-access-key',
        description:
          'Your access key (`xen_…`), always sent together with `x-xenon-token`. Shown on your profile page, where you can also rotate it.',
      },
      TokenAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-xenon-token',
        description:
          'An API token from your profile page, sent together with `x-xenon-access-key`. It carries its own scopes.',
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'A token from `POST /api/auth/token` (audience `xenon-rest`), valid for one hour. Verified against `/api/auth/jwks.json`; revoking its user takes effect at once.',
      },
      CookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'xenon_dashboard_session',
        description:
          'The dashboard session cookie set by `POST /api/auth/login`. State-changing requests also need a same-host `Origin` or `Referer`.',
      },
      HubToken: {
        type: 'apiKey',
        in: 'header',
        name: 'x-xenon-hub-token',
        description:
          "A hub's short-lived signed token, verified by the node against the hub's JWKS. Used only between a hub and its nodes.",
      },
    },
    headers: {
      'X-RateLimit-Category': {
        description: 'The budget this request counted against: `read`, `heavy` or `control`.',
        schema: { type: 'string', enum: ['read', 'heavy', 'control'] },
      },
      'X-RateLimit-Remaining': {
        description: 'Requests left in that budget.',
        schema: { type: 'integer' },
      },
      'X-RateLimit-Capacity': {
        description: "The budget's size per minute.",
        schema: { type: 'integer' },
      },
      'Retry-After': {
        description: 'Seconds until a request in this budget will be accepted.',
        schema: { type: 'integer' },
      },
    },
    responses: {
      BadRequest: {
        description: 'The request is malformed or a field is missing or invalid.',
        content: errorExample('bad_request', 'udid is required'),
      },
      Unauthorized: {
        description: 'No credential, or one that is invalid, expired or revoked.',
        content: errorExample('unauthenticated'),
      },
      Forbidden: {
        description:
          'The credential is valid but lacks the scope or role this needs, or a browser request failed the same-origin check.',
        content: errorExample('insufficient scope'),
      },
      NotFound: {
        description: "It doesn't exist, or it is outside your teams (the two answer the same).",
        content: errorExample('not_found', 'Not found'),
      },
      Conflict: {
        description:
          'It conflicts with the current state, for example a device held by another user.',
        content: errorExample(
          'device_held_by_another_user',
          'This device is in use by another user.',
        ),
      },
      RateLimited: {
        description:
          "The API key's budget for the request's category is spent. Only requests made with an access key and token are limited.",
        headers: {
          'X-RateLimit-Category': { $ref: '#/components/headers/X-RateLimit-Category' },
          'X-RateLimit-Remaining': { $ref: '#/components/headers/X-RateLimit-Remaining' },
          'X-RateLimit-Capacity': { $ref: '#/components/headers/X-RateLimit-Capacity' },
          'Retry-After': { $ref: '#/components/headers/Retry-After' },
        },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { error: 'rate limit exceeded', category: 'control', retryAfter: 2 },
          },
        },
      },
      ServiceUnavailable: {
        description: 'A dependency needed to answer could not be reached; try again.',
        content: errorExample('internal', 'Service unavailable'),
      },
      InternalError: {
        description: 'An unexpected server error.',
        content: errorExample('internal', 'Internal server error'),
      },
    },
  },
  security: [{ AccessKeyAuth: [], TokenAuth: [] }, { BearerAuth: [] }, { CookieAuth: [] }],
};

import path from 'path';

const options: any = {
  swaggerDefinition,
  apis: [
    // One YAML file per API area: src/app/openapi, copied to lib/src/app/openapi
    // by build:copy. YAML, not JSDoc in a .ts file: tsc dropped most of those
    // free-standing comments, and the served page lost 54 of its 100 paths.
    path.join(__dirname, 'openapi', '*.yaml'),
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
        
        /* Readability. The title's gradient text left the version badges blank, and
           Swagger UI's own light section bars and dim greys sat on the dark page. */
        .swagger-ui .info .title small, .swagger-ui .info .title small pre { -webkit-text-fill-color: #020617; color: #020617 !important; font-family: 'JetBrains Mono', monospace; }
        .swagger-ui .info .markdown h1, .swagger-ui .info .markdown h2, .swagger-ui .info .markdown h3 { color: var(--xenon-text) !important; font-family: 'Outfit', sans-serif; margin-top: 40px; }
        .swagger-ui .markdown p, .swagger-ui .markdown li, .swagger-ui .renderedMarkdown p, .swagger-ui .renderedMarkdown li { color: #cbd5e1 !important; }
        .swagger-ui .markdown table td, .swagger-ui .markdown table th { color: #cbd5e1 !important; border-color: var(--xenon-border-bright) !important; padding: 8px 12px; vertical-align: top; }
        .swagger-ui .markdown strong, .swagger-ui .renderedMarkdown strong { color: var(--xenon-text) !important; }
        .swagger-ui .markdown a, .swagger-ui .info a { color: var(--xenon-blue) !important; }
        .swagger-ui .opblock .opblock-section-header { background: var(--xenon-surface-hover) !important; box-shadow: none !important; border-top: 1px solid var(--xenon-border-bright); }
        .swagger-ui .opblock .opblock-section-header h4, .swagger-ui .opblock .opblock-section-header label, .swagger-ui .opblock-title_normal { color: var(--xenon-text) !important; }
        .swagger-ui .opblock-description-wrapper p, .swagger-ui .opblock-description-wrapper li, .swagger-ui .response-col_description, .swagger-ui .parameter__name, .swagger-ui .parameter__type, .swagger-ui .parameter__in, .swagger-ui table thead tr td, .swagger-ui table thead tr th, .swagger-ui .response-col_status, .swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5, .swagger-ui .tab li, .swagger-ui .opblock-summary-description { color: #cbd5e1 !important; }
        .swagger-ui .dialog-ux .modal-ux-content p, .swagger-ui .dialog-ux .modal-ux-content label, .swagger-ui .dialog-ux .modal-ux-content h4, .swagger-ui .dialog-ux .modal-ux-content h6 { color: #cbd5e1 !important; }
        .swagger-ui .model, .swagger-ui .model-title, .swagger-ui .property-row td { color: #cbd5e1 !important; }
        .swagger-ui .info h1, .swagger-ui .info h2, .swagger-ui .info h3, .swagger-ui .info h4 { color: var(--xenon-text) !important; font-family: 'Outfit', sans-serif; }
        .swagger-ui .info table td, .swagger-ui .info table th, .swagger-ui .info li { color: #cbd5e1 !important; }
        .swagger-ui table.headers td, .swagger-ui .header-row td, .swagger-ui .headers-wrapper td { color: #cbd5e1 !important; }

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
