-- CreateTable
CREATE TABLE "ManagedProcess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pid" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "udid" TEXT NOT NULL,
    "port" INTEGER,
    "type" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagedProcess_pid_key" ON "ManagedProcess"("pid");
