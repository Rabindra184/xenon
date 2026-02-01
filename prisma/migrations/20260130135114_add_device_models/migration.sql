-- CreateTable
CREATE TABLE "Device" (
    "udid" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "systemPort" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "PendingSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "capability_id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "createdAt" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "CLIArgs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "args" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingSession_capability_id_key" ON "PendingSession"("capability_id");
