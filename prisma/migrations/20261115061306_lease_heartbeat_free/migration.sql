-- AlterTable
ALTER TABLE "Lease" ADD COLUMN "grantId" TEXT;
ALTER TABLE "Lease" ADD COLUMN "heartbeatFree" BOOLEAN;

-- CreateIndex
CREATE INDEX "Lease_grantId_idx" ON "Lease"("grantId");
