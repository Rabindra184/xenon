import log from '../../logger';

/** What the phone's server is asked; PortAllocatorClient has both. */
export interface PhoneServerPortClient {
  extend?(opts: {
    nodeHost: string;
    udid: string;
    ports: number[];
    expiresAt: number;
    nodePairAuth: { accessKey: string; token: string };
  }): Promise<unknown>;
  release?(opts: {
    nodeHost: string;
    udid: string;
    ports: number[];
    nodePairAuth: { accessKey: string; token: string };
  }): Promise<unknown>;
}

export interface PortsLease {
  id: string;
  deviceUdid: string;
  deviceHost: string;
  allocatedPorts?: string | null;
}

/** The port numbers a lease row holds (`allocatedPorts`), or none. */
export function leasePorts(lease: PortsLease): number[] {
  try {
    return Object.values(JSON.parse(lease.allocatedPorts || '{}')).filter((p): p is number =>
      Number.isInteger(p),
    );
  } catch {
    return [];
  }
}

/**
 * This server's port rows of one phone's reservation: its ports, on that
 * udid and host. An emulator's udid repeats across servers, often with the
 * same port numbers, so the host is part of it.
 */
export function portRowsWhere(lease: PortsLease) {
  return {
    port: { in: leasePorts(lease) },
    leasedToUdid: lease.deviceUdid,
    leasedToHost: lease.deviceHost,
  };
}

/**
 * A lease's driver ports live in the database of the phone's server, which
 * reserved them (`POST /ports/allocate`): the node's own for a node's phone.
 * These calls reach them there. Neither is awaited by the lease call that
 * starts it: the lease row is what the client relies on, and a server that
 * is slow, down or older (no such route, 404) must not hold up or fail it.
 * Its ports then end at their own expiry, as before.
 */
export class PhoneServerPorts {
  private readonly logger = log.scope('PhoneServerPorts');
  private readonly calls = new Set<Promise<void>>();

  constructor(
    private readonly portClient: PhoneServerPortClient,
    private readonly authProvider: {
      nodePairAuth(host: string): Promise<{ accessKey: string; token: string }>;
    },
  ) {}

  /** Holds the ports until the lease's new end (`POST /ports/extend`, plugin 2.19+). */
  hold(lease: PortsLease, expiresAt: number): void {
    const ports = leasePorts(lease);
    const extend = this.portClient.extend?.bind(this.portClient);
    if (ports.length === 0 || !extend) return;
    this.run(
      `couldn't hold its ports on ${lease.deviceHost} until ${new Date(expiresAt).toISOString()}`,
      lease,
      async (nodePairAuth) =>
        extend({
          nodeHost: lease.deviceHost,
          udid: lease.deviceUdid,
          ports,
          expiresAt,
          nodePairAuth,
        }),
    );
  }

  /**
   * Frees the ports when the lease ends (`POST /ports/release`, plugin
   * 2.20+). Skipped when this server's own delete already took every one
   * (`deletedHere`): the phone is this server's, and its rows carried the
   * lease's id.
   */
  free(lease: PortsLease, deletedHere: number): void {
    const ports = leasePorts(lease);
    const release = this.portClient.release?.bind(this.portClient);
    if (ports.length === 0 || deletedHere >= ports.length || !release) return;
    this.run(`couldn't free its ports on ${lease.deviceHost}`, lease, async (nodePairAuth) =>
      release({ nodeHost: lease.deviceHost, udid: lease.deviceUdid, ports, nodePairAuth }),
    );
  }

  /** For tests: resolves once every call started so far has answered. */
  async settled(): Promise<void> {
    await Promise.all([...this.calls]);
  }

  private run(
    failure: string,
    lease: PortsLease,
    call: (nodePairAuth: { accessKey: string; token: string }) => Promise<unknown>,
  ): void {
    const work: Promise<void> = (async () => {
      await call(await this.authProvider.nodePairAuth(lease.deviceHost));
    })()
      .catch((err) => {
        this.logger.warn(`lease ${lease.id}: ${failure}: ${(err as Error).message}`);
      })
      .finally(() => this.calls.delete(work));
    this.calls.add(work);
  }
}
