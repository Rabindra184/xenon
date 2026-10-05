import { Platform } from '../types/Platform';

export interface IDevice {
  systemPort?: number;
  host: string;
  proxyPort?: number;
  proxyHost?: string;
  wdaLocalPort?: number;
  name: string;
  udid: string;
  state: string;
  sdk: string;
  platform: Platform;
  deviceType: string;
  busy: boolean;
  userBlocked: boolean;
  realDevice: boolean;

  session_id?: string;
  offline?: boolean;
  mjpegServerPort?: number;
  lastCmdExecutedAt?: number;
  totalUtilizationTimeMilliSec: number;
  sessionStartTime: number;
  newCommandTimeout?: number;
  cloud?: any;
  derivedDataPath?: string;
  chromeDriverPath?: any;
  capability?: any;
  adbRemoteHost?: string;
  adbPort?: number;
  nodeId?: string;
  screenWidth?: string;
  screenHeight?: string;
  dashboard_link?: string;
  total_session_count?: number;
  healthStatus?: string;
  healthCheckError?: string;
  lastHealthCheckAt?: number;

  // Reservation fields
  reservedBy?: string;
  /** Who took the reservation (`reservedBy` is the name they typed). */
  reservedByUserId?: string | null;
  reservedUntil?: number;
  reservationReason?: string;

  // Health metric fields
  batteryLevel?: number;
  thermalStatus?: string;
  storageFree?: string;
  tags?: string[];
  sessionProgress?: string;
  totalHealedCount?: number;
  ip?: string;
  cpuArchitecture?: string;

  // Device identity, read at discovery. Null when the device could not say,
  // e.g. an Apple model code not in appleIdentity's table.
  marketingName?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  formFactor?: 'phone' | 'tablet' | 'tv' | null;

  // This server's claim for a session, and on a hub what the phone's node
  // last reported. See src/data-service/deviceClaims.ts.
  claimSessionId?: string | null;
  claimedAt?: number | null;
  nodeBusy?: boolean | null;
  /** On a hub: who holds the phone on its node (a preview hold), from the node's report. */
  nodeHold?: string | null;

  // Phase 2: team ownership (null = shared pool). See https://xenon-6e6.pages.dev/docs/teams.
  teamId?: string | null;
  /** Resolved on read from Team.name; omitted when unassigned or unknown. */
  teamName?: string | null;
}
