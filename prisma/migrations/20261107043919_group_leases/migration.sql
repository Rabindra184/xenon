-- AlterTable
ALTER TABLE "Lease" ADD COLUMN "callerTeamIds" TEXT;
ALTER TABLE "Lease" ADD COLUMN "durationMs" REAL;
ALTER TABLE "Lease" ADD COLUMN "endReason" TEXT;
ALTER TABLE "Lease" ADD COLUMN "requestedMembers" TEXT;
ALTER TABLE "Lease" ADD COLUMN "waitUntil" REAL;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "lease_id" TEXT;

-- CreateTable
CREATE TABLE "LeaseMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leaseId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "udid" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "allocatedPorts" TEXT NOT NULL DEFAULT '{}',
    "capabilityBag" TEXT NOT NULL DEFAULT '',
    "heldAt" REAL NOT NULL,
    CONSTRAINT "LeaseMember_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LeaseMember_udid_host_idx" ON "LeaseMember"("udid", "host");

-- CreateIndex
CREATE INDEX "LeaseMember_leaseId_idx" ON "LeaseMember"("leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseMember_leaseId_index_key" ON "LeaseMember"("leaseId", "index");

-- CreateIndex
CREATE INDEX "Session_lease_id_idx" ON "Session"("lease_id");
