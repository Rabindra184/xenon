-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "rateLimit" INTEGER NOT NULL DEFAULT 300,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "lastUsedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
