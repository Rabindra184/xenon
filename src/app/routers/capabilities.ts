import { Router } from 'express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../../package.json');

export function buildCapabilities() {
  return {
    version: String(pkg.version),
    features: {
      bearerAuth: true,
      tokenIssuance: true,
      streamTickets: true,
      leases: true,      // pre-existing: /sdk/leases
      eventLog: true,    // Task 6
      projects: true,    // Task 7
    },
  };
}

export function capabilitiesRouter(): Router {
  const r = Router();
  r.get('/', (_req, res) => res.json(buildCapabilities()));
  return r;
}
