-- RedefineTables
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionLog_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SessionLog" ("body", "command_name", "createdAt", "id", "is_success", "method", "response", "screenshot", "session_id", "subtitle", "title", "updatedAt", "url") SELECT "body", "command_name", "createdAt", "id", "is_success", "method", "response", "screenshot", "session_id", "subtitle", "title", "updatedAt", "url" FROM "SessionLog";
DROP TABLE "SessionLog";
ALTER TABLE "new_SessionLog" RENAME TO "SessionLog";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
