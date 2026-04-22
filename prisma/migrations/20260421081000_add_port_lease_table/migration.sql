-- CreateTable
CREATE TABLE IF NOT EXISTS "PortLease" (
    "port" INTEGER NOT NULL PRIMARY KEY,
    "purpose" TEXT NOT NULL,
    "leasedToUdid" TEXT NOT NULL,
    "leasedToPid" INTEGER,
    "leasedAt" REAL NOT NULL,
    "expiresAt" REAL NOT NULL
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PortLease_purpose_expiresAt_idx" ON "PortLease"("purpose", "expiresAt");
CREATE INDEX IF NOT EXISTS "PortLease_leasedToUdid_idx" ON "PortLease"("leasedToUdid");
