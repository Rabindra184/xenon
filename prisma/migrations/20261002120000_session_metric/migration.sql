-- CreateTable
CREATE TABLE "SessionMetric" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_id" TEXT NOT NULL,
    "at" REAL NOT NULL,
    "device_cpu_pct" REAL,
    "device_mem_mb" REAL,
    "device_mem_total" REAL,
    "app_cpu_pct" REAL,
    "app_mem_mb" REAL,
    "app_id" TEXT,
    CONSTRAINT "SessionMetric_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SessionMetric_session_id_at_idx" ON "SessionMetric"("session_id", "at");

