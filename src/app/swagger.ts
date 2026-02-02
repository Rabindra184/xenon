import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express, Router, Request, Response } from 'express';

const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'Xenon API',
        version: '1.0.0',
        description: `
# Xenon - Intelligent Mobile Infrastructure

Xenon is a self-healing device orchestration platform for Appium. This API documentation covers all available endpoints for:

- **Device Management**: View, control, and manage connected devices
- **Sessions**: Create, monitor, and manage Appium sessions
- **Reservations**: Reserve devices for exclusive use
- **Applications**: Upload, install, and manage mobile applications
- **Grid Operations**: Node management and device discovery
- **Webhooks**: Configure notification integrations
- **Control API**: Interactive device control (tap, swipe, type, screenshot)

## Authentication

Currently, the API does not require authentication. Future versions may add API key or JWT-based authentication.

## Base URL

All API endpoints are prefixed with \`/xenon/api\`
    `,
        contact: {
            name: 'Xenon Team',
            url: 'https://github.com/xenon-platform/xenon',
        },
        license: {
            name: 'ISC',
            url: 'https://opensource.org/licenses/ISC',
        },
    },
    servers: [
        {
            url: '/xenon',
            description: 'Xenon Device Farm API',
        },
    ],


    tags: [
        {
            name: 'Devices',
            description: 'Device discovery and management',
        },
        {
            name: 'Sessions',
            description: 'Appium session management and logs',
        },
        {
            name: 'Builds',
            description: 'Build and test execution tracking',
        },
        {
            name: 'Control',
            description: 'Interactive device control (tap, swipe, type, etc.)',
        },
        {
            name: 'Reservations',
            description: 'Device reservation for exclusive use',
        },
        {
            name: 'Applications',
            description: 'App repository and installation',
        },
        {
            name: 'Grid',
            description: 'Grid node management and queue status',
        },
        {
            name: 'Webhooks',
            description: 'Notification webhook configuration',
        },
        {
            name: 'Configuration',
            description: 'Platform configuration',
        },
    ],
    components: {
        schemas: {
            Device: {
                type: 'object',
                properties: {
                    udid: {
                        type: 'string',
                        description: 'Unique device identifier',
                        example: '00008110-00084CE80E51401E',
                    },
                    name: {
                        type: 'string',
                        description: 'Device name',
                        example: 'iPhone 14 Pro',
                    },
                    platform: {
                        type: 'string',
                        enum: ['ios', 'android'],
                        description: 'Device platform',
                    },
                    host: {
                        type: 'string',
                        description: 'Host where device is connected',
                        example: '192.168.1.100',
                    },
                    busy: {
                        type: 'boolean',
                        description: 'Whether device is in use',
                    },
                    session_id: {
                        type: 'string',
                        nullable: true,
                        description: 'Active session ID if busy',
                    },
                    state: {
                        type: 'string',
                        description: 'Device state',
                    },
                    sdk: {
                        type: 'string',
                        description: 'OS version',
                        example: '17.0',
                    },
                    deviceType: {
                        type: 'string',
                        description: 'Type of device (real/emulator/simulator)',
                    },
                },
            },
            Session: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'Session ID',
                    },
                    name: {
                        type: 'string',
                        description: 'Session name',
                    },
                    status: {
                        type: 'string',
                        enum: ['running', 'success', 'failed'],
                        description: 'Session status',
                    },
                    device_udid: {
                        type: 'string',
                    },
                    device_name: {
                        type: 'string',
                    },
                    device_platform: {
                        type: 'string',
                    },
                    createdAt: {
                        type: 'string',
                        format: 'date-time',
                    },
                },
            },
            Build: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                    },
                    name: {
                        type: 'string',
                    },
                    sessionCount: {
                        type: 'integer',
                    },
                    passedCount: {
                        type: 'integer',
                    },
                    failedCount: {
                        type: 'integer',
                    },
                    runningCount: {
                        type: 'integer',
                    },
                    createdAt: {
                        type: 'string',
                        format: 'date-time',
                    },
                },
            },
            Reservation: {
                type: 'object',
                properties: {
                    udid: {
                        type: 'string',
                    },
                    host: {
                        type: 'string',
                    },
                    reservedBy: {
                        type: 'string',
                    },
                    reservedUntil: {
                        type: 'integer',
                        description: 'Unix timestamp in milliseconds',
                    },
                    reservationReason: {
                        type: 'string',
                    },
                    remainingMs: {
                        type: 'integer',
                    },
                },
            },
            App: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                    },
                    name: {
                        type: 'string',
                    },
                    filename: {
                        type: 'string',
                    },
                    filepath: {
                        type: 'string',
                    },
                    platform: {
                        type: 'string',
                        enum: ['ios', 'android'],
                    },
                    uploadedAt: {
                        type: 'string',
                        format: 'date-time',
                    },
                },
            },
            WebhookConfig: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                    },
                    url: {
                        type: 'string',
                        format: 'uri',
                    },
                    events: {
                        type: 'array',
                        items: {
                            type: 'string',
                        },
                    },
                    type: {
                        type: 'string',
                        enum: ['slack', 'webhook'],
                    },
                },
            },
            Error: {
                type: 'object',
                properties: {
                    error: {
                        type: 'boolean',
                        example: true,
                    },
                    message: {
                        type: 'string',
                    },
                },
            },
            Success: {
                type: 'object',
                properties: {
                    success: {
                        type: 'boolean',
                        example: true,
                    },
                },
            },
        },
    },
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
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info .title { color: #6366f1; }
        .swagger-ui .scheme-container { background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 20px; border-radius: 8px; }
        .swagger-ui .btn.authorize { background: #6366f1; border-color: #6366f1; }
        .swagger-ui .btn.authorize:hover { background: #4f46e5; }
      `,
            customSiteTitle: 'Xenon API Documentation',
            customfavIcon: '/xenon/favicon.ico',
        })
    );

    // Serve raw OpenAPI spec as JSON
    (app as any).get('/api-docs.json', (req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });
}

export { swaggerSpec };

