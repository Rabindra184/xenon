import _ from 'lodash';
import { Prisma } from '../generated/client';
import { IDevice } from '../interfaces/IDevice';

type DeviceColumn = keyof typeof Prisma.DeviceScalarFieldEnum;

/**
 * Who writes each Device column.
 *
 * The periodic device sync reads every row, spends seconds in adb or simctl,
 * then writes each phone back. For a phone it already knows it may write only
 * what discovery itself observes (`discovery`). Every other column has
 * another writer: a session's lock, a preview's hold, an admin's block,
 * reservation or team, a counter, the health check. A sync that read the row
 * before one of those writes would put the old value back. That erased a live
 * preview hold on the lab, and could hand a phone in a session to a second one.
 *
 * A hub also stores its nodes' phones, from each node's report
 * (`POST /xenon/api/register`, NODE_REPORT_FIELDS). The report carries what
 * the node observes of its own phone: `discovery`, and `observed` (its health,
 * which only the server driving the phone can check). It never writes a
 * `runtime` column: the hub's claim for a session, and the settings the hub
 * owns for the phone (team, tags, reservation, block). Whether the node says
 * the phone is busy goes to `nodeBusy` (`report`), never to `busy`
 * (deviceClaims.ts).
 *
 * Typed over every column, so a new column won't compile until it is placed.
 */
const OWNER: Record<DeviceColumn, 'key' | 'discovery' | 'observed' | 'report' | 'runtime'> = {
  udid: 'key',
  host: 'key',
  createdAt: 'key',
  updatedAt: 'key',

  name: 'discovery',
  state: 'discovery',
  sdk: 'discovery',
  platform: 'discovery',
  deviceType: 'discovery',
  realDevice: 'discovery',
  ip: 'discovery',
  cpuArchitecture: 'discovery',
  marketingName: 'discovery',
  model: 'discovery',
  manufacturer: 'discovery',
  formFactor: 'discovery',
  systemPort: 'discovery',
  proxyPort: 'discovery',
  proxyHost: 'discovery',
  wdaLocalPort: 'discovery',
  mjpegServerPort: 'discovery',
  screenWidth: 'discovery',
  screenHeight: 'discovery',
  adbRemoteHost: 'discovery',
  adbPort: 'discovery',
  nodeId: 'discovery',
  cloud: 'discovery',
  capability: 'discovery',
  derivedDataPath: 'discovery',
  chromeDriverPath: 'discovery',

  busy: 'runtime',
  session_id: 'runtime',
  sessionProgress: 'runtime',
  sessionStartTime: 'runtime',
  lastCmdExecutedAt: 'runtime',
  newCommandTimeout: 'runtime',
  owningSessionId: 'runtime',
  lockedAt: 'runtime',
  claimSessionId: 'runtime',
  claimedAt: 'runtime',
  userBlocked: 'runtime',
  reservationReason: 'runtime',
  reservedBy: 'runtime',
  reservedUntil: 'runtime',
  teamId: 'runtime',
  tags: 'runtime',
  totalUtilizationTimeMilliSec: 'runtime',
  total_session_count: 'runtime',
  dashboard_link: 'runtime',

  offline: 'observed',
  totalHealedCount: 'observed',
  healthStatus: 'observed',
  healthCheckError: 'observed',
  lastHealthCheckAt: 'observed',
  batteryLevel: 'observed',
  thermalStatus: 'observed',
  storageFree: 'observed',

  nodeBusy: 'report',
};

/** The columns a sync may write to a phone it already knows. */
export const DISCOVERY_FIELDS: ReadonlySet<string> = new Set(
  (Object.keys(OWNER) as DeviceColumn[]).filter((column) => OWNER[column] === 'discovery'),
);

/** Only the discovery columns of `data`. */
export function pickDiscoveryFields<T extends Record<string, unknown>>(data: T): Partial<T> {
  return _.pickBy(data, (_value, key) => DISCOVERY_FIELDS.has(key)) as Partial<T>;
}

/**
 * The columns a hub takes from a node's report of a phone: what the node
 * observes of it. Not `nodeBusy`, which the hub sets from the report's `busy`.
 */
export const NODE_REPORT_FIELDS: ReadonlySet<string> = new Set(
  (Object.keys(OWNER) as DeviceColumn[]).filter(
    (column) => OWNER[column] === 'discovery' || OWNER[column] === 'observed',
  ),
);

/** Only the columns of `data` a hub takes from a node's report. */
export function pickNodeReportFields<T extends Record<string, unknown>>(data: T): Partial<T> {
  return _.pickBy(data, (_value, key) => NODE_REPORT_FIELDS.has(key)) as Partial<T>;
}

/**
 * What a sync writes to a phone it already knows: the discovery columns whose
 * value differs from `known`, the row the sync started from. Discovery hands
 * that row back with its own findings on top (AndroidDeviceManager and
 * IOSDiscoveryService spread it), so an unchanged value is only the sync's
 * copy, and writing it would undo whatever was written since, such as a
 * stream's port.
 */
export function discoveryChanges(discovered: Partial<IDevice>, known: IDevice): Partial<IDevice> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(discovered)) {
    if (value === undefined || !DISCOVERY_FIELDS.has(key)) continue;
    if (!_.isEqual(value, (known as unknown as Record<string, unknown>)[key])) changes[key] = value;
  }
  return changes as Partial<IDevice>;
}
