-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "deviceUdid" TEXT NOT NULL,
    "deviceHost" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "teamId" TEXT,
    "buildId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" REAL NOT NULL,
    "heartbeatSeconds" INTEGER NOT NULL DEFAULT 30,
    "lastHeartbeatAt" REAL NOT NULL,
    "allocatedPorts" TEXT NOT NULL,
    "capabilityBag" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PortLease" (
    "port" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purpose" TEXT NOT NULL,
    "leasedToUdid" TEXT NOT NULL,
    "leasedToHost" TEXT NOT NULL DEFAULT '',
    "leaseId" TEXT,
    "leasedToPid" INTEGER,
    "leasedAt" REAL NOT NULL,
    "expiresAt" REAL NOT NULL
);
INSERT INTO "new_PortLease" ("expiresAt", "leasedAt", "leasedToPid", "leasedToUdid", "port", "purpose") SELECT "expiresAt", "leasedAt", "leasedToPid", "leasedToUdid", "port", "purpose" FROM "PortLease";
DROP TABLE "PortLease";
ALTER TABLE "new_PortLease" RENAME TO "PortLease";
CREATE INDEX "PortLease_purpose_expiresAt_idx" ON "PortLease"("purpose", "expiresAt");
CREATE INDEX "PortLease_leasedToUdid_idx" ON "PortLease"("leasedToUdid");
CREATE INDEX "PortLease_leaseId_idx" ON "PortLease"("leaseId");
CREATE INDEX "PortLease_expiresAt_idx" ON "PortLease"("expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Lease_status_expiresAt_idx" ON "Lease"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Lease_status_lastHeartbeatAt_heartbeatSeconds_idx" ON "Lease"("status", "lastHeartbeatAt", "heartbeatSeconds");

-- CreateIndex
CREATE INDEX "Lease_actorId_idx" ON "Lease"("actorId");

-- CreateIndex
CREATE INDEX "Lease_deviceUdid_deviceHost_idx" ON "Lease"("deviceUdid", "deviceHost");
