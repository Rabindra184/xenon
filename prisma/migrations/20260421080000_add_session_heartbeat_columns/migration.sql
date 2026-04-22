-- AlterTable
ALTER TABLE "Session" ADD COLUMN "last_heartbeat_at" DATETIME;
ALTER TABLE "Session" ADD COLUMN "heartbeat_pid" INTEGER;
ALTER TABLE "Session" ADD COLUMN "heartbeat_host" TEXT;
CREATE INDEX IF NOT EXISTS "Session_status_last_heartbeat_at_idx" ON "Session"("status", "last_heartbeat_at");
