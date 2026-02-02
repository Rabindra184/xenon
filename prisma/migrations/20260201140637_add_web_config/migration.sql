/*
  Warnings:

  - You are about to drop the `ManagedProcess` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ManagedProcess";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "WebConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WebConfig_name_key" ON "WebConfig"("name");
