-- CreateTable
CREATE TABLE "PortLease" (
    "port" INTEGER NOT NULL PRIMARY KEY,
    "purpose" TEXT NOT NULL,
    "leasedToUdid" TEXT NOT NULL,
    "leasedToPid" INTEGER,
    "leasedAt" REAL NOT NULL,
    "expiresAt" REAL NOT NULL
);

-- CreateIndex
CREATE INDEX "PortLease_purpose_expiresAt_idx" ON "PortLease"("purpose", "expiresAt");
CREATE INDEX "PortLease_leasedToUdid_idx" ON "PortLease"("leasedToUdid");
