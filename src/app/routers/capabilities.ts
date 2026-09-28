import { Router } from 'express';
import { sessionTokenGateEnabled } from '../../services/sessionTokenGate';
import { commandAuthEnabled } from '../../middleware/commandAuth';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../../package.json');

export function buildCapabilities() {
  return {
    version: String(pkg.version),
    features: {
      bearerAuth: true,
      tokenIssuance: true,
      streamTickets: true,
      leases: true, // pre-existing: /sdk/leases
      eventLog: true, // Task 6
      projects: true, // Task 8
      mcpScopedTokens: true, // Tasks 1-3: granular-claim minting available
      sessionTokenGate: sessionTokenGateEnabled(), // Task 4: live XENON_REQUIRE_SESSION_TOKEN value
      // Live XENON_REQUIRE_COMMAND_AUTH value: when true, every WebDriver
      // session command must carry the x-xenon-* pair or a Bearer token.
      commandAuth: commandAuthEnabled(),
    },
  };
}

export function capabilitiesRouter(): Router {
  const r = Router();
  r.get('/', (_req, res) => res.json(buildCapabilities()));
  return r;
}
