import { Container, Service } from 'typedi';
import { v4 as uuidv4 } from 'uuid';
import _ from 'lodash';
import { NotificationService, announce } from './NotificationService';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import log from '../logger';
import { stripAppiumPrefixes, nodeUrl } from '../helpers';
import { InternalHttpClient, InternalRequestConfig } from '../InternalHttpClient';
import { PluginContext } from '../PluginContext';
import { CapabilityValidator } from '../validators/CapabilityValidator';
import {
  claimDeviceForSession,
  releasePendingClaim,
  releaseSessionDevices,
  updateDeviceProgress,
} from '../data-service/device-service';
import {
  addNewPendingSession,
  removePendingSession,
} from '../data-service/pending-sessions-service';
import { allocateDeviceForSession } from '../device-utils';
import {
  CreateSessionResponseInternal,
  ISessionCapability,
  W3CNewSessionResponse,
  W3CNewSessionResponseError,
} from '../interfaces/ISessionCapability';
import { IDevice } from '../interfaces/IDevice';
import { TracingService } from './TracingService';
import { PortAllocator, createPortOwner } from './PortAllocator';
import {
  extractTeamCap,
  getXenonCapabilities,
  XENON_CAPABILITIES,
} from '../XenonCapabilityManager';
import { resolveSessionIdentity } from './session/sessionIdentity';
import { leaseIdOf, sessionLeaseIdOf } from './lease/leaseSessionCaps';
import { SessionCredentials, takeSessionCredentials } from './session/sessionCredentials';
import { capsForNode } from './session/nodeCreateCaps';
import { mergedFirstMatch, xenonOptionsOf } from './session/xenonOptions';
import { sessionTraceParent } from './tracing/inboundTrace';
import { BasicCredential, BasicCredentialRefused } from '../middleware/basicCredential';
import { canOverrideLease } from './device-access/leaseOverride';
import { computeTeamIds } from './device-access/callerTeamIds';
import { PendingRequester, REQUESTER_KEY } from './device-access/queueVisibility';
import { canSeeApp } from './device-access/appVisibility';
import { LiveSessionOwners } from './device-access/LiveSessionOwners';
import { forgetSessionMemory, tellRecordingsSessionEnded } from '../sessions/sessionMemory';
import { SessionMetricsService } from './metrics/SessionMetricsService';
import { SessionDeviceLogs } from './logcat/SessionDeviceLogs';
import {
  HUB_APP_OPTION,
  HubApp,
  appCapabilityOf,
  appDownloadUrl,
  parseXenonAppRef,
  readHubApp,
  setAppCapability,
  withAppCapability,
  withTicket,
  withoutQuery,
} from './session/appCapability';
import { NodeAppCache } from './apps/NodeAppCache';
import { CircuitBreaker } from '../data-service/CircuitBreaker';
import { nodeWebDriverUrl } from '../gateway/nodeWebDriverUrl';
import {
  HUB_TOKEN_HEADER,
  HubCreateGrant,
  HubSessionTokenIssuer,
} from '../gateway/hubSessionToken';
import { DeviceStoreFactory } from '../data-service/device-store';
import { PENDING_CLAIM_TIMEOUT_MS } from '../data-service/deviceClaims';
import { XenonSession, XenonSessionOptions } from '../sessions/XenonSession';
import { LocalSession } from '../sessions/LocalSession';
import { CloudSession } from '../sessions/CloudSession';
import { RemoteSession } from '../sessions/RemoteSession';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { DASHBORD_EVENT_MANAGER, storedSessionCapabilities } from '../dashboard/event-manager';
import { prisma } from '../prisma';
import { updateSessionDetails } from '../dashboard/services/session-service';
import { SessionStatus } from '../types/SessionStatus';
import SessionType from '../enums/SessionType';
import AsyncLock from 'async-lock';
import { errors as appiumErrors } from '@appium/base-driver';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import { PhoneNetworkRestore } from './network/PhoneNetworkRestore';
import { resolveInterceptorOptions } from './interceptor/interceptorOptions';

/** How a session that names a lease is judged. See leaseAccessFor. */
export interface LeaseAccess {
  /** May use a lease someone else created: canOverrideLease. */
  canOverride: boolean;
  /** The teams whose phones it can see, as REST computes them. undefined = unscoped. */
  teamIds: string[] | undefined;
}

/** The credential's owner, ACTIVE when it was verified a moment ago. */
interface CredentialOwner {
  id: string;
  role: string;
  status: string;
}

type LeaseCredential =
  | { kind: 'api-key'; scopes: string; user: CredentialOwner; teamId: string | null }
  | { kind: 'session-token'; scopes: string; user: CredentialOwner; teamId: string | null }
  | { kind: 'none' };

/**
 * A session token admits a session only with the `sessions` scope, as a key
 * pair does. Tokens minted before this check carry no `scopes` claim, and
 * POST /auth/token gave one to any credential, a read-only one included:
 * they are refused too.
 */
function sessionTokenGrantsSessions(scopes: unknown): boolean {
  if (typeof scopes !== 'string') return false;
  const owned = scopes.split(',').map((s) => s.trim());
  return owned.includes('sessions') || owned.includes('admin');
}

const SESSION_TOKEN_LACKS_SCOPE =
  'session rejected: xe:options.sessionToken carries no `sessions` scope; tokens minted by ' +
  'Xenon 2.14 or earlier carry none — mint a new one with POST /xenon/api/auth/token ' +
  '({"audience":"xenon-mcp"}) using a credential that has the `sessions` scope.';

/** Who a new session is for, and what it may use. See authorizeSessionRequest. */
interface AuthorizedSession {
  apiKeyId: string | null;
  userId: string | null;
  callerTeamIds: string[] | undefined;
  scoped: boolean;
  leaseAccess: () => Promise<LeaseAccess>;
  requester: PendingRequester;
}

/**
 * A phone allocated for a new session, between prepareSession and its
 * completion (completeLocalSession / completeRemoteSession) or release
 * (releaseAllocation).
 */
/** An uploaded app a session names by id, as this server stores it. */
export interface AppDownload {
  appId: string;
  /** Its download URL on this server, without a ticket. */
  url: string;
  /** Where this server keeps the file. */
  filepath?: string;
  /** What a node is told about it, when the app has an md5 to name it by. */
  hubApp?: HubApp;
}

export interface SessionAllocation {
  /** The capabilities it was allocated for, with the credentials already taken out. */
  caps: ISessionCapability;
  device: IDevice;
  /** Another server drives the phone: a Xenon node, or a cloud provider. */
  remote: boolean;
  /** The pending-session row, removed when the session is created or refused. */
  pendingSessionId: string;
  apiKeyId: string | null;
  userId: string | null;
  /** An uploaded app the session names by id, resolved to its download URL. */
  appDownload?: AppDownload;
  /**
   * On a node: the uploaded app its hub named for this create (`hubApp`),
   * which the node reuses when it already holds that build (NodeAppCache).
   */
  hubApp?: HubApp;
  /** When the phone was allocated, by this server's clock: the session's device log counts from then. */
  allocatedAt?: number;
}

/**
 * How long the hub waits for a node (or cloud provider) to create a session.
 * A create is sent once (InternalRequestConfig `retry: false`): the node may
 * still be creating when an ordinary request would give up, and a second
 * create starts a second session holding the phone. A first UiAutomator2 or
 * WebDriverAgent install takes minutes. It ends before the phone's pending
 * claim can expire (PENDING_CLAIM_TIMEOUT_MS), so the idle sweeper never frees
 * a phone whose create the hub is still waiting for.
 */
export const REMOTE_CREATE_TIMEOUT_MS = PENDING_CLAIM_TIMEOUT_MS - 2 * 60_000;

/**
 * A created session whose phone another session claimed meanwhile
 * (claimDeviceForSession answered false). The client gets `session not
 * created`, naming why.
 */
export class ClaimLost extends appiumErrors.SessionNotCreatedError {
  constructor(device: IDevice, sessionId: string) {
    super(
      `Session ${sessionId} was created on ${device.udid}, but the device was given to ` +
        'another session while it was being created (it took longer than ' +
        `${Math.round(PENDING_CLAIM_TIMEOUT_MS / 60_000)} minutes). The session was ended; ` +
        'please retry.',
    );
  }
}

const commandsQueueGuard = new AsyncLock();
// Serializes concurrent deleteSession cleanup for the same sessionId so
// that onSessionStopped events don't fire twice if two clients race.
const sessionCleanupLock = new AsyncLock();

@Service()
export class SessionLifecycleService {
  private logger = log.scope('SessionLifecycleService');

  /**
   * Create a session in one call: prepare it (allocate a phone), then
   * complete it here through `next` (a phone this server drives) or on the
   * phone's node (one another server drives).
   *
   * The session gateway runs the same steps with Appium's route between them
   * (gateway/sessionCreate.ts): it prepares, answers a remote phone itself,
   * and hands a local phone's allocation to XenonPlugin.createSession, which
   * completes it. The plugin calls this only for a create that did not come
   * through the gateway, with `localOnly`: a phone on another server is then
   * given back and refused, since answering for Appium without its driver is
   * what made Appium's umbrella fail (a 500 while the node kept the session).
   */
  async createSession(
    next: () => any,
    driver: any,
    caps: ISessionCapability,
    opts: { localOnly?: boolean } = {},
  ) {
    const allocation = await this.prepareSession(caps);
    if (!allocation.remote) return this.completeLocalSession(allocation, next, driver, caps);
    if (opts.localOnly) {
      await this.releaseAllocation(allocation);
      throw new appiumErrors.SessionNotCreatedError(
        `Device ${allocation.device.udid} is driven by another server ` +
          `(${allocation.device.host}). Xenon creates sessions there in its session gateway, ` +
          'which did not handle this request; the device was released.',
      );
    }
    return this.completeRemoteSession(allocation);
  }

  /**
   * The first half of a create: everything up to and including allocating a
   * phone. It takes the credentials out of `caps` (in place) before anything
   * reads them, checks them (or the hub's grant), validates the capabilities,
   * resolves an uploaded app, writes the pending-session row and allocates.
   * Throws to refuse, leaving no pending row and no busy phone.
   *
   * `hubGrant` is the verified grant of a create the hub forwarded (a node
   * only; gateway/sessionCreate.ts). Each instance has its own database, so a
   * node can't check the client's key: the hub checked it, applied the team
   * rule and the session-token gate, and resolved any lease. The grant is
   * then the session's credential: it names the owner, and the one phone on
   * this node the create may have.
   *
   * What it returns must be completed (completeLocalSession /
   * completeRemoteSession) or released (releaseAllocation).
   */
  async prepareSession(
    caps: ISessionCapability,
    opts: { hubGrant?: HubCreateGrant; basic?: BasicCredential } = {},
  ): Promise<SessionAllocation> {
    // Fail fast during graceful shutdown so clients get a clear error instead
    // of their request hanging until the process dies. Lazy import to avoid
    // a cycle (ShutdownCoordinator -> SessionLifecycleService -> this file).
    const { ShutdownCoordinator } = await import('./ShutdownCoordinator');
    if (Container.get(ShutdownCoordinator).isDraining) {
      this.logger.warn('Rejecting new session: hub is draining for shutdown');
      throw new Error('Hub is shutting down; please retry against a different node');
    }

    // The credentials in xe:options (the access key and token, the session
    // token, the lease token) are bearer secrets. Take them out of the caps
    // before anything reads them — the pending-session row, allocation, the
    // driver, the Session row, the dashboard, the logs — and hand them only to
    // the checks that need them.
    const credentials = takeSessionCredentials(caps);
    // The hub URL's key pair (Authorization: Basic), taken off the request by
    // the gateway's create layer. Never on a create from a hub, whose own
    // token vouches for it.
    if (opts.basic && !opts.hubGrant) credentials.basic = opts.basic;

    const { hubGrant } = opts;
    await this.assertCreateCameFromHub(hubGrant);
    if (hubGrant) this.assertGrantNamesCapsPhone(caps, hubGrant);
    const authResult = hubGrant
      ? this.authorizeHubGrant(hubGrant)
      : await this.authorizeSessionRequest(caps, credentials);

    const context = Container.get(PluginContext);
    const pluginArgs = context.pluginArgs;

    this.logger.debug(`📱 pluginArgs: ${JSON.stringify(pluginArgs)}`);
    this.logger.debug(`Receiving session request at host: ${pluginArgs.bindHostOrIp}`);

    const pendingSessionId = uuidv4();
    this.logger.debug(`📱 Creating temporary session capability_id: ${pendingSessionId}`);

    const { alwaysMatch: requiredCaps = {}, firstMatch: allFirstMatchCaps = [{}] } = caps;

    const strippedRequiredCaps = stripAppiumPrefixes(requiredCaps);
    const strippedFirstMatchCaps = stripAppiumPrefixes(allFirstMatchCaps[0]);

    try {
      const mergedCaps = Object.assign({}, strippedFirstMatchCaps, strippedRequiredCaps);
      Container.get(CapabilityValidator).validate(mergedCaps);
    } catch (err: any) {
      this.logger.error(`❌ Session validation failed: ${err.message}`);
      throw err;
    }

    // How a session that names a lease may use it. The lookup behind it ran
    // once, in authorizeSessionRequest, for any credentialed session. Before
    // the pending row is written, so a failure here leaves none behind.
    const leaseAccess = leaseIdOf(caps) ? await authResult.leaseAccess() : undefined;

    // The teams this session sees: the phones it may be allocated and the
    // uploaded apps it may name by id, by one rule. A leased phone is held to
    // the REST team rule, so a phone a caller could lease is one their
    // session can use; any other allocation keeps the session's own scoping.
    const sessionTeamIds = leaseAccess
      ? leaseAccess.teamIds
      : authResult.scoped
        ? authResult.callerTeamIds
        : undefined;

    // An app from the library, named by its id or as `xenon://<id>`
    // (parseXenonAppRef); a URL or a path goes to the driver as it is.
    const appId = parseXenonAppRef(strippedRequiredCaps['app'] || strippedFirstMatchCaps['app']);
    const appDownload = appId
      ? await this.resolveAppId(caps, appId, sessionTeamIds, pluginArgs.bindHostOrIp, context.port)
      : undefined;

    const firstMatch =
      Array.isArray(caps.firstMatch) && caps.firstMatch.length > 0 ? caps.firstMatch[0] : {};

    await addNewPendingSession({
      ...Object.assign({}, firstMatch, caps.alwaysMatch),
      capability_id: pendingSessionId,
      createdAt: new Date().getTime(),
      // Who asked, for the queue's team scoping (queueVisibility). On this row
      // only, never in `caps`, and last so a client can't supply its own.
      [REQUESTER_KEY]: authResult.requester,
    });

    const allocate = async (): Promise<IDevice> => {
      try {
        return await allocateDeviceForSession(
          caps,
          pluginArgs.deviceAvailabilityTimeoutMs,
          pluginArgs.deviceAvailabilityQueryIntervalMs,
          pluginArgs,
          sessionTeamIds,
          {
            canOverride: leaseAccess?.canOverride ?? false,
            apiKeyId: authResult.apiKeyId,
            userId: authResult.userId,
            leaseToken: credentials.leaseToken,
          },
        );
      } catch (err) {
        await removePendingSession(pendingSessionId);
        throw err;
      }
    };

    // Creates for a platform queue on one lock, first come first served, and
    // each has its full deviceAvailabilityTimeoutMs from the head of the
    // queue. A lease-bound session allocates nothing (its phone is the
    // lease's) and doesn't queue: behind the lock it waited for every create
    // ahead of it, each of which may wait minutes for a busy phone.
    let device: IDevice;
    if (leaseIdOf(caps)) {
      device = await allocate();
    } else {
      const lockName = this.getLockName(caps);
      this.logger.debug(`📱 Acquiring lock: ${lockName}`);
      device = await commandsQueueGuard.acquire(lockName, allocate);
    }

    await updateDeviceProgress(device.udid, device.host, 'Allocating node resources...');

    this.logger.debug(
      `device.host: ${device.host} and pluginArgs.bindHostOrIp: ${pluginArgs.bindHostOrIp}`,
    );

    const allocation: SessionAllocation = {
      caps,
      device,
      remote: !device.nodeId || device.nodeId !== context.nodeId,
      pendingSessionId,
      apiKeyId: authResult.apiKeyId,
      userId: authResult.userId,
      appDownload,
      hubApp: this.hubAppFor(caps, hubGrant),
      allocatedAt: Date.now(),
    };

    // The grant opens one phone, on this node. A token taken to another node
    // (an emulator's udid repeats across machines), or naming a phone this
    // node does not drive, is refused, and the phone given back.
    if (
      hubGrant &&
      (allocation.remote || device.udid !== hubGrant.udid || device.host !== hubGrant.host)
    ) {
      await this.releaseAllocation(allocation);
      this.logger.error(
        `❌ Rejecting session: the hub's token is for ${hubGrant.udid} at ${hubGrant.host}, ` +
          `and this node allocated ${device.udid} at ${device.host}`,
      );
      throw new appiumErrors.InvalidArgumentError(
        "session rejected: the hub's token for this session names another device",
      );
    }
    return allocation;
  }

  /**
   * Complete a create on the phone's node (or cloud provider), and record the
   * session here. On failure the phone is released and the error thrown.
   */
  async completeRemoteSession(
    allocation: SessionAllocation,
  ): Promise<CreateSessionResponseInternal | W3CNewSessionResponseError | Error> {
    const { device, caps, appDownload } = allocation;
    let session: CreateSessionResponseInternal | W3CNewSessionResponseError | Error;
    try {
      this.logger.debug(`📱 Forwarding session request to ${device.host}`);
      await updateDeviceProgress(device.udid, device.host, 'Forwarding to remote node...');
      // A peer Xenon node gets a create that stands on its own (capsForNode:
      // no credentials, no lease id, the phone pinned), with the hub's token
      // naming the owner this hub verified, since it can't check the client's
      // key in its own database. A cloud provider is not a Xenon node: it
      // gets the caps without the credentials, and no token.
      const isPeerNode = !device.cloud && !!device.nodeId;
      const forwardCaps = isPeerNode ? capsForNode(caps, device.udid, appDownload?.hubApp) : caps;
      const hubToken = isPeerNode
        ? await Container.get(HubSessionTokenIssuer).createTokenFor({
            userId: allocation.userId,
            udid: device.udid,
            host: device.host,
          })
        : null;
      // The node's driver downloads the app from this hub, so the copy it
      // is sent carries the ticket; `caps` keeps the plain URL.
      session = await this.forwardSessionRequest(
        device,
        appDownload
          ? withAppCapability(forwardCaps, await this.driverAppUrl(appDownload))
          : forwardCaps,
        hubToken,
      );
    } catch (err: any) {
      await this.failedCreate(allocation, err);
      throw err;
    }
    return this.finishCreate(allocation, session, undefined);
  }

  /**
   * Complete a create on a phone this server drives: `next` is Appium's own
   * createSession, and `caps` the capabilities its driver reads. On failure
   * the phone is released and the error thrown.
   */
  async completeLocalSession(
    allocation: SessionAllocation,
    next: () => any,
    driver: any,
    caps: ISessionCapability,
  ) {
    const { device, appDownload, hubApp } = allocation;
    let session: CreateSessionResponseInternal | W3CNewSessionResponseError | Error;
    try {
      this.logger.debug('📱 Creating session on the same node');
      await this.handleLocalWDAProvisioning(device, caps);

      await updateDeviceProgress(device.udid, device.host, 'Finalizing session bootstrap...');
      // The driver reads these same caps while it starts, so the app it is
      // handed (the library's file, or a URL with a ticket) is in them for
      // this call only; what is kept afterwards is the plain URL.
      const hubUrl = hubApp && !appDownload ? appCapabilityOf(caps) : undefined;
      if (appDownload) setAppCapability(caps, await this.driverAppSource(appDownload));
      else if (hubApp) {
        const file = await this.nodeAppSource(caps, hubApp);
        if (file) setAppCapability(caps, file);
      }
      try {
        session = await next();
      } finally {
        if (appDownload) setAppCapability(caps, appDownload.url);
        else if (hubUrl) setAppCapability(caps, withoutQuery(hubUrl));
      }
    } catch (err: any) {
      await this.failedCreate(allocation, err);
      throw err;
    }
    return this.finishCreate({ ...allocation, caps }, session, driver);
  }

  /**
   * Give back a phone allocated for a session that was never created: its
   * pending-session row goes and the phone is free again. Only the claim this
   * allocation took is released: if it timed out and the phone went on to
   * another session, that session keeps it. Never throws.
   */
  async releaseAllocation(allocation: SessionAllocation): Promise<void> {
    const { device } = allocation;
    try {
      await removePendingSession(allocation.pendingSessionId);
      await releasePendingClaim(device);
      await this.releaseCreatePorts(device);
      await updateDeviceProgress(device.udid, device.host, '');
    } catch (cleanupErr: any) {
      this.logger.warn(
        `Cleanup after failed session creation had issues: ${cleanupErr?.message ?? cleanupErr}`,
      );
    }
  }

  // A THROWN error from the driver's createSession (next()) or the remote
  // forward leaves the device locked: allocation already set busy=true, and
  // on the throw path neither finalizeSession nor handleSessionFailure runs,
  // so without this the device gets stuck busy with no session. (finishCreate
  // covers the separate case where next() RETURNS a W3C error object rather
  // than throwing.)
  private async failedCreate(allocation: SessionAllocation, err: any): Promise<void> {
    const { device } = allocation;
    this.logger.error(
      `❌ Session creation failed for device ${device.udid}: ${err?.message ?? err}. Unblocking device.`,
    );
    await this.releaseAllocation(allocation);
    if (allocation.remote) {
      (Container.get(CircuitBreaker) as CircuitBreaker).recordFailure(device.host);
    }
  }

  private async finishCreate(
    allocation: SessionAllocation,
    session: CreateSessionResponseInternal | W3CNewSessionResponseError | Error,
    driver: any,
  ) {
    const { device, caps, remote } = allocation;
    this.logger.debug('📱 Session response: ', JSON.stringify(session));
    this.logger.debug(
      `📱 Removing pending session with capability_id: ${allocation.pendingSessionId}`,
    );
    await removePendingSession(allocation.pendingSessionId);

    if (this.isCreateSessionResponseInternal(session)) {
      try {
        await this.finalizeSession(
          session,
          device,
          caps,
          driver,
          remote,
          allocation.apiKeyId,
          allocation.userId,
          allocation.allocatedAt,
        );
      } catch (err: any) {
        if (remote) throw err;
        await this.undoLocalCreate(allocation, session.value[0], driver, err);
        throw err instanceof appiumErrors.SessionNotCreatedError
          ? err
          : new appiumErrors.SessionNotCreatedError(
              `Xenon could not finish creating the session on ${device.udid}: ` +
                `${err?.message ?? err}. The session was ended.`,
            );
      }
    } else {
      await this.handleSessionFailure(session, device, remote);
    }

    return session;
  }

  /**
   * Undo a local create that Appium's driver finished and Xenon couldn't: a
   * lost claim (ClaimLost), or a throw anywhere after `next()` (the row write,
   * the session's network). Through 2.36 neither was undone: the driver's
   * session ran on, a lost claim's on a phone given to another session, and
   * a throw left it half registered (its claim held, its owner recorded, its
   * samplers running, maybe in SESSION_MANAGER with no row). Each step on its
   * own; none throws. Only what is this create's is released: the session's
   * claim, by its id, or the pending claim it was allocated with, never one
   * another session holds now.
   */
  private async undoLocalCreate(
    allocation: SessionAllocation,
    sessionId: string,
    driver: any,
    cause: any,
  ): Promise<void> {
    const { device } = allocation;
    const reason = `Xenon could not finish creating the session: ${cause?.message ?? cause}`;
    const step = async (what: string, fn: () => unknown) => {
      try {
        await fn();
      } catch (err: any) {
        this.logger.warn(`Undoing session ${sessionId}: ${what} failed: ${err?.message ?? err}`);
      }
    };
    this.logger.error(`❌ ${reason}. Ending session ${sessionId} on ${device.udid}.`);

    const registered = SESSION_MANAGER.getSession(sessionId);
    if (registered?.isVideoRecordingInProgress()) {
      await step('stopping the video', () => registered.stopVideoRecording());
    }
    // The driver's session, through the umbrella, which Appium hands a
    // plugin's createSession as its `driver`: nothing goes through the
    // plugins again. Appium answers a failed delete rather than throw.
    await step('ending the driver session', async () => {
      if (typeof driver?.deleteSession !== 'function') {
        throw new Error('no driver to end it with');
      }
      const answer = await driver.deleteSession(sessionId);
      if (answer?.error) throw answer.error;
    });
    await step("putting the phone's network back", () =>
      Container.get(PhoneNetworkRestore).restoreSession(sessionId, 'session not created'),
    );
    if (registered) {
      // A row the dashboard wrote is closed, with no webhook: no test ran.
      await step('closing its record', () =>
        DASHBORD_EVENT_MANAGER.onSessionStopped(sessionId, SessionStatus.FAILED, reason, {
          notify: false,
        }),
      );
      SESSION_MANAGER.removeSession(sessionId);
    }
    Container.get(LiveSessionOwners).forget(sessionId);
    forgetSessionMemory(sessionId);
    await step('stopping its samplers', async () => {
      await Container.get(SessionMetricsService).stop(sessionId);
      await Container.get(SessionDeviceLogs).stop(sessionId);
    });
    await step('releasing its ports', () =>
      Container.get(PortAllocator).releaseForSession(sessionId),
    );
    await step('releasing its claim', async () => {
      await releaseSessionDevices(sessionId);
      await releasePendingClaim(device);
      await this.releaseCreatePorts(device);
    });
    if (!(cause instanceof ClaimLost)) {
      await step('clearing its progress', () => updateDeviceProgress(device.udid, device.host, ''));
    }
  }

  /** The ports this create leased for its session (createPortOwner), before it had one. */
  private async releaseCreatePorts(device: IDevice): Promise<void> {
    const owner = createPortOwner(device);
    if (owner) await Container.get(PortAllocator).releaseOwnedBy(owner);
  }

  /**
   * Sessions on a node's phones go through its hub, which owns their team
   * rules, reservations and blocks and is where auth is enforced. So a node
   * (a server with `hub`) refuses a create that doesn't carry the hub's
   * verified grant: one sent to the node directly, or one that reached the
   * plugin without the session gateway, which is where the grant is checked.
   *
   * Only with auth enabled. With auth disabled a node checks no credential,
   * the hub's token included (sessionCreate.ts), so a create from the hub and
   * one sent directly look alike, and refusing would protect nothing while
   * breaking what such a node is used for: running a driver on it directly
   * during local development. It works there as it always has.
   */
  private async assertCreateCameFromHub(hubGrant: HubCreateGrant | undefined): Promise<void> {
    const { hub } = Container.get(PluginContext).pluginArgs;
    if (hub === undefined || hubGrant) return;
    const { config: xenonConfig } = await import('../config');
    if (xenonConfig.authDisabled === true) return;
    this.logger.warn(
      `Refusing a session created directly on this node: it carries no grant from the hub (${hub}).`,
    );
    throw new appiumErrors.SessionNotCreatedError(
      `This server is a node of the Xenon hub at ${hub}. Create sessions through the hub: ` +
        'it applies the team rules, reservations and blocks for this node’s devices, and a ' +
        'node refuses a session that does not come from it.',
    );
  }

  /**
   * A grant is for the phone the hub pinned in the caps it forwarded
   * (capsForNode). Caps that name another one, or a list to pick from, are
   * not a create the hub sent: refused before anything is allocated.
   */
  private assertGrantNamesCapsPhone(caps: ISessionCapability, grant: HubCreateGrant): void {
    const merged = mergedFirstMatch(caps);
    if (merged['appium:udid'] === grant.udid && merged['appium:udids'] === undefined) return;
    this.logger.error(
      `❌ Rejecting session: the hub's token is for ${grant.udid}, and the capabilities name ` +
        `${merged['appium:udids'] ?? merged['appium:udid'] ?? 'no device'}`,
    );
    throw new appiumErrors.InvalidArgumentError(
      "session rejected: the hub's token for this session names another device",
    );
  }

  /**
   * The session's identity when the hub forwarded the create with its grant:
   * the owner the hub verified, unscoped (the hub applied the team rule), and
   * no lease override (the hub resolved the lease).
   */
  private authorizeHubGrant(grant: HubCreateGrant): AuthorizedSession {
    return {
      apiKeyId: null,
      userId: grant.userId,
      callerTeamIds: undefined,
      scoped: false,
      leaseAccess: async () => ({ canOverride: false, teamIds: undefined }),
      requester: { userId: grant.userId, teamId: null },
    };
  }

  /**
   * Resolves an uploaded-app id the session names to its plain download URL,
   * written into `caps` in place, when the session may see the app (by
   * `teamIds`, as its phone is allocated). An unknown app and one on a team
   * the session can't see are treated alike: `caps` is left as the client
   * sent it, so the driver fails the session the same way for both, as it
   * always has for an unknown id.
   */
  private async resolveAppId(
    caps: ISessionCapability,
    appId: string,
    teamIds: string[] | undefined,
    host: string,
    port: number,
  ): Promise<AppDownload | undefined> {
    const { APP_SERVICE } = await import('../dashboard/services/app-service');
    const found = await APP_SERVICE.getAppById(appId);
    if (!found || !canSeeApp(found, teamIds)) {
      this.logger.info(
        `📱 App id ${appId} is not an app this session can see; passing it to the driver as given`,
      );
      return undefined;
    }
    const url = appDownloadUrl(host, port, found.id);
    this.logger.info(`📱 Resolved app ID ${appId} to ${url}`);
    setAppCapability(caps, url);
    const extension = path.extname(found.filepath ?? '').toLowerCase();
    const hubApp = readHubApp({ id: found.id, md5: found.md5, size: found.size, extension });
    return { appId: found.id, url, filepath: found.filepath, ...(hubApp ? { hubApp } : {}) };
  }

  /**
   * What the driver of this server's own phone is handed for an uploaded app
   * (ENH-19): the library's file itself, so nothing is downloaded and no
   * ticket is minted. Through 2.25 the driver got a download URL with a new
   * single-use ticket each time, and Appium, which caches downloads by the
   * whole URL, downloaded the build again for every session. A file that
   * isn't here (an App row another server wrote) gets the URL, as before.
   */
  private async driverAppSource(appDownload: AppDownload): Promise<string> {
    if (appDownload.filepath) {
      const stat = await fs.promises.stat(appDownload.filepath).catch(() => undefined);
      if (stat?.isFile()) {
        this.logger.info(`📱 Handing the driver app ${appDownload.appId} from the library`);
        return appDownload.filepath;
      }
    }
    return this.driverAppUrl(appDownload);
  }

  /**
   * On a node, the `hubApp` its hub sent with this create, if this node may
   * take it: only on a create the hub's token vouched for, or with sign-in
   * off, where no create is checked. It names a file the node may hand a
   * driver, so a create from anyone else can't choose one.
   */
  private hubAppFor(caps: ISessionCapability, hubGrant?: HubCreateGrant): HubApp | undefined {
    if (!hubGrant && config.authDisabled !== true) return undefined;
    return readHubApp(xenonOptionsOf(caps)[HUB_APP_OPTION]);
  }

  /**
   * On a node: the build its hub named, from this node's own copy, fetched
   * from the hub's URL (with this session's ticket) the first time
   * (NodeAppCache). The URL must be the app capability the hub sent.
   */
  private async nodeAppSource(
    caps: ISessionCapability,
    hubApp: HubApp,
  ): Promise<string | undefined> {
    const url = appCapabilityOf(caps);
    if (!url || !/^https?:\/\//i.test(url)) return undefined;
    return Container.get(NodeAppCache).fileFor(url, hubApp);
  }

  /**
   * The app URL to hand the driver: with auth on, the plain URL plus a
   * single-use ticket for that app, minted now so it is live only while the
   * driver starts. Xenon never logs or stores it; Appium's own request log
   * and the driver print the URL, by which time the ticket is spent.
   */
  private async driverAppUrl(appDownload: { appId: string; url: string }): Promise<string> {
    const { config: xenonConfig } = await import('../config');
    // Auth off: the route needs no login, and a stable URL lets the driver
    // reuse its cached download.
    if (xenonConfig.authDisabled === true) return appDownload.url;
    try {
      const { AppDownloadTicketService } = await import('./token/AppDownloadTicketService');
      const ticket = await Container.get(AppDownloadTicketService).mint(appDownload.appId);
      return withTicket(appDownload.url, ticket);
    } catch (err: any) {
      throw new Error(
        `Cannot prepare the download of app ${appDownload.appId}: ${err?.message ?? err}`,
      );
    }
  }

  // Verify a WebDriver session request against the credentials createSession
  // took out of `xe:options` (or its `xenon:options` alias): an access-key +
  // token pair, or a session token. Today this is best-effort: if none is
  // supplied we log a warning and let the request through to avoid breaking
  // pre-existing test clients, unless XENON_REQUIRE_SESSION_TOKEN is on.
  // Credentials that don't verify — a wrong, revoked or expired key or token,
  // or one whose user is deleted or not ACTIVE — count as none. Credentials
  // that verify without the `sessions` scope are rejected. Respects the
  // global `authDisabled` flag.
  //
  // Returns the caller's { apiKeyId, callerTeamIds } so allocation can filter
  // devices, and app resolution uploaded apps, by team. `apiKeyId` is null
  // when auth is disabled or no key was presented (back-compat path).
  // `callerTeamIds` is REST's computeTeamIds for the caller: undefined for an
  // ADMIN or SUPER_ADMIN owner (and an admin-scoped key), the key's or the
  // session token's team when it is narrowed to one, and otherwise the
  // member's teams, empty when they are in none (the shared pool only).
  //
  // `leaseAccess` says how the session is judged if it names a lease. It is a
  // function so the lookups behind it run only for such a session. Whether it
  // may override is not `!scoped`: a credential-less session is unscoped too.
  //
  // `requester` is who asked, for the queue: the user and the one team the
  // credential is narrowed to, from what is in hand here, with no lookup.
  private async authorizeSessionRequest(
    caps: ISessionCapability,
    credentials: SessionCredentials,
  ): Promise<AuthorizedSession> {
    const { config: xenonConfig } = await import('../config');
    // `scoped` tells the allocator whether to restrict device candidates by
    // team. False = see everything (admin, authDisabled, back-compat path);
    // true = filter to { null, ...callerTeamIds }; when callerTeamIds is
    // empty, only the shared pool is visible.
    if (xenonConfig.authDisabled === true) {
      // Every caller is a synthetic SUPER_ADMIN here, as in authMiddleware.
      return {
        apiKeyId: null,
        userId: null,
        callerTeamIds: undefined,
        scoped: false,
        leaseAccess: async () => ({
          canOverride: canOverrideLease({ kind: 'auth-disabled' }),
          teamIds: undefined,
        }),
        requester: { userId: null, teamId: null },
      };
    }

    const { ApiKeyService } = await import('./ApiKeyService');
    const svc = Container.get(ApiKeyService);
    const { verifyKeyPairCredential, verifySessionTokenCredential, isWrongSessionToken } =
      await import('../middleware/verifyCredential');

    // xe:options.{accessKey, token} — the only key-pair credential shape.
    // Checked by REST's rule (verifyKeyPairCredential): a live key whose owner
    // exists and is ACTIVE. The key alone (verifyPair) let a user set to
    // Inactive, or deleted, keep creating sessions as themselves. The owner
    // found here is the one lookup the session's scope and lease use.
    // The hub URL's key pair (Authorization: Basic) when xe:options has none:
    // the first credential present decides. Unlike a wrong xe:options pair,
    // which is ignored, a Basic credential that can't be read or doesn't
    // verify refuses the create with 401 (BasicCredentialRefused): a client
    // that put a key in its hub URL meant it to be used.
    const basic = credentials.pair ? undefined : credentials.basic;
    if (basic?.kind === 'unreadable') throw new BasicCredentialRefused('unreadable');
    const pair =
      credentials.pair ??
      (basic?.kind === 'pair' ? { accessKey: basic.accessKey, token: basic.token } : undefined);
    const verifiedPair = pair ? await verifyKeyPairCredential(pair.accessKey, pair.token) : null;
    if (basic?.kind === 'pair' && !verifiedPair) {
      this.logger.warn('Rejecting session: the key pair in the hub URL is not valid');
      throw new BasicCredentialRefused('invalid');
    }

    // The session token, verified once for both the gate and attribution, by
    // REST's rule too: a live signature and an ACTIVE subject, looked up now.
    let tokenCheck: ReturnType<typeof verifySessionTokenCredential> | undefined;
    const verifyToken = (t: string) => {
      if (!tokenCheck) tokenCheck = verifySessionTokenCredential(t);
      return tokenCheck;
    };
    // Both readers below treat any failure as a token that doesn't check out:
    // the gate refuses it as "invalid or expired", attribution ignores it. A
    // check that could not run (the database or the signing key unavailable)
    // is not that: it refuses the create here, as a key whose owner can't be
    // looked up does, rather than run the session with no owner.
    if (!verifiedPair && credentials.sessionToken) {
      await verifyToken(credentials.sessionToken).catch((err: unknown) => {
        if (!isWrongSessionToken(err)) throw err;
      });
    }

    const { assertSessionTokenGate, sessionTokenGateEnabled } = await import('./sessionTokenGate');
    try {
      await assertSessionTokenGate({
        enabled: sessionTokenGateEnabled(),
        hasValidKeyPair: !!verifiedPair,
        token: credentials.sessionToken,
        verify: verifyToken,
      });
    } catch (err: any) {
      this.logger.error(`❌ ${err.message}`);
      throw new appiumErrors.InvalidArgumentError(err.message);
    }

    if (!verifiedPair) {
      // No key pair. An xe:options.sessionToken still identifies the caller,
      // so read it for attribution even when the gate is off — otherwise the
      // ownership guard fails closed on a session whose owner we actually know.
      // Enforcement is assertSessionTokenGate's job and is unchanged.
      // The token's teamId claim narrows it the way a key's team does; kept
      // from the one verify rather than verifying again.
      let tokenTeamId: string | null = null;
      let tokenScopes: unknown;
      let tokenOwner: CredentialOwner | undefined;
      const identity = await resolveSessionIdentity({
        row: null,
        sessionToken: credentials.sessionToken,
        verify: async (t) => {
          const { payload, user } = await verifyToken(t);
          tokenTeamId = typeof payload?.teamId === 'string' ? payload.teamId : null;
          tokenScopes = payload?.scopes;
          tokenOwner = user;
          return payload;
        },
      });
      // A token that names its owner may create sessions only with the
      // `sessions` scope, as a key pair may: refused, like a key without it.
      if (identity.userId && !sessionTokenGrantsSessions(tokenScopes)) {
        this.logger.error('Rejecting session: xe:options.sessionToken lacks the `sessions` scope');
        throw new appiumErrors.InvalidArgumentError(SESSION_TOKEN_LACKS_SCOPE);
      }
      if (!identity.userId) {
        this.logger.warn(
          'Session created without valid credentials. Pass `xe:options.accessKey` + ' +
            '`xe:options.token`, or `xe:options.sessionToken`.',
        );
      }
      const leaseAccess = this.leaseAccessFor(
        identity.userId && tokenOwner
          ? {
              kind: 'session-token',
              scopes: String(tokenScopes),
              user: tokenOwner,
              teamId: tokenTeamId,
            }
          : { kind: 'none' },
      );
      // A token's user is scoped as REST scopes them. No credentials at all
      // stays unscoped (the back-compat path), with no lookup.
      const callerTeamIds = identity.userId ? (await leaseAccess()).teamIds : undefined;
      return {
        ...identity,
        callerTeamIds,
        scoped: callerTeamIds !== undefined,
        leaseAccess,
        requester: {
          userId: identity.userId,
          teamId: identity.userId ? tokenTeamId : null,
        },
      };
    }
    const { row, user: owner } = verifiedPair;
    if (!svc.hasScope(row, ['sessions'])) {
      this.logger.error('Rejecting session: credentials lack the `sessions` scope');
      throw new appiumErrors.InvalidArgumentError(
        'credentials are invalid, revoked, or lack the `sessions` scope',
      );
    }

    const isAdmin = svc.hasScope(row, ['admin']);
    const leaseAccess = this.leaseAccessFor({
      kind: 'api-key',
      scopes: row.scopes,
      user: owner,
      teamId: row.teamId ?? null,
    });
    // The phones and apps this session may use: REST's rule
    // (computeTeamIds on the owner's live role, narrowed by the key's team),
    // looked up once through leaseAccess. An admin-scoped key is unscoped.
    const callerTeamIds = isAdmin ? undefined : (await leaseAccess()).teamIds;

    const requestedTeam = extractTeamCap(caps);
    if (requestedTeam) {
      if (callerTeamIds !== undefined && !callerTeamIds.includes(requestedTeam)) {
        this.logger.error(
          `Rejecting session: xe:options.team=${requestedTeam} is not one of the caller's teams (${callerTeamIds.join(', ') || 'shared pool only'})`,
        );
        throw new appiumErrors.InvalidArgumentError(
          `xe:options.team '${requestedTeam}' is not allowed for this API key`,
        );
      }
      return {
        apiKeyId: row.id,
        userId: row.userId,
        callerTeamIds: [requestedTeam],
        scoped: !isAdmin,
        leaseAccess,
        requester: { userId: row.userId, teamId: requestedTeam },
      };
    }

    return {
      apiKeyId: row.id,
      userId: row.userId,
      callerTeamIds,
      scoped: callerTeamIds !== undefined,
      leaseAccess,
      requester: { userId: row.userId, teamId: row.teamId ?? null },
    };
  }

  // How a session that names a lease is judged, looked up at most once and
  // only when asked. Who may override follows canOverrideLease; which phones
  // it can see follows REST's computeTeamIds. Both need the owner's live role,
  // as authMiddleware reads it for every REST request: the owner the
  // credential check looked up a moment ago, ACTIVE then.
  private leaseAccessFor(credential: LeaseCredential): () => Promise<LeaseAccess> {
    let looked: Promise<LeaseAccess> | undefined;
    return () => {
      if (!looked) looked = this.lookUpLeaseAccess(credential);
      return looked;
    };
  }

  private async lookUpLeaseAccess(credential: LeaseCredential): Promise<LeaseAccess> {
    // No credentials: the lease token is the only way in. Unscoped, as a
    // credential-less session is for any other allocation.
    if (credential.kind === 'none') {
      return { canOverride: canOverrideLease({ kind: 'none' }), teamIds: undefined };
    }
    const { user } = credential;
    try {
      const canOverride = canOverrideLease({
        kind: credential.kind,
        scopes: credential.scopes,
        user,
      });
      const role = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' ? user.role : 'MEMBER';
      const teamIds = await computeTeamIds({
        role,
        userId: user.id,
        apiKeyTeamId: credential.teamId,
      });
      return { canOverride, teamIds };
    } catch (err: any) {
      // Fail closed: no override, and the shared pool only.
      this.logger.warn(
        `Could not look up how user ${user.id} may use a lease: ${err?.message ?? err}`,
      );
      return { canOverride: false, teamIds: [] };
    }
  }

  private async handleLocalWDAProvisioning(device: IDevice, caps: ISessionCapability) {
    if (device.platform === 'ios' && device.realDevice) {
      const { APP_SERVICE } = await import('../dashboard/services/app-service');
      const wdaApp = await APP_SERVICE.getWDAApp();
      const { default: IOSStreamService } = await import('../device-managers/ios/IOSStreamService');
      const streamService = Container.get(IOSStreamService);
      const streamStatus = streamService.getStreamStatus(device.udid);
      const isWdaActive =
        streamStatus && (streamStatus.status === 'running' || streamStatus.status === 'starting');

      if (!isWdaActive && wdaApp && (await import('fs-extra')).existsSync(wdaApp.filepath)) {
        this.logger.info(`📱 Artisan WDA: Signed artifact found for ${device.udid}`);
        await updateDeviceProgress(device.udid, device.host, 'Provisioning WDA artifact...');

        if (device.derivedDataPath) {
          try {
            const fs = await import('fs-extra');
            if (fs.existsSync(device.derivedDataPath)) {
              await fs.remove(device.derivedDataPath);
            }
          } catch (e: any) {
            this.logger.warn(`⚠️ Artisan WDA: Failed to clear cache: ${e.message}`);
          }
        }

        try {
          // startStream returns once WDA answers /status and its MJPEG port
          // listens. Through 2.21 a fixed 2 s wait followed, which waited on
          // nothing (ENH-15). Measured on an iPhone 17 Pro Max, dropping it
          // didn't shorten a session's start: the driver's first call into a
          // just-started WDA took about as long.
          const streamInfo = await streamService.startStream(device.udid);
          const wdaUrl = `http://127.0.0.1:${streamInfo.wdaPort}`;
          await updateDeviceProgress(device.udid, device.host, 'WDA active, finalizing session...');

          this.injectWDAUrl(caps, wdaUrl);
        } catch (err: any) {
          this.logger.warn(`⚠️ Artisan WDA: Pre-session boot failed: ${err.message}`);
          await updateDeviceProgress(
            device.udid,
            device.host,
            'Provisioning failed, falling back...',
          );
        }
      } else if (isWdaActive) {
        const wdaUrl = `http://127.0.0.1:${streamStatus!.wdaPort}`;
        this.injectWDAUrl(caps, wdaUrl);
      }

      const hasWdaUrl =
        _.has(caps.alwaysMatch, 'appium:webDriverAgentUrl') ||
        _.has(caps.firstMatch?.[0], 'appium:webDriverAgentUrl');
      if (!hasWdaUrl) {
        await updateDeviceProgress(
          device.udid,
          device.host,
          'Initializing WebDriverAgent (Xcode)...',
        );
      }
    } else if (device.platform === 'android') {
      await updateDeviceProgress(device.udid, device.host, 'Initializing UIAutomator2...');
    }
  }

  private injectWDAUrl(caps: ISessionCapability, wdaUrl: string) {
    // W3C capability rules forbid a property from appearing in BOTH alwaysMatch
    // and a firstMatch entry; appium rejects the session with "property
    // 'webDriverAgentUrl' should not exist on both primary and secondary object".
    // Write the injected WDA caps to exactly ONE bucket — prefer alwaysMatch,
    // which applies to every firstMatch entry — and scrub the keys from the
    // other so they can never collide.
    const target = caps.alwaysMatch ?? caps.firstMatch?.[0];
    if (!target) return;
    const other = target === caps.alwaysMatch ? caps.firstMatch?.[0] : caps.alwaysMatch;

    // The URL, and only the URL. Xenon owns this WebDriverAgent: it launched
    // it through go-ios and keeps the XCTest session alive for the stream. The
    // driver is a guest here, and `webDriverAgentUrl` is precisely how you say
    // that — `selectWdaStartupStrategyName` returns 'existing-url' on it before
    // considering anything else, and that strategy's own quit() reads
    // "Stopping neither xcodebuild nor XCTest session since WDA lifecycle is
    // not managed by this driver".
    target['appium:webDriverAgentUrl'] = wdaUrl;

    // `usePreinstalledWDA` is removed, never added, and this is the whole fix.
    //
    // It does not change which strategy runs — the URL already won that — it
    // only makes `launchOnce` call `preparePreinstalled` first, which is:
    //
    //   await driver.mobileKillApp(driver.wda.bundleIdForXctest);
    //   await cleanupApps(driver, [driver.wda.bundleIdForXctest]);
    //
    // Kill the app, then uninstall every WebDriverAgentRunner not on a
    // one-entry keep-list. Against a WDA that Xenon is hosting that is
    // exactly wrong twice over, and both halves were observed on a real
    // iPhone: the uninstall as "Removing WebDriverAgent runner app
    // 'com.qasecret.WebDriverAgentRunner.xctrunner'", leaving the device with
    // no WDA until someone re-signs one by hand; and the kill as the driver's
    // own next request failing with ECONNRESET, because go-ios's runwda was
    // gone while iproxy still held the port.
    //
    // Getting the keep-list right only converts the uninstall into the kill.
    // The driver must not be invited to manage this app at all.
    delete target['appium:usePreinstalledWDA'];
    delete target['appium:updatedWDABundleId'];

    // These conflict with a pre-installed WDA URL — strip from both buckets.
    for (const bucket of [target, other]) {
      if (!bucket) continue;
      delete bucket['appium:derivedDataPath'];
      delete bucket['appium:usePrebuiltWDA'];
      delete bucket['appium:wdaLocalPort'];
      delete bucket['appium:mjpegServerPort'];
    }
    // The injected WDA keys must live in `target` only.
    if (other) {
      delete other['appium:webDriverAgentUrl'];
      delete other['appium:usePreinstalledWDA'];
      delete other['appium:updatedWDABundleId'];
    }
  }

  private async finalizeSession(
    session: any,
    device: IDevice,
    caps: ISessionCapability,
    driver: any,
    isRemote: boolean,
    apiKeyId: string | null = null,
    userId: string | null = null,
    allocatedAt?: number,
  ) {
    const sessionId = session.value[0];
    const sessionResponse = session.value[1];
    const requestedCaps = Object.assign({}, caps.firstMatch?.[0] || {}, caps.alwaysMatch || {});
    (sessionResponse as any).desired = requestedCaps;

    const xenonCapabilities = getXenonCapabilities(caps);
    const tracingService = Container.get(TracingService);
    const context = Container.get(PluginContext);

    if (this.isHub(context.pluginArgs)) {
      const sessionName = (xenonCapabilities[XENON_CAPABILITIES.SESSION_NAME] ||
        sessionId) as string;
      // The test's trace, when it sent one (ENH-03, inboundTrace.ts).
      const joined = sessionTraceParent(xenonOptionsOf(caps));
      if (joined.problem) {
        this.logger.warn(
          `Session ${sessionId}: not a W3C traceparent, ignored: ${joined.problem}. ` +
            (joined.context
              ? "It joins the create header's trace."
              : 'It starts a trace of its own.'),
        );
      }
      tracingService.startSessionSpan(
        sessionId,
        sessionName,
        {
          'xenon.build_name': xenonCapabilities[XENON_CAPABILITIES.BUILD_NAME] as string,
          'xenon.platform': device.platform,
          'xenon.udid': device.udid,
        },
        joined.context,
      );
    }

    try {
      await this.registerSession(
        sessionId,
        sessionResponse,
        device,
        xenonCapabilities,
        driver,
        isRemote,
        apiKeyId,
        userId,
        allocatedAt,
      );
    } catch (err: any) {
      // The create fails, so no ending of the session will come to end it.
      tracingService.endSessionSpan(sessionId, {
        failed: true,
        reason: `Xenon could not finish creating the session: ${err?.message ?? err}`,
      });
      throw err;
    }
  }

  /** The rest of finalizeSession, once the session's span has started. */
  private async registerSession(
    sessionId: string,
    sessionResponse: any,
    device: IDevice,
    xenonCapabilities: any,
    driver: any,
    isRemote: boolean,
    apiKeyId: string | null,
    userId: string | null,
    allocatedAt: number | undefined,
  ) {
    const context = Container.get(PluginContext);
    // The session takes over the pending claim its phone was allocated with.
    const claimed = await claimDeviceForSession(device, sessionId, {
      session_id: sessionId,
      lastCmdExecutedAt: new Date().getTime(),
      sessionStartTime: new Date().getTime(),
      sessionProgress: 'Session Active',
    });
    // Another session holds the phone now: this create outlasted its pending
    // claim (PENDING_CLAIM_TIMEOUT_MS, a first WebDriverAgent build), the idle
    // sweeper freed it and the phone was allocated again. The create fails
    // (finishCreate ends the driver's session) rather than run a second
    // session on that phone, as it did through 2.36.
    if (!claimed && !isRemote) throw new ClaimLost(device, sessionId);
    // The ports the create leased for its session are the session's now.
    const portOwner = claimed ? createPortOwner(device) : undefined;
    if (portOwner) await Container.get(PortAllocator).adoptForSession(portOwner, sessionId);

    // Where the session gateway sends this session's commands: the node's own
    // base path, which need not be this hub's.
    let webDriverUrl: string | undefined;
    if (isRemote) {
      (Container.get(CircuitBreaker) as CircuitBreaker).recordSuccess(device.host);
      webDriverUrl = await nodeWebDriverUrl(device, context.nodeBasePath);
    }

    const freshDevice = await this.getFreshDevice(device);
    const sessionInstance = this.createSessionInstance(
      sessionId,
      freshDevice,
      sessionResponse,
      xenonCapabilities,
      driver,
      webDriverUrl,
    );
    sessionInstance.apiKeyId = apiKeyId;
    sessionInstance.userId = userId;
    sessionInstance.allocatedAt = allocatedAt;
    // A session this server drives: its owner is known while it runs, row or
    // not (a node writes none for the hub's sessions; LiveSessionOwners).
    if (sessionInstance instanceof LocalSession) {
      Container.get(LiveSessionOwners).record(sessionId, userId);
    }
    // A node samples its own phones for its hub, and records their device
    // log unless the session turned it off, whatever its dashboard setting
    // (the hub collects both). A hub and a standalone server start them in
    // EventManager.onSessionStarted, once the row exists.
    if (!this.isHub(context.pluginArgs) && sessionInstance instanceof LocalSession) {
      Container.get(SessionMetricsService).start({
        sessionId,
        device: freshDevice,
        capabilities: sessionResponse,
      });
      if (xenonCapabilities[XENON_CAPABILITIES.SAVE_DEVICE_LOGS] !== false) {
        void Container.get(SessionDeviceLogs).start({
          sessionId,
          device: freshDevice,
          since: allocatedAt,
          // An iPhone's or simulator's: the log its driver captures.
          driverLog: sessionInstance.deviceLog(),
          appUnderTest: sessionInstance.appUnderTest(),
        });
      }
    }

    await this.applyPostSessionLogic(sessionInstance, xenonCapabilities, freshDevice);
  }

  private async getFreshDevice(device: IDevice): Promise<IDevice> {
    try {
      const store = DeviceStoreFactory.getStore();
      const updatedDevice = await store.findDevice({ udid: device.udid, host: device.host });
      return updatedDevice || device;
    } catch (err: any) {
      this.logger.debug(`📱 Could not refresh device: ${err.message}`);
      return device;
    }
  }

  private createSessionInstance(
    sessionId: string,
    device: IDevice,
    response: any,
    caps: any,
    driver: any,
    webDriverUrl?: string,
  ): XenonSession {
    const context = Container.get(PluginContext);
    const sessionOptions: XenonSessionOptions = {
      sessionId,
      device,
      sessionResponse: response,
      xenonOption: caps,
    };
    const nodeWebdriverUrl = webDriverUrl ?? nodeUrl(device, context.nodeBasePath);

    if (device.nodeId === context.nodeId) {
      return new LocalSession({ ...sessionOptions, driver });
    } else if (device.cloud) {
      return new CloudSession({ ...sessionOptions, baseUrl: nodeWebdriverUrl });
    } else {
      return new RemoteSession({ ...sessionOptions, baseUrl: nodeWebdriverUrl });
    }
  }

  private async applyPostSessionLogic(session: XenonSession, caps: any, device: IDevice) {
    const context = Container.get(PluginContext);
    // Only the server that drives the phone changes its network: a node
    // applies its own sessions' profile and interceptor, and a hub that did
    // it too ran its own adb against the node's phone.
    if (session.getType() === SessionType.LOCAL) {
      await this.applySessionNetwork(session.getId(), caps, device, context.pluginArgs);
    }

    const isDashboardEnabled = !!context.pluginArgs.enableDashboard;
    const shouldSaveLogs = session.getType() !== SessionType.CLOUD;
    const isVideoRecordingEnabled = caps[XENON_CAPABILITIES.VIDEO_RECORDING];
    this.logger.info(
      `📹 Video recording enabled for session ${session.getId()}: ${isVideoRecordingEnabled}`,
    );

    if (isVideoRecordingEnabled) {
      const resolution = caps[XENON_CAPABILITIES.VIDEO_RESOLUTION] || undefined;
      try {
        this.logger.info(`📹 Starting video recording for session ${session.getId()}...`);
        await session.startVideoRecording({ resolution });
        this.logger.info(`📹 Video recording started successfully for ${session.getId()}`);
      } catch (err: any) {
        this.logger.warn(
          `⚠️ Failed to start video recording for ${session.getId()}: ${err.message}`,
        );
      }
    }

    // A session another server runs is always registered, whatever the
    // dashboard and video settings: SESSION_MANAGER is where the session
    // gateway finds it to forward its commands.
    const routedElsewhere = session.getType() !== SessionType.LOCAL;
    if (
      routedElsewhere ||
      (isDashboardEnabled && shouldSaveLogs) ||
      (isVideoRecordingEnabled && shouldSaveLogs)
    ) {
      SESSION_MANAGER.addSession(session.getId(), session);
      if (this.isHub(context.pluginArgs) && isDashboardEnabled && shouldSaveLogs) {
        await DASHBORD_EVENT_MANAGER.onSessionStarted(caps, session, device);
      } else if (routedElsewhere) {
        await this.recordRoutedSession(caps, session, device);
      }
    }
  }

  /**
   * The session's network profile and network capture, on a phone this
   * server drives. First what an earlier session left on the phone and
   * couldn't put back is undone, so this session starts from the phone's own
   * settings and records those as the ones to put back. Each ending undoes
   * these through PhoneNetworkRestore.
   */
  private async applySessionNetwork(
    sessionId: string,
    caps: any,
    device: IDevice,
    pluginArgs: IPluginArgs,
  ) {
    if (device.platform?.toLowerCase() === 'android') {
      await Container.get(PhoneNetworkRestore).restoreLeftovers({ udid: device.udid });
    }

    // Capture first: a profile that shapes a real phone starts a relay that
    // forwards to the capture proxy when there is one (ENH-20 part 2).
    const interceptor = resolveInterceptorOptions(caps, pluginArgs.interceptor);
    if (interceptor.enabled) {
      try {
        const { InterceptorService } = await import('./InterceptorService');
        await Container.get(InterceptorService).start(sessionId, device, interceptor);
      } catch (err: any) {
        this.logger.warn(`🕸️ Failed to start interceptor for ${sessionId}: ${err.message}`);
      }
    }

    const networkProfile = caps[XENON_CAPABILITIES.NETWORK_PROFILE];
    if (networkProfile) {
      const { NetworkConditioningService } = await import('./NetworkConditioningService');
      await Container.get(NetworkConditioningService).applyProfile(
        sessionId,
        device,
        networkProfile,
      );
    }
  }

  /**
   * The row a hub keeps for a session it routes to a node or a cloud when the
   * dashboard's own (onSessionStarted) isn't written: with the dashboard off,
   * and for every cloud session. After a restart the hub finds where the
   * session runs, and who owns it, only from this row (SessionLocator,
   * recoverActiveSessions, SessionOwnerResolver): without it every node
   * session was sent to the hub's own Appium, which had no such session.
   *
   * Only what routing and ownership need: no profiling, logs or dashboard
   * event. onSessionStopped closes it like any other row. A local session's
   * row is still the dashboard's alone. A failed write is logged, not
   * thrown: the session exists, and is routed from memory until a restart.
   */
  private async recordRoutedSession(caps: any, session: XenonSession, device: IDevice) {
    try {
      const created = await prisma.session.create({
        data: {
          id: session.getId(),
          name: caps[XENON_CAPABILITIES.SESSION_NAME] || undefined,
          ...storedSessionCapabilities(_.assign({}, session.getCapabilities())),
          node_id: device.nodeId || '',
          has_live_video: false,
          video_recording_enabled: caps[XENON_CAPABILITIES.VIDEO_RECORDING] === true,
          device_udid: device.udid || '',
          device_platform: device.platform || '',
          device_version: device.sdk || '',
          device_name: device.name,
          status: 'running',
          api_key_id: session.apiKeyId ?? null,
          user_id: session.userId ?? null,
          lease_id: sessionLeaseIdOf(session.getCapabilities()),
        },
      });
      // ENH-07: a routed session has its record, so its start is announced.
      announce('session_started', created.id, () =>
        Container.get(NotificationService).notifySessionStarted(created),
      );
    } catch (err: any) {
      this.logger.warn(
        `Could not record session ${session.getId()} on ${device.udid}: ${err?.message ?? err}. ` +
          'It is routed from memory, and a restart of this hub loses it.',
      );
    }
  }

  private async handleSessionFailure(session: any, device: IDevice, isRemote: boolean) {
    await releasePendingClaim(device);
    await this.releaseCreatePorts(device);
    await updateDeviceProgress(device.udid, device.host, '');
    if (isRemote) {
      (Container.get(CircuitBreaker) as CircuitBreaker).recordFailure(device.host);
    }
    this.throwProperError(session, device.host);
  }

  /**
   * POST the create to the phone's node (or cloud provider). `hubToken` is
   * this hub's create token for a peer Xenon node (HubSessionTokenIssuer),
   * sent as `x-xenon-hub-token`; nothing else of the client's goes with it.
   */
  async forwardSessionRequest(
    device: IDevice,
    caps: ISessionCapability,
    hubToken: string | null = null,
  ): Promise<CreateSessionResponseInternal | Error> {
    const context = Container.get(PluginContext);
    const remoteUrl = `${await nodeWebDriverUrl(device, context.nodeBasePath)}/session`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (hubToken) headers[HUB_TOKEN_HEADER] = hubToken;
    // Sent once, with a create's timeout (REMOTE_CREATE_TIMEOUT_MS).
    const config: InternalRequestConfig = {
      method: 'post',
      url: remoteUrl,
      headers,
      data: { capabilities: caps },
      timeout: REMOTE_CREATE_TIMEOUT_MS,
      retry: false,
    };

    // Its proxy is InternalHttpClient's, by Xenon's one rule: the `proxy`
    // option, else the environment's (helpers/outboundProxy.ts).
    const createdSession: W3CNewSessionResponse | Error = await this.invokeSessionRequest(
      config,
      context.pluginArgs.tlsRejectUnauthorized,
    );

    if (createdSession instanceof Error) {
      return createdSession;
    }

    // Detect W3C-style error payloads that invokeSessionRequest returned as data
    const val = createdSession?.value as any;
    if (
      Object.prototype.hasOwnProperty.call(createdSession, 'error') ||
      (val && val.error) ||
      (val && typeof val.message === 'string' && !val.sessionId)
    ) {
      const errorDetail =
        (createdSession as any).error || val?.error || val?.message || 'Unknown W3C error';
      return new Error(
        `W3C session creation failed on ${device.host}: ${
          typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail
        }`,
      );
    }

    // Only build the success tuple for genuine W3C success payloads
    if (!val?.sessionId) {
      return new Error(`Invalid session response from ${device.host}: missing sessionId`);
    }

    return {
      protocol: 'W3C',
      value: [val.sessionId, val.capabilities, 'W3C'],
    };
  }

  async invokeSessionRequest(
    config: AxiosRequestConfig,
    tlsRejectUnauthorized?: boolean,
  ): Promise<W3CNewSessionResponse | Error> {
    try {
      const client = InternalHttpClient.getClient(tlsRejectUnauthorized);
      const response = await client.request(config);
      return response.data as W3CNewSessionResponse;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          return axiosError.response.data as W3CNewSessionResponse;
        }
      }
      return error;
    }
  }

  isW3CNewSessionResponse(something: any): something is W3CNewSessionResponse {
    return (
      something &&
      typeof something === 'object' &&
      (Object.prototype.hasOwnProperty.call(something, 'value') ||
        Object.prototype.hasOwnProperty.call(something, 'error'))
    );
  }

  isCreateSessionResponseInternal(something: any): something is CreateSessionResponseInternal {
    return (
      something &&
      typeof something === 'object' &&
      Object.prototype.hasOwnProperty.call(something, 'value') &&
      Array.isArray(something.value) &&
      (something.value.length === 2 || something.value.length === 3) &&
      typeof something.value[0] === 'string' &&
      typeof something.value[1] === 'object' &&
      (something.value.length === 2 ||
        typeof something.value[2] === 'string' ||
        something.value[2] === undefined)
    );
  }

  throwProperError(session: any, host: string) {
    if (session instanceof Error) {
      throw session;
    } else if (
      session &&
      typeof session === 'object' &&
      Object.prototype.hasOwnProperty.call(session, 'error')
    ) {
      let errorMessage = (session as W3CNewSessionResponseError).error;
      // Appium answers a refused create as `{ error: <Error> }`. Rethrow it, so
      // the client gets Appium's reason and status; JSON.stringify of an Error
      // is `{}`.
      if ((errorMessage as unknown) instanceof Error) throw errorMessage;
      if (typeof errorMessage === 'object') {
        errorMessage = JSON.stringify(errorMessage);
      }
      throw new Error(`Failed to create session on node ${host}. Error: ${errorMessage}`);
    } else {
      throw new Error(`Failed to create session on node ${host}. Unknown error.`);
    }
  }

  getLockName(caps: ISessionCapability): string {
    const platform = (
      caps.alwaysMatch?.platformName || caps.firstMatch?.[0]?.platformName
    )?.toLowerCase();
    if (platform === 'ios') return 'ios-lock';
    if (platform === 'android') return 'android-lock';
    return 'default-lock';
  }

  async deleteSession(
    next: () => any,
    sessionId?: string | null,
    status?: SessionStatus,
    reason?: string,
  ) {
    // Phase 1: finalizeCleanup + device unblock must be atomic. Without the lock,
    // two racing deletes both observe isStopping=false and both run finalizeCleanup,
    // which releases ports and archives video twice.
    if (sessionId) {
      await sessionCleanupLock.acquire(sessionId, async () => {
        // An observer recording filming the session stops before the phone is
        // released below, not after the driver's own delete (forgetSessionMemory,
        // in the finally): it would film the next test on the freed phone.
        tellRecordingsSessionEnded(sessionId);
        // The phone's network (profile, interceptor proxy) and the capture,
        // before the phone is released to the next session. Whether or not
        // SESSION_MANAGER holds the session.
        await Container.get(PhoneNetworkRestore).restoreSession(sessionId, 'session deleted');

        // The session's own ports and video, before the phone is released: the
        // phone may be the next session's as soon as it is free, as in
        // endSessionAppiumEnded. Through 2.36 the phone went first, so the next
        // session could start on it while this one's video was still written.
        const session = SESSION_MANAGER.getSession(sessionId);
        if (session && !session.isStopping) {
          session.isStopping = true;
          session.stoppedAt = Date.now();
          try {
            await this.finalizeCleanup(session, status, reason);
          } catch (err: any) {
            this.logger.warn(
              `[${sessionId}] cleanup before the phone's release failed: ${err.message}`,
            );
          }
        }

        // Keyed on the session's claim, so a phone another session holds by
        // now is left alone.
        await releaseSessionDevices(sessionId);
        this.logger.info(`📱 Unblocking the device that is blocked for session ${sessionId}`);
      });
    }

    let timeoutId: any;
    try {
      // Principal Protection: Wrap the driver deletion with a timeout.
      // If the underlying driver (WDA/ADB) hangs during shutdown, we don't want
      // our session lifecycle to be stuck 'RUNNING' forever.
      const deletionTimeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Deletion timed out')), 30000);
      });

      const response = await Promise.race([next(), deletionTimeout]);
      clearTimeout(timeoutId);
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      this.logger.warn(
        `⚠️ Internal deleteSession failed or timed out: ${err.message}. Continuing cleanup anyway.`,
      );
      return null;
    } finally {
      if (sessionId) {
        Container.get(LiveSessionOwners).forget(sessionId);
        forgetSessionMemory(sessionId);
        // How the session ended: the status given, else the one
        // onSessionStopped decides from its failed commands (a test's own
        // delete gives none). Its span ends with that, below.
        let ended: SessionStatus | undefined = status;
        // Before the lock's "still in memory?" check, which a dashboard-off
        // node fails. On a node this ends the figures and device log it
        // holds for its hub; on a hub it collects a node session's last ones,
        // before onSessionStopped's failure analysis reads the log. Idempotent.
        try {
          await Container.get(SessionMetricsService).stop(sessionId);
          await Container.get(SessionDeviceLogs).stop(sessionId);
          await sessionCleanupLock.acquire(sessionId, async () => {
            const session = SESSION_MANAGER.getSession(sessionId);
            if (!session) {
              // Another concurrent deleteSession already cleaned up.
              return;
            }
            // The phone's network was put back before it was released (above).
            ended =
              (await DASHBORD_EVENT_MANAGER.onSessionStopped(sessionId, status, reason)) ?? status;
            SESSION_MANAGER.removeSession(sessionId);
            Container.get(HubSessionTokenIssuer).forget(sessionId);
          });
        } finally {
          // Whether or not SESSION_MANAGER holds the session (a local one
          // with the dashboard off), and once: a second delete finds no
          // span. After onSessionStopped, so a session a test ended itself
          // ends ERROR when it failed; through 2.30 it ended before, OK.
          Container.get(TracingService).endSessionSpan(sessionId, {
            failed: ended === SessionStatus.FAILED,
            reason,
          });
        }
      }
    }
  }

  /**
   * The end of a session Appium ended itself (its new-command timeout, a
   * crashed driver): the plugin's onUnexpectedShutdown, the only ending such a
   * session gets. Under the delete's lock, so a client's delete or the
   * heartbeat arriving meanwhile finds the work done.
   *
   * The ports and video go before the phone is released, since both belong to
   * this session and the phone may be the next one's as soon as it is free.
   * Then the end is recorded where `recordEnd` says the dashboard records
   * sessions, or wherever SESSION_MANAGER held the session (as deleteSession
   * does), and the session leaves SESSION_MANAGER last. Through 2.36 it never
   * left: the heartbeat found its driver gone and ended it again minutes
   * later, rewriting the row's reason, analysing it a second time and
   * releasing the ports of whatever session held the phone by then. Its video
   * was stopped only on a hub with the dashboard on.
   */
  public async endSessionAppiumEnded(
    sessionId: string,
    reason: string,
    opts: { driver?: any; recordEnd?: boolean } = {},
  ): Promise<void> {
    await sessionCleanupLock.acquire(sessionId, async () => {
      // The phone's network (profile, interceptor proxy) and the capture,
      // before the phone is released.
      await Container.get(PhoneNetworkRestore).restoreSession(sessionId, 'driver shut down');

      const session = SESSION_MANAGER.getSession(sessionId);
      if (session && !session.isStopping) {
        session.isStopping = true;
        session.stoppedAt = Date.now();
        try {
          // No profiling stop: the driver that would answer it is gone.
          await this.finalizeCleanup(session, SessionStatus.FAILED, reason, {
            driver: opts.driver,
            stopProfiling: false,
          });
        } catch (err: any) {
          this.logger.warn(`[${sessionId}] cleanup after Appium's end failed: ${err.message}`);
        }
      }

      // Keyed on the session: its phone may be another session's by now.
      // On a node too: its own row holds the claim, and the hub learns the
      // phone is free from the node's next report.
      await releaseSessionDevices(sessionId);

      if (opts.recordEnd || session) {
        try {
          await DASHBORD_EVENT_MANAGER.onSessionStopped(sessionId, SessionStatus.FAILED, reason);
        } catch (err: any) {
          this.logger.warn(`[${sessionId}] onSessionStopped failed: ${err.message}`);
        }
      }
      SESSION_MANAGER.removeSession(sessionId);
    });
  }

  private async finalizeCleanup(
    session: XenonSession,
    status?: SessionStatus,
    reason?: string,
    opts: { driver?: any; stopProfiling?: boolean } = {},
  ) {
    const sessionId = session.getId();
    const device = session.getDevice();

    // Release allocated ports for this device
    if (device?.udid) {
      try {
        await Container.get(PortAllocator).releaseForSession(sessionId);
      } catch (err: any) {
        log.warn(`Port release failed: ${err.message}`);
      }
    }

    // 1. iOS Profiling Archival. Only on an iPhone, the one place
    // EventManager.onSessionStarted starts it. A simulator's driver refuses
    // the stop without relaxed security, and the refused stop counted as a
    // failed command of the session: every simulator session ended failed.
    if (
      opts.stopProfiling !== false &&
      device &&
      device.platform?.toLowerCase() === 'ios' &&
      device.realDevice === true
    ) {
      this.logger.info(`[${sessionId}] Stopping iOS profiling for asset archival`);
      try {
        const traceBase64 = await session.stopPerformanceRecording();
        if (traceBase64) {
          const { savePerformanceTrace } = await import('../dashboard/asset-manager');
          const tracePath = savePerformanceTrace(sessionId, traceBase64);
          await updateSessionDetails(sessionId, { performance_trace: tracePath });
          this.logger.info(`✅ [${sessionId}] iOS profiling trace saved at ${tracePath}`);
        }
      } catch (err: any) {
        this.logger.warn(`⚠️ [${sessionId}] iOS profiling capture failed: ${err.message}`);
      }
    }

    // 2. Intelligent Video Archival
    if (session.isVideoRecordingInProgress()) {
      this.logger.info(`[${sessionId}] Stopping video recording for asset archival`);
      try {
        const videoData = await session.stopVideoRecording(opts.driver);
        if (videoData) {
          try {
            const { saveVideoRecording } = await import('../dashboard/asset-manager');
            let videoPath = videoData;
            // Principal Efficiency: If it's a relative path from our pipeline, use it.
            // If it's base64 (older Appium drivers), save it to disk.
            if (videoData.length > 1000) {
              videoPath = saveVideoRecording(sessionId, videoData);
            }
            await updateSessionDetails(sessionId, { video_recording: videoPath });
            this.logger.info(`✅ [${sessionId}] Video recording archived at ${videoPath}`);
          } catch (saveErr: any) {
            this.logger.error(
              `❌ [${sessionId}] Failed to process video asset: ${saveErr.message}`,
            );
          }
        }
      } catch (error: any) {
        this.logger.warn(`⚠️ [${sessionId}] Failed to stop video recording: ${error.message}`);
      }
    }
  }

  // Shutdown-path counterpart to deleteSession. Runs the same cleanup (unblock
  // device, archive video, release ports, mark failed, emit stopped) WITHOUT
  // needing Appium's `next()` driver shutdown — during process shutdown we
  // don't have it, and any leftover driver state dies with the process
  // anyway. Shares sessionCleanupLock with deleteSession so a racing client
  // delete can't double-archive video.
  public async stopSessionForShutdown(sessionId: string, reason: string): Promise<void> {
    await sessionCleanupLock.acquire(sessionId, async () => {
      await Container.get(PhoneNetworkRestore).restoreSession(sessionId, reason);
      try {
        await releaseSessionDevices(sessionId);
      } catch (err: any) {
        this.logger.warn(`[shutdown] unblock failed for ${sessionId}: ${err.message}`);
      }

      const session = SESSION_MANAGER.getSession(sessionId);
      if (session && !session.isStopping) {
        session.isStopping = true;
        session.stoppedAt = Date.now();
        try {
          await this.finalizeCleanup(session, SessionStatus.FAILED, reason);
        } catch (err: any) {
          this.logger.warn(`[shutdown] finalizeCleanup failed for ${sessionId}: ${err.message}`);
        }
      }

      try {
        // A shutdown fails the sessions it drains; no test caused it, so no webhook.
        await DASHBORD_EVENT_MANAGER.onSessionStopped(sessionId, SessionStatus.FAILED, reason, {
          notify: false,
        });
      } catch (err: any) {
        this.logger.warn(`[shutdown] onSessionStopped failed for ${sessionId}: ${err.message}`);
      }

      SESSION_MANAGER.removeSession(sessionId);
      Container.get(LiveSessionOwners).forget(sessionId);
      forgetSessionMemory(sessionId);
      Container.get(TracingService).endSessionSpan(sessionId, { failed: true, reason });
      await Container.get(SessionMetricsService).stop(sessionId);
      await Container.get(SessionDeviceLogs).stop(sessionId);
    });
  }

  private isHub(args: any) {
    return !args.hub;
  }
}
