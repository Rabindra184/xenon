-- CreateTable
CREATE TABLE "McpClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "McpGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "rotatedFromId" TEXT
);

-- CreateIndex
CREATE INDEX "McpClient_lastUsedAt_idx" ON "McpClient"("lastUsedAt");

-- CreateIndex
CREATE INDEX "McpGrant_userId_idx" ON "McpGrant"("userId");

-- CreateIndex
CREATE INDEX "McpGrant_clientId_idx" ON "McpGrant"("clientId");

-- CreateIndex
CREATE INDEX "McpGrant_tokenHash_idx" ON "McpGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "McpGrant_rotatedFromId_idx" ON "McpGrant"("rotatedFromId");
