
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  Serializable: 'Serializable'
});

exports.Prisma.BuildScalarFieldEnum = {
  id: 'id',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SessionScalarFieldEnum = {
  id: 'id',
  build_id: 'build_id',
  name: 'name',
  status: 'status',
  desired_capabilities: 'desired_capabilities',
  session_capabilities: 'session_capabilities',
  node_id: 'node_id',
  has_live_video: 'has_live_video',
  video_recording_enabled: 'video_recording_enabled',
  video_recording: 'video_recording',
  startTime: 'startTime',
  endTime: 'endTime',
  failure_reason: 'failure_reason',
  is_profiling_available: 'is_profiling_available',
  device_info: 'device_info',
  device_udid: 'device_udid',
  device_platform: 'device_platform',
  device_version: 'device_version',
  device_name: 'device_name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  performance_trace: 'performance_trace',
  failure_category: 'failure_category',
  ai_analysis: 'ai_analysis',
  tags: 'tags',
  trace_id: 'trace_id',
  last_heartbeat_at: 'last_heartbeat_at',
  heartbeat_pid: 'heartbeat_pid',
  heartbeat_host: 'heartbeat_host'
};

exports.Prisma.SessionLogScalarFieldEnum = {
  id: 'id',
  session_id: 'session_id',
  command_name: 'command_name',
  url: 'url',
  method: 'method',
  title: 'title',
  subtitle: 'subtitle',
  body: 'body',
  response: 'response',
  screenshot: 'screenshot',
  is_success: 'is_success',
  is_error: 'is_error',
  is_healed: 'is_healed',
  original_selector: 'original_selector',
  healed_selector: 'healed_selector',
  healing_confidence: 'healing_confidence',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  duration: 'duration',
  span_id: 'span_id',
  trace_id: 'trace_id'
};

exports.Prisma.LogScalarFieldEnum = {
  id: 'id',
  session_id: 'session_id',
  log_type: 'log_type',
  message: 'message',
  timestamp: 'timestamp',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ProfilingScalarFieldEnum = {
  id: 'id',
  session_id: 'session_id',
  cpu: 'cpu',
  memory: 'memory',
  total_cpu_used: 'total_cpu_used',
  total_memory_used: 'total_memory_used',
  raw_cpu_log: 'raw_cpu_log',
  raw_memory_log: 'raw_memory_log',
  timestamp: 'timestamp',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AppScalarFieldEnum = {
  id: 'id',
  name: 'name',
  filename: 'filename',
  filepath: 'filepath',
  mimetype: 'mimetype',
  size: 'size',
  packageName: 'packageName',
  version: 'version',
  platform: 'platform',
  md5: 'md5',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DeviceScalarFieldEnum = {
  udid: 'udid',
  host: 'host',
  systemPort: 'systemPort',
  proxyPort: 'proxyPort',
  proxyHost: 'proxyHost',
  wdaLocalPort: 'wdaLocalPort',
  name: 'name',
  state: 'state',
  sdk: 'sdk',
  platform: 'platform',
  deviceType: 'deviceType',
  busy: 'busy',
  userBlocked: 'userBlocked',
  realDevice: 'realDevice',
  session_id: 'session_id',
  offline: 'offline',
  mjpegServerPort: 'mjpegServerPort',
  lastCmdExecutedAt: 'lastCmdExecutedAt',
  totalUtilizationTimeMilliSec: 'totalUtilizationTimeMilliSec',
  sessionStartTime: 'sessionStartTime',
  newCommandTimeout: 'newCommandTimeout',
  cloud: 'cloud',
  derivedDataPath: 'derivedDataPath',
  chromeDriverPath: 'chromeDriverPath',
  capability: 'capability',
  adbRemoteHost: 'adbRemoteHost',
  adbPort: 'adbPort',
  nodeId: 'nodeId',
  screenWidth: 'screenWidth',
  screenHeight: 'screenHeight',
  dashboard_link: 'dashboard_link',
  total_session_count: 'total_session_count',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  healthCheckError: 'healthCheckError',
  healthStatus: 'healthStatus',
  lastHealthCheckAt: 'lastHealthCheckAt',
  batteryLevel: 'batteryLevel',
  reservationReason: 'reservationReason',
  reservedBy: 'reservedBy',
  reservedUntil: 'reservedUntil',
  storageFree: 'storageFree',
  tags: 'tags',
  thermalStatus: 'thermalStatus',
  sessionProgress: 'sessionProgress',
  totalHealedCount: 'totalHealedCount',
  ip: 'ip',
  cpuArchitecture: 'cpuArchitecture',
  owning_session_id: 'owning_session_id',
  locked_at: 'locked_at'
};

exports.Prisma.PendingSessionScalarFieldEnum = {
  id: 'id',
  capability_id: 'capability_id',
  capability: 'capability',
  createdAt: 'createdAt'
};

exports.Prisma.CLIArgsScalarFieldEnum = {
  id: 'id',
  args: 'args',
  createdAt: 'createdAt'
};

exports.Prisma.WebhookConfigScalarFieldEnum = {
  id: 'id',
  url: 'url',
  type: 'type',
  events: 'events',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  payloadTemplate: 'payloadTemplate'
};

exports.Prisma.WebConfigScalarFieldEnum = {
  id: 'id',
  name: 'name',
  value: 'value',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LocatorEtalonScalarFieldEnum = {
  id: 'id',
  selector: 'selector',
  strategy: 'strategy',
  attributes: 'attributes',
  nodeName: 'nodeName',
  lastSeen: 'lastSeen',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PortLeaseScalarFieldEnum = {
  port: 'port',
  purpose: 'purpose',
  leasedToUdid: 'leasedToUdid',
  leasedToPid: 'leasedToPid',
  leasedAt: 'leasedAt',
  expiresAt: 'expiresAt'
};

exports.Prisma.ApiKeyScalarFieldEnum = {
  id: 'id',
  name: 'name',
  keyHash: 'keyHash',
  scopes: 'scopes',
  rateLimit: 'rateLimit',
  createdAt: 'createdAt',
  revokedAt: 'revokedAt',
  lastUsedAt: 'lastUsedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};


exports.Prisma.ModelName = {
  Build: 'Build',
  Session: 'Session',
  SessionLog: 'SessionLog',
  Log: 'Log',
  Profiling: 'Profiling',
  App: 'App',
  Device: 'Device',
  PendingSession: 'PendingSession',
  CLIArgs: 'CLIArgs',
  WebhookConfig: 'WebhookConfig',
  WebConfig: 'WebConfig',
  LocatorEtalon: 'LocatorEtalon',
  PortLease: 'PortLease',
  ApiKey: 'ApiKey'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
