-- CreateIndex
CREATE INDEX "Log_session_id_log_type_createdAt_idx" ON "Log"("session_id", "log_type", "createdAt");

-- CreateIndex
CREATE INDEX "Profiling_session_id_timestamp_idx" ON "Profiling"("session_id", "timestamp");
