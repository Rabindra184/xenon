-- AlterTable
ALTER TABLE "Device" ADD COLUMN "batteryLevel" INTEGER;
ALTER TABLE "Device" ADD COLUMN "reservationReason" TEXT;
ALTER TABLE "Device" ADD COLUMN "reservedBy" TEXT;
ALTER TABLE "Device" ADD COLUMN "reservedUntil" REAL;
ALTER TABLE "Device" ADD COLUMN "storageFree" TEXT;
ALTER TABLE "Device" ADD COLUMN "tags" TEXT;
ALTER TABLE "Device" ADD COLUMN "thermalStatus" TEXT;

-- AlterTable
ALTER TABLE "WebhookConfig" ADD COLUMN "payloadTemplate" TEXT;
