import 'reflect-metadata';
import { expect } from 'chai';
import SwaggerParser from '@apidevtools/swagger-parser';
import { createRouter } from '../../src/app/index';
import { swaggerSpec } from '../../src/app/swagger';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import pkg from '../../package.json';
import { routesOf } from '../helpers/expressRoutes';

/**
 * The API reference at /xenon/api-docs is the spec in src/app/openapi/*.yaml.
 * It had drifted: 61 routes the server served were missing from it, 10 it
 * described were gone, and the page showed only 46 of its 100 paths,
 * because tsc dropped the JSDoc comments the spec was written in.
 *
 * These checks keep it whole: every route served under /xenon/api is
 * documented and every documented route is served, the spec is valid
 * OpenAPI 3, and each operation carries what a reader needs.
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

// Served but deliberately outside the API reference.
const NOT_API = new Set([
  'GET /xenon/*', // the dashboard's own pages (client-side routing)
  'GET /xenon/api-docs.json', // this spec itself
]);

/** "GET /xenon/api/control/:udid/tap" -> "GET /xenon/api/control/{}/tap" */
const shape = (route: string) =>
  route.replace(/:[A-Za-z_][\w]*/g, '{}').replace(/\{[^}]+\}/g, '{}');

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  responses?: Record<string, unknown>;
};

function operations(): Array<{ key: string; op: Operation }> {
  const out: Array<{ key: string; op: Operation }> = [];
  for (const [path, item] of Object.entries((swaggerSpec as any).paths ?? {})) {
    for (const method of METHODS) {
      const op = (item as Record<string, Operation>)[method];
      if (op) out.push({ key: `${method.toUpperCase()} /xenon${path}`, op });
    }
  }
  return out;
}

describe('the API reference (OpenAPI)', () => {
  // A hub's node-only routes (/api/node/sessions/...) exist only with `hub`.
  const served = new Set(
    [
      // The plugin mounts this router at /xenon.
      ...routesOf(
        createRouter({ ...DefaultPluginArgs, hub: 'http://hub.example:4723' } as any),
        '/xenon',
      ),
    ]
      .filter((r) => r.includes(' /xenon/') && !NOT_API.has(r))
      .map(shape),
  );
  const documented = new Set(operations().map(({ key }) => shape(key)));

  it('documents every route the server serves', () => {
    const missing = [...served].filter((r) => !documented.has(r)).sort();
    expect(missing, `served but not documented:\n  ${missing.join('\n  ')}`).to.deep.equal([]);
  });

  it('documents no route the server no longer serves', () => {
    const stale = [...documented].filter((r) => !served.has(r)).sort();
    expect(stale, `documented but not served:\n  ${stale.join('\n  ')}`).to.deep.equal([]);
  });

  it('is valid OpenAPI 3', async () => {
    await SwaggerParser.validate(JSON.parse(JSON.stringify(swaggerSpec)));
  });

  it("carries the package's version", () => {
    expect((swaggerSpec as any).info.version).to.equal(pkg.version);
  });

  it('gives every operation a summary, a description, a known tag and a unique id', () => {
    const tags = new Set(((swaggerSpec as any).tags ?? []).map((t: { name: string }) => t.name));
    const ids = new Map<string, string>();
    const problems: string[] = [];
    for (const { key, op } of operations()) {
      if (!op.summary) problems.push(`${key}: no summary`);
      if (!op.description) problems.push(`${key}: no description`);
      if (!op.tags?.length) problems.push(`${key}: no tag`);
      for (const t of op.tags ?? []) if (!tags.has(t)) problems.push(`${key}: unknown tag ${t}`);
      if (!op.operationId) problems.push(`${key}: no operationId`);
      else if (ids.has(op.operationId))
        problems.push(`${key}: operationId ${op.operationId} also on ${ids.get(op.operationId)}`);
      else ids.set(op.operationId, key);
      const codes = Object.keys(op.responses ?? {});
      if (!codes.some((c) => /^[23]\d\d$/.test(c) || c === '101'))
        problems.push(`${key}: no success response`);
      const isPublic = Array.isArray(op.security) && op.security.length === 0;
      if (!isPublic && !codes.includes('401')) problems.push(`${key}: authenticated but no 401`);
    }
    expect(problems, problems.join('\n')).to.deep.equal([]);
  });

  it('uses every tag it declares', () => {
    const used = new Set(operations().flatMap(({ op }) => op.tags ?? []));
    const unused = ((swaggerSpec as any).tags ?? [])
      .map((t: { name: string }) => t.name)
      .filter((t: string) => !used.has(t));
    expect(unused).to.deep.equal([]);
  });
});
