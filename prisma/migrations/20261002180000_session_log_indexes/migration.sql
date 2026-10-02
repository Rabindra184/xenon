-- CreateIndex
CREATE INDEX "SessionLog_is_healed_createdAt_idx" ON "SessionLog"("is_healed", "createdAt");

-- CreateIndex
CREATE INDEX "SessionLog_session_id_createdAt_idx" ON "SessionLog"("session_id", "createdAt");
