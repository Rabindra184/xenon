-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "group_id" TEXT NOT NULL,
    "device_udid" TEXT NOT NULL,
    "device_host" TEXT NOT NULL DEFAULT '127.0.0.1',
    "session_id" TEXT,
    "started_at" DATETIME NOT NULL,
    "ended_at" DATETIME,
    "status" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "duration_ms" INTEGER,
    "size_bytes" INTEGER,
    "device_snapshot" TEXT,
    "fail_reason" TEXT,
    CONSTRAINT "Recording_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recording_id" TEXT NOT NULL,
    "timecode_ms" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bookmark_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recording_id" TEXT NOT NULL,
    "timecode_ms" INTEGER NOT NULL,
    "shape" TEXT NOT NULL,
    "geometry" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "text" TEXT,
    "author" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Annotation_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Recording_group_id_idx" ON "Recording"("group_id");

-- CreateIndex
CREATE INDEX "Recording_device_udid_idx" ON "Recording"("device_udid");

-- CreateIndex
CREATE INDEX "Recording_started_at_idx" ON "Recording"("started_at");

-- CreateIndex
CREATE INDEX "Bookmark_recording_id_timecode_ms_idx" ON "Bookmark"("recording_id", "timecode_ms");

-- CreateIndex
CREATE INDEX "Annotation_recording_id_timecode_ms_idx" ON "Annotation"("recording_id", "timecode_ms");
