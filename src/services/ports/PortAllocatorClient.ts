import { Service } from 'typedi';
import { InternalHttpClient } from '../../InternalHttpClient';
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

@Service()
export class PortAllocatorClient {
  private logger = log.scope('PortAllocatorClient');

  async allocate(opts: AllocateOptions): Promise<Record<PortPurpose, number>> {
    const base = opts.nodeHost.replace(/\/$/, '');
    const url = `${base.endsWith('/xenon/api') ? base : `${base}/xenon/api`}/ports/allocate`;
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
}
