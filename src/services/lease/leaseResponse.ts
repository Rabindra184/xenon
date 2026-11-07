import type { IDevice } from '../../interfaces/IDevice';
import type { AllocatedPorts } from './buildCapabilityBag';
import { withLeaseToken } from './leaseSessionCaps';

/**
 * What `POST /sdk/leases` (and, from Task 7, `GET /sdk/leases/:id`) answers
 * for a lease: granted (`201`) or waiting in the queue (`202`).
 *
 * A granted lease lists every member, and member 0 also fills the top-level
 * `device`, `allocatedPorts` and `appiumCapabilities`, the body a single
 * lease has always had, so existing clients read it unchanged.
 */

/** A leased phone, as the answer describes it. */
export interface LeaseDevice {
  udid: string;
  host: string;
  platform?: string;
  sdk?: string;
  name?: string;
  screen: { width?: string; height?: string };
  realDevice?: boolean;
}

export interface GrantedMember {
  index: number;
  device: LeaseDevice;
  allocatedPorts: AllocatedPorts;
  /** The member's stored capabilities plus `xe:options.leaseToken`. */
  appiumCapabilities: Record<string, any>;
}

export interface GrantedBody {
  leaseId: string;
  leaseToken: string;
  device: LeaseDevice;
  expiresAt: number;
  heartbeatSeconds: number;
  allocatedPorts: AllocatedPorts;
  appiumCapabilities: Record<string, any>;
  members: GrantedMember[];
}

export interface WaitingBody {
  leaseId: string;
  leaseToken: string;
  status: 'waiting';
  /** 1 for the head of the queue. */
  position: number;
  /** When the request gives up, epoch ms. */
  waitUntil: number;
  heartbeatSeconds: number;
}

/** A member row of a granted lease, with its phone's row if the store still has it. */
export interface MemberWithDevice {
  index: number;
  udid: string;
  host: string;
  /** JSON, as stored. */
  allocatedPorts: string;
  /** JSON, as stored: no token. */
  capabilityBag: string;
  device: IDevice | null;
}

function parsed(json: string | null | undefined): Record<string, any> {
  try {
    const value = JSON.parse(json || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** The phone as a lease answer describes it, from its row; udid and host alone when it's gone. */
export function leaseDevice(udid: string, host: string, device: IDevice | null): LeaseDevice {
  return {
    udid,
    host,
    platform: device?.platform,
    sdk: device?.sdk,
    name: device?.name,
    screen: { width: device?.screenWidth, height: device?.screenHeight },
    realDevice: device?.realDevice,
  };
}

/** The `201` body. `members` need not be in order; the answer is by index. */
export function grantedBody(
  lease: { id: string; expiresAt: number; heartbeatSeconds: number },
  members: MemberWithDevice[],
  token: string,
): GrantedBody {
  const answered: GrantedMember[] = [...members]
    .sort((a, b) => a.index - b.index)
    .map((member) => ({
      index: member.index,
      device: leaseDevice(member.udid, member.host, member.device),
      allocatedPorts: parsed(member.allocatedPorts) as AllocatedPorts,
      // The stored bag has no token; this copy carries it, so a client that
      // passes appiumCapabilities through unchanged proves it holds the lease.
      appiumCapabilities: withLeaseToken(parsed(member.capabilityBag), token),
    }));
  const first = answered[0];
  if (!first) throw new Error(`lease ${lease.id} is granted with no member`);
  return {
    leaseId: lease.id,
    leaseToken: token,
    device: first.device,
    expiresAt: lease.expiresAt,
    heartbeatSeconds: lease.heartbeatSeconds,
    allocatedPorts: first.allocatedPorts,
    appiumCapabilities: first.appiumCapabilities,
    members: answered,
  };
}

/** The `202` body. */
export function waitingBody(
  lease: { id: string; waitUntil: number | null; heartbeatSeconds: number },
  token: string,
  position: number,
): WaitingBody {
  return {
    leaseId: lease.id,
    leaseToken: token,
    status: 'waiting',
    position,
    waitUntil: lease.waitUntil ?? 0,
    heartbeatSeconds: lease.heartbeatSeconds,
  };
}
