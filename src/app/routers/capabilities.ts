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
import { TracingService } from '../../services/TracingService';
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
      // A session and its commands join the W3C trace context they are sent
      // with (inboundTrace.ts), in Xenon's spans when `exporting` and in its
      // command log either way. `forwardedCommands`: a hub makes the span of
      // each command it forwards to a node or a cloud provider
      // (forwardedCommandSpan.ts).
      traceContext: {
        accepted: true,
        exporting: Container.get(TracingService).exportsTraces(),
        forwardedCommands: true,
      },
      // An uploaded app named by id is handed to this server's phones' drivers
      // as the library's file, and a node keeps each build it fetches from its
      // hub (NodeAppCache): one transfer per build per host, not per session.
      appReuse: true,
      // A member uploads into their own teams with the `apps` scope, an iOS
      // app's bundle id, version and build are read, and `GET /apps?md5=`
      // looks a build up (ENH-16).
      ciAppStore: true,
      // Network profiles (ENH-20): changed during a session with `xenon:
      // setNetworkProfile`, and which profiles change the device's own
      // network on each platform: an Android emulator's traffic is shaped
      // through its console, a real Android phone's through a relay on this
      // machine its proxy points at (part 2), which shapes only traffic that
      // goes through the system proxy (`proxyShaped`); its radios switch for
      // Offline and Normal. An iPhone's commands are only delayed.
      networkProfiles: {
        midSession: true,
        appTraffic: {
          androidEmulator: ['Normal', '4G', '3G', 'Edge', 'Offline'],
          androidDevice: ['Normal', '4G', '3G', 'Edge', 'Offline'],
          ios: [] as string[],
        },
        proxyShaped: ['androidDevice'],
      },
      // Observer recordings (ENH-06): `POST /recordings` takes the caller's
      // own `sessionIds` and records those sessions' phones without holding
      // them; the group stops when the first of its sessions ends.
      recording: { observer: true },
    },
  };
}

export function capabilitiesRouter(): Router {
  const r = Router();
  r.get('/', (_req, res) => res.json(buildCapabilities()));
  return r;
}
