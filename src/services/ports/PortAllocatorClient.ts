import { Service } from 'typedi';
import { InternalHttpClient, InternalRequestConfig } from '../../InternalHttpClient';
import log from '../../logger';
import { PortPurpose } from './PortAllocatorService';

export interface AllocateOptions {
  /** Full URL to the node — either bare `host:port` or `host:port/xenon/api`. */
  nodeHost: string;
  udid: string;
  purposes: PortPurpose[];
  durationMs: number;
  leaseId?: string;
  /** Hub's node-pair credentials (an ADMIN-scope API key) for the target node. */
  nodePairAuth: { accessKey: string; token: string };
}

export interface ExtendOptions {
  nodeHost: string;
  udid: string;
  ports: number[];
  /** The lease's new end, epoch milliseconds. */
  expiresAt: number;
  nodePairAuth: { accessKey: string; token: string };
}

/** A lease extend waits no longer than this on the phone's server. */
const EXTEND_TIMEOUT_MS = 10_000;

function portsUrl(nodeHost: string, action: string): string {
  const base = nodeHost.replace(/\/$/, '');
  return `${base.endsWith('/xenon/api') ? base : `${base}/xenon/api`}/ports/${action}`;
}

@Service()
export class PortAllocatorClient {
  private logger = log.scope('PortAllocatorClient');

  async allocate(opts: AllocateOptions): Promise<Record<PortPurpose, number>> {
    const url = portsUrl(opts.nodeHost, 'allocate');
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
        {
          headers: {
            'x-xenon-access-key': opts.nodePairAuth.accessKey,
            'x-xenon-token': opts.nodePairAuth.token,
          },
        },
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
    const config: InternalRequestConfig = {
      retry: false,
      timeout: EXTEND_TIMEOUT_MS,
      headers: {
        'x-xenon-access-key': opts.nodePairAuth.accessKey,
        'x-xenon-token': opts.nodePairAuth.token,
      },
    };
    const res: any = await InternalHttpClient.post(
      portsUrl(opts.nodeHost, 'extend'),
      { udid: opts.udid, ports: opts.ports, expiresAt: opts.expiresAt },
      config,
    );
    return { extended: Number(res?.extended ?? 0) };
  }
}
