-- AlterTable
ALTER TABLE "Device" ADD COLUMN "ip" TEXT DEFAULT '';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "ai_analysis" TEXT;
ALTER TABLE "Session" ADD COLUMN "tags" TEXT;
ALTER TABLE "Session" ADD COLUMN "trace_id" TEXT;

-- CreateTable
CREATE TABLE "LocatorEtalon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "selector" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "attributes" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SessionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "command_name" TEXT,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "body" TEXT,
    "response" TEXT NOT NULL,
    "screenshot" TEXT,
    "is_success" BOOLEAN,
    "is_error" BOOLEAN NOT NULL DEFAULT false,
    "is_healed" BOOLEAN NOT NULL DEFAULT false,
    "original_selector" TEXT,
    "healed_selector" TEXT,
    "healing_confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "duration" INTEGER,
    "span_id" TEXT,
    "trace_id" TEXT,
    CONSTRAINT "SessionLog_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SessionLog" ("body", "command_name", "createdAt", "id", "is_error", "is_success", "method", "response", "screenshot", "session_id", "subtitle", "title", "updatedAt", "url") SELECT "body", "command_name", "createdAt", "id", "is_error", "is_success", "method", "response", "screenshot", "session_id", "subtitle", "title", "updatedAt", "url" FROM "SessionLog";
DROP TABLE "SessionLog";
ALTER TABLE "new_SessionLog" RENAME TO "SessionLog";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "LocatorEtalon_selector_key" ON "LocatorEtalon"("selector");

