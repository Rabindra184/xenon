-- AlterTable
ALTER TABLE "Device" ADD COLUMN "claimSessionId" TEXT;
ALTER TABLE "Device" ADD COLUMN "claimedAt" REAL;
ALTER TABLE "Device" ADD COLUMN "nodeBusy" BOOLEAN DEFAULT false;

-- CreateIndex
CREATE INDEX "Device_claimSessionId_idx" ON "Device"("claimSessionId");

