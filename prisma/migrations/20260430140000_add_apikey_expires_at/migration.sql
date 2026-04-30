-- Phase: token expiration. Adds an optional expiresAt timestamp to ApiKey.
-- ApiKeyService.verify() / verifyPair() reject rows whose expiresAt is in
-- the past, so a token can be issued with a hard cap (e.g. 30 days for CI).
ALTER TABLE "ApiKey" ADD COLUMN "expiresAt" DATETIME;

-- Used by the verify path to short-circuit expired tokens. SQLite ignores
-- the index for the default verify-by-keyHash query (PK lookup wins) but
-- keeps it useful for any operator query that filters by expiry.
CREATE INDEX "ApiKey_expiresAt_idx" ON "ApiKey"("expiresAt");
