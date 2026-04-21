-- AlterTable
ALTER TABLE "Device" ADD COLUMN "owning_session_id" TEXT;
ALTER TABLE "Device" ADD COLUMN "locked_at" REAL;
CREATE INDEX IF NOT EXISTS "Device_owning_session_id_idx" ON "Device"("owning_session_id");
