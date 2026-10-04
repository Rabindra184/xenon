import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import path from 'path';
import request from '../helpers/loopbackRequest';
import { createRouter } from '../../src/app/index';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';

/**
 * `enableDashboard` was described as "Serve the React dashboard at /xenon/
 * and the Socket.io event stream". It never decided that: the server mounts
 * /xenon on every start (ServerManager.registerRoutes) and nothing under it
 * reads the option. What it decides is how much a hub records of a session
 * (SessionLifecycleService, the command interceptor, the session gateway's
 * dashboard hooks).
 */

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schema.json'), 'utf8'),
) as { properties: Record<string, { description?: string }> };

describe('the enableDashboard option', () => {
  it('is never read by the dashboard: not to build it, not to answer a request', async () => {
    const reads: string[] = [];
    const args = new Proxy({ ...DefaultPluginArgs, enableDashboard: false } as IPluginArgs, {
      get(target, key, receiver) {
        if (key === 'enableDashboard') reads.push(new Error().stack ?? '');
        return Reflect.get(target, key, receiver);
      },
    });
    const app = express();
    app.use('/xenon', createRouter(args));

    for (const url of ['/xenon/', '/xenon/sessions', '/xenon/api/health', '/xenon/api/session']) {
      await request(app).get(url);
    }

    expect(reads, reads.join('\n\n')).to.be.empty;
  });

  it('is described by what it does: records sessions, while the dashboard is always served', () => {
    const description = schema.properties.enableDashboard.description ?? '';
    expect(description).to.match(/^Keep a full record of each Appium session for the dashboard/);
    expect(description).to.match(/The dashboard itself is always served at \/xenon\//);
    expect(description).not.to.match(/Serve the React dashboard|Socket\.io/);
  });
});
