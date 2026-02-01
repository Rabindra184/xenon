-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Device" (
    "udid" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "systemPort" INTEGER,
    "proxyPort" INTEGER,
    "proxyHost" TEXT,
    "wdaLocalPort" INTEGER,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "sdk" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "busy" BOOLEAN NOT NULL,
    "userBlocked" BOOLEAN NOT NULL,
    "realDevice" BOOLEAN NOT NULL,
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

    PRIMARY KEY ("udid", "host")
);
INSERT INTO "new_Device" ("adbPort", "adbRemoteHost", "busy", "capability", "chromeDriverPath", "cloud", "createdAt", "dashboard_link", "derivedDataPath", "deviceType", "host", "lastCmdExecutedAt", "mjpegServerPort", "name", "newCommandTimeout", "nodeId", "offline", "platform", "proxyHost", "proxyPort", "realDevice", "screenHeight", "screenWidth", "sdk", "sessionStartTime", "session_id", "state", "systemPort", "totalUtilizationTimeMilliSec", "total_session_count", "udid", "updatedAt", "userBlocked", "wdaLocalPort") SELECT "adbPort", "adbRemoteHost", "busy", "capability", "chromeDriverPath", "cloud", "createdAt", "dashboard_link", "derivedDataPath", "deviceType", "host", "lastCmdExecutedAt", "mjpegServerPort", "name", "newCommandTimeout", "nodeId", "offline", "platform", "proxyHost", "proxyPort", "realDevice", "screenHeight", "screenWidth", "sdk", "sessionStartTime", "session_id", "state", "systemPort", "totalUtilizationTimeMilliSec", "total_session_count", "udid", "updatedAt", "userBlocked", "wdaLocalPort" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
