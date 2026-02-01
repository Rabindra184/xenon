-- AlterTable
ALTER TABLE "Device" ADD COLUMN "healthCheckError" TEXT;
ALTER TABLE "Device" ADD COLUMN "healthStatus" TEXT DEFAULT 'Healthy';
ALTER TABLE "Device" ADD COLUMN "lastHealthCheckAt" REAL;
