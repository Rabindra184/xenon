-- CreateTable
CREATE TABLE "Log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "log_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Log_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
