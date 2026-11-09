import { Router } from 'express';
import { sessionTokenGateEnabled } from '../../services/sessionTokenGate';
import { commandAuthEnabled } from '../../middleware/commandAuth';
import { Container } from 'typedi';
import { PluginContext } from '../../PluginContext';
import { normalizeBasePath } from '../appiumBasePath';
import { config } from '../../config';
import { NODE_CREDENTIALS_MISSING, nodePhonesLeasable } from '../../services/lease/nodeCredentials';
import { HubSessionTokenIssuer } from '../../gateway/hubSessionToken';
import { tokenLogFilterOn } from '../../services/logging/tokenLogFilter';
import { currentAiRedaction } from '../../services/AIService';
import { describeAiRedaction } from '../../services/ai/aiRedaction';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../../package.json');

/**
 * Whether leases can take another server's (a node's) phone: this server's
 * own phones need no credentials (ownPorts.ts), a node's need the node
 * credentials unless sign-in is off. `reason` says what to set when not.
 */
function leasing(): { nodePhones: boolean; reason?: string } {
  return nodePhonesLeasable(config, Container.get(HubSessionTokenIssuer).canSign())
    ? { nodePhones: true }
    : { nodePhones: false, reason: NODE_CREDENTIALS_MISSING };
}

export function buildCapabilities() {
  return {
    version: String(pkg.version),
    // Where this server's WebDriver API lives ('' is the root), as
    // `GET /xenon/api/webdriver` answers it: a client needs only the host.
    webDriverBasePath: normalizeBasePath(Container.get(PluginContext).nodeBasePath),
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
      leasing: leasing(),
      // Whether Appium's log hides the tokens of a session create: the
      // server's log-filters rules hide token, sessionToken and leaseToken
      // (tokenLogFilter.ts). A client can't see Appium's log; this says
      // whether it may send them unmarked.
      tokenLogFilter: tokenLogFilterOn(),
      // What this server keeps from its AI provider (aiRedaction.ts): set
      // names, a rule count and the screenshot policy, never the patterns.
      aiRedaction: describeAiRedaction(currentAiRedaction()),
    },
  };
}

export function capabilitiesRouter(): Router {
  const r = Router();
  r.get('/', (_req, res) => res.json(buildCapabilities()));
  return r;
}
