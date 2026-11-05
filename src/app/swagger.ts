import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express, Router, Request, Response } from 'express';
import pkg from '../../package.json';
import { API_DOCS_CSS, API_DOCS_THEME_SCRIPT } from './apiDocsTheme';

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

**Same-origin check.** A state-changing request (POST, PUT, PATCH, DELETE) must carry an \`Origin\` or \`Referer\` header from the same host as the server, or it gets \`403\`. Requests sent with the access key and token headers, an \`Authorization: Bearer\` token, or a hub token are exempt: a browser can't send those headers from another site. So only a script that calls a public endpoint such as \`POST /api/auth/login\` needs to send an \`Origin\` header.

## Errors

Errors are JSON with an \`error\` field. An unexpected server error is \`500\` with \`{ "error": "internal", "message": "Internal server error" }\`; the details go to the server's log. Newer endpoints put a stable, machine-readable code there (\`not_found\`, \`device_held_by_another_user\`) with a human-readable \`message\`. Older ones put the message itself in \`error\`, or \`true\` with a \`message\`. Branch on the HTTP status first.

## Rate limits

Every request with a credential is rate limited, except single-use tickets. An access key has its own budgets; a signed-in user's dashboard sessions and bearer tokens share one set of budgets per user (300 a minute). Each has three request budgets, refilled every minute:
- \`read\`: GET requests (ten times the budget for a signed-in user or a bearer token, since a dashboard page loads many images at once);
- \`heavy\`: AI, healing and visual endpoints (a quarter of the budget, at least 10);
- \`control\`: everything else.

Each such response carries \`X-RateLimit-Category\`, \`X-RateLimit-Remaining\` and \`X-RateLimit-Capacity\`. Past the budget the answer is \`429\` with \`Retry-After\` in seconds.

## Appium sessions

Appium's WebDriver API (\`POST /session\` and the session's commands, under Appium's own base path) is not part of this reference. A session authenticates in its capabilities, under \`xe:options\`, with one of:
- \`accessKey\` and \`token\`;
- \`sessionToken\`, minted by \`POST /api/auth/token\`.

Either names the session's owner only while that user exists and is active, and a session token needs the \`sessions\` scope, as a key does. A key or token that doesn't check out counts as none: with \`XENON_REQUIRE_SESSION_TOKEN\` the session is refused, without it the session runs with no owner.

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
          reservedByUserId: {
            type: 'string',
            nullable: true,
            description: 'The user who took the reservation; null before 2.13.',
          },
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
  // Serve Swagger UI at /xenon/api-docs. The page fetches the spec from
  // /xenon/api-docs.json. Don't hand swaggerUi.setup the spec itself:
  // swagger-ui-express pastes it into swagger-ui-init.js with
  // String.prototype.replace, which reads `$\``, `$'` and `$&` in the spec as
  // replacement patterns. control.yaml's "`$`, backticks" made the script a
  // syntax error and the page blank (2.17, api-docs-page.spec.ts).
  // customJsStr is swagger-ui-express 5's; @types/swagger-ui-express 4
  // doesn't list it.
  const pageOptions: swaggerUi.SwaggerUiOptions & { customJsStr: string } = {
    swaggerUrl: `${basePath}/api-docs.json`,
    customCss: API_DOCS_CSS,
    customJsStr: API_DOCS_THEME_SCRIPT,
    customSiteTitle: 'Xenon API Documentation',
    customfavIcon: '/xenon/favicon.png',
  };
  (app as any).use('/api-docs', swaggerUi.serve, swaggerUi.setup(null, pageOptions));

  // Serve raw OpenAPI spec as JSON
  (app as any).get('/api-docs.json', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

export { swaggerSpec };
