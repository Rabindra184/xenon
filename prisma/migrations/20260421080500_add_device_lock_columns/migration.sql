-- AlterTable
ALTER TABLE "Device" ADD COLUMN "owning_session_id" TEXT;
ALTER TABLE "Device" ADD COLUMN "locked_at" REAL;
CREATE INDEX "Device_owning_session_id_idx" ON "Device"("owning_session_id");
