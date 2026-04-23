-- CreateIndex
CREATE INDEX "Session_build_id_idx" ON "Session"("build_id");

-- CreateIndex
CREATE INDEX "Session_device_udid_idx" ON "Session"("device_udid");

-- CreateIndex
CREATE INDEX "Session_device_platform_status_idx" ON "Session"("device_platform", "status");
