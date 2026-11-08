import { Service } from 'typedi';
import { InternalHttpClient, InternalRequestConfig } from '../../InternalHttpClient';
import log from '../../logger';
import { PortPurpose } from './PortAllocatorService';
import { defaultOwnPorts, OwnPorts } from './ownPorts';
import { HUB_TOKEN_HEADER } from '../../gateway/hubSessionToken';

/**
 * What a port call to another server carries: the hub's node-pair
 * credentials (XENON_HUB_ACCESS_KEY / XENON_HUB_TOKEN, empty when unset) and,
 * from a hub that can sign, its ports token for the phone (hubSessionToken.ts),
 * which a node takes in their place. An older node ignores the token and
 * checks the pair, as before.
 */
export interface NodeCredentials {
  accessKey: string;
  token: string;
  hubToken?: string | null;
}

function credentialHeaders(c: NodeCredentials): Record<string, string> {
  return {
    'x-xenon-access-key': c.accessKey,
    'x-xenon-token': c.token,
    ...(c.hubToken ? { [HUB_TOKEN_HEADER]: c.hubToken } : {}),
  };
}

export interface AllocateOptions {
  /** Full URL to the node — either bare `host:port` or `host:port/xenon/api`. */
  nodeHost: string;
  udid: string;
  purposes: PortPurpose[];
  durationMs: number;
  leaseId?: string;
  /** Hub's node-pair credentials (an ADMIN-scope API key) for the target node. */
  nodePairAuth: NodeCredentials;
  /**
   * Send it once, waiting at most EXTEND_TIMEOUT_MS. A lease grant reserves
   * ports while it holds the allocation lock (LeaseGranter), and the
   * client's own retries (four 30 s tries) to a server that doesn't answer
   * would hold every session's allocation up for two minutes.
   */
  once?: boolean;
}

export interface ExtendOptions {
  nodeHost: string;
  udid: string;
  ports: number[];
  /** The lease's new end, epoch milliseconds. */
  expiresAt: number;
  nodePairAuth: NodeCredentials;
}

export interface ReleaseOptions {
  nodeHost: string;
  udid: string;
  ports: number[];
  nodePairAuth: NodeCredentials;
}

/** A lease extend or release, or a grant's reservation, waits no longer than this on the phone's server. */
const EXTEND_TIMEOUT_MS = 10_000;

function portsUrl(nodeHost: string, action: string): string {
  const base = nodeHost.replace(/\/$/, '');
  return `${base.endsWith('/xenon/api') ? base : `${base}/xenon/api`}/ports/${action}`;
}

@Service()
export class PortAllocatorClient {
  private logger = log.scope('PortAllocatorClient');

  /**
   * This server's own phones are reserved here, in process, with no
   * credentials (ownPorts.ts); a field rather than a constructor parameter,
   * which TypeDI would try to resolve. Tests replace it.
   */
  ownPorts: OwnPorts = defaultOwnPorts();

  async allocate(opts: AllocateOptions): Promise<Record<PortPurpose, number>> {
    if (this.ownPorts.isOwnHost(opts.nodeHost)) {
      return this.ownPorts.allocator().allocate({
        udid: opts.udid,
        host: opts.nodeHost,
        purposes: opts.purposes,
        durationMs: opts.durationMs,
        leaseId: opts.leaseId,
      });
    }
    const url = portsUrl(opts.nodeHost, 'allocate');
    const config: InternalRequestConfig = {
      ...(opts.once ? { retry: false as const, timeout: EXTEND_TIMEOUT_MS } : {}),
      headers: credentialHeaders(opts.nodePairAuth),
    };
    try {
      const res: any = await InternalHttpClient.post(
        url,
        {
          udid: opts.udid,
          host: opts.nodeHost,
          purposes: opts.purposes,
          durationMs: opts.durationMs,
          leaseId: opts.leaseId,
        },
        config,
      );
      if (!res || !res.ports) {
        throw new Error(`malformed response: ${JSON.stringify(res)}`);
      }
      return res.ports;
    } catch (err) {
      this.logger.warn(`port allocate RPC to ${opts.nodeHost} failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Holds a lease's ports on the phone's server until the lease's new end.
   * Sent once: an extend is repeated by the client's next one anyway. A
   * server from 2.18 or earlier has no such route and answers 404.
   */
  async extend(opts: ExtendOptions): Promise<{ extended: number }> {
    if (this.ownPorts.isOwnHost(opts.nodeHost)) {
      return this.ownPorts
        .allocator()
        .extend({ udid: opts.udid, ports: opts.ports, expiresAt: opts.expiresAt });
    }
    const config: InternalRequestConfig = {
      retry: false,
      timeout: EXTEND_TIMEOUT_MS,
      headers: credentialHeaders(opts.nodePairAuth),
    };
    const res: any = await InternalHttpClient.post(
      portsUrl(opts.nodeHost, 'extend'),
      { udid: opts.udid, ports: opts.ports, expiresAt: opts.expiresAt },
      config,
    );
    return { extended: Number(res?.extended ?? 0) };
  }

  /**
   * Frees a lease's ports on the phone's server when the lease ends. Sent
   * once: a port that stays reserved ends at its own expiry anyway. A server
   * from 2.19 or earlier has no such route and answers 404.
   */
  async release(opts: ReleaseOptions): Promise<{ released: number }> {
    if (this.ownPorts.isOwnHost(opts.nodeHost)) {
      return this.ownPorts.allocator().release({ udid: opts.udid, ports: opts.ports });
    }
    const config: InternalRequestConfig = {
      retry: false,
      timeout: EXTEND_TIMEOUT_MS,
      headers: credentialHeaders(opts.nodePairAuth),
    };
    const res: any = await InternalHttpClient.post(
      portsUrl(opts.nodeHost, 'release'),
      { udid: opts.udid, ports: opts.ports },
      config,
    );
    return { released: Number(res?.released ?? 0) };
  }
}
