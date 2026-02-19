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
}
