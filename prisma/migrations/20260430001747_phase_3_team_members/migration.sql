-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("teamId", "userId"),
    CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- Backfill team membership from existing ApiKey.teamId links.
-- Skips Legacy Admin's adopted keys to avoid polluting team rosters.
INSERT INTO "TeamMember" ("teamId", "userId", "createdAt")
SELECT DISTINCT "ApiKey"."teamId", "ApiKey"."userId", datetime('now')
FROM "ApiKey"
INNER JOIN "User" ON "User"."id" = "ApiKey"."userId"
WHERE "ApiKey"."teamId" IS NOT NULL
  AND "ApiKey"."userId" IS NOT NULL
  AND "User"."email" != 'legacy-admin@xenon.local';
