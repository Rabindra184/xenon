-- CreateTable
CREATE TABLE "Profiling" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_id" TEXT NOT NULL,
    "cpu" TEXT,
    "memory" TEXT,
    "total_cpu_used" TEXT,
    "total_memory_used" TEXT,
    "raw_cpu_log" TEXT,
    "raw_memory_log" TEXT,
    "timestamp" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profiling_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "build_id" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "desired_capabilities" TEXT NOT NULL,
    "session_capabilities" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "has_live_video" BOOLEAN NOT NULL,
    "video_recording_enabled" BOOLEAN NOT NULL DEFAULT true,
    "video_recording" TEXT,
    "startTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" DATETIME,
    "failure_reason" TEXT,
    "is_profiling_available" BOOLEAN NOT NULL DEFAULT false,
    "device_info" TEXT,
    "device_udid" TEXT NOT NULL,
    "device_platform" TEXT NOT NULL,
    "device_version" TEXT NOT NULL,
    "device_name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "Build" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("build_id", "createdAt", "desired_capabilities", "device_name", "device_platform", "device_udid", "device_version", "endTime", "failure_reason", "has_live_video", "id", "name", "node_id", "session_capabilities", "startTime", "status", "updatedAt", "video_recording", "video_recording_enabled") SELECT "build_id", "createdAt", "desired_capabilities", "device_name", "device_platform", "device_udid", "device_version", "endTime", "failure_reason", "has_live_video", "id", "name", "node_id", "session_capabilities", "startTime", "status", "updatedAt", "video_recording", "video_recording_enabled" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
