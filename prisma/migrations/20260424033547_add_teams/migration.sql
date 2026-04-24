-- AlterTable
ALTER TABLE "Session" ADD COLUMN "api_key_id" TEXT;

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "rateLimit" INTEGER NOT NULL DEFAULT 300,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "lastUsedAt" DATETIME,
    "teamId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    CONSTRAINT "ApiKey_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ApiKey" ("createdAt", "id", "keyHash", "lastUsedAt", "name", "rateLimit", "revokedAt", "scopes") SELECT "createdAt", "id", "keyHash", "lastUsedAt", "name", "rateLimit", "revokedAt", "scopes" FROM "ApiKey";
DROP TABLE "ApiKey";
ALTER TABLE "new_ApiKey" RENAME TO "ApiKey";
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX "ApiKey_teamId_idx" ON "ApiKey"("teamId");
CREATE TABLE "new_Device" (
    "udid" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "systemPort" INTEGER,
    "proxyPort" INTEGER,
    "proxyHost" TEXT,
    "wdaLocalPort" INTEGER,
    "name" TEXT DEFAULT 'unknown',
    "state" TEXT DEFAULT 'available',
    "sdk" TEXT DEFAULT 'unknown',
    "platform" TEXT DEFAULT 'unknown',
    "deviceType" TEXT DEFAULT 'real',
    "busy" BOOLEAN DEFAULT false,
    "userBlocked" BOOLEAN DEFAULT false,
    "realDevice" BOOLEAN DEFAULT true,
    "session_id" TEXT,
    "offline" BOOLEAN DEFAULT false,
    "mjpegServerPort" INTEGER,
    "lastCmdExecutedAt" REAL,
    "totalUtilizationTimeMilliSec" REAL NOT NULL DEFAULT 0,
    "sessionStartTime" REAL NOT NULL DEFAULT 0,
    "newCommandTimeout" INTEGER,
    "cloud" TEXT,
    "derivedDataPath" TEXT,
    "chromeDriverPath" TEXT,
    "capability" TEXT,
    "adbRemoteHost" TEXT,
    "adbPort" INTEGER,
    "nodeId" TEXT,
    "screenWidth" TEXT,
    "screenHeight" TEXT,
    "dashboard_link" TEXT,
    "total_session_count" INTEGER DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "healthCheckError" TEXT,
    "healthStatus" TEXT DEFAULT 'Healthy',
    "lastHealthCheckAt" REAL,
    "batteryLevel" INTEGER,
    "reservationReason" TEXT,
    "reservedBy" TEXT,
    "reservedUntil" REAL,
    "storageFree" TEXT,
    "tags" TEXT,
    "thermalStatus" TEXT,
    "sessionProgress" TEXT DEFAULT '',
    "totalHealedCount" INTEGER DEFAULT 0,
    "ip" TEXT DEFAULT '',
    "cpuArchitecture" TEXT,
    "owning_session_id" TEXT,
    "locked_at" REAL,
    "teamId" TEXT,

    PRIMARY KEY ("udid", "host"),
    CONSTRAINT "Device_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Device" ("adbPort", "adbRemoteHost", "batteryLevel", "busy", "capability", "chromeDriverPath", "cloud", "cpuArchitecture", "createdAt", "dashboard_link", "derivedDataPath", "deviceType", "healthCheckError", "healthStatus", "host", "ip", "lastCmdExecutedAt", "lastHealthCheckAt", "locked_at", "mjpegServerPort", "name", "newCommandTimeout", "nodeId", "offline", "owning_session_id", "platform", "proxyHost", "proxyPort", "realDevice", "reservationReason", "reservedBy", "reservedUntil", "screenHeight", "screenWidth", "sdk", "sessionProgress", "sessionStartTime", "session_id", "state", "storageFree", "systemPort", "tags", "thermalStatus", "totalHealedCount", "totalUtilizationTimeMilliSec", "total_session_count", "udid", "updatedAt", "userBlocked", "wdaLocalPort") SELECT "adbPort", "adbRemoteHost", "batteryLevel", "busy", "capability", "chromeDriverPath", "cloud", "cpuArchitecture", "createdAt", "dashboard_link", "derivedDataPath", "deviceType", "healthCheckError", "healthStatus", "host", "ip", "lastCmdExecutedAt", "lastHealthCheckAt", "locked_at", "mjpegServerPort", "name", "newCommandTimeout", "nodeId", "offline", "owning_session_id", "platform", "proxyHost", "proxyPort", "realDevice", "reservationReason", "reservedBy", "reservedUntil", "screenHeight", "screenWidth", "sdk", "sessionProgress", "sessionStartTime", "session_id", "state", "storageFree", "systemPort", "tags", "thermalStatus", "totalHealedCount", "totalUtilizationTimeMilliSec", "total_session_count", "udid", "updatedAt", "userBlocked", "wdaLocalPort" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
CREATE INDEX "Device_owning_session_id_idx" ON "Device"("owning_session_id");
CREATE INDEX "Device_teamId_idx" ON "Device"("teamId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE INDEX "Session_api_key_id_idx" ON "Session"("api_key_id");

