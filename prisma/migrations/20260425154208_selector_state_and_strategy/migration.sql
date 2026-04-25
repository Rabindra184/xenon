-- AlterTable
ALTER TABLE "SessionLog" ADD COLUMN "healed_strategy" TEXT;
ALTER TABLE "SessionLog" ADD COLUMN "original_strategy" TEXT;

-- CreateTable
CREATE TABLE "SelectorState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "original_strategy" TEXT NOT NULL,
    "original_selector" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fixed_at" DATETIME,
    "fixed_by_api_key" TEXT,
    "resolved_at" DATETIME,
    "muted_at" DATETIME,
    "muted_by_api_key" TEXT,
    "regression_count" INTEGER NOT NULL DEFAULT 0,
    "clean_builds_count" INTEGER NOT NULL DEFAULT 0,
    "last_event_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SelectorState_status_idx" ON "SelectorState"("status");

-- CreateIndex
CREATE INDEX "SelectorState_fixed_at_idx" ON "SelectorState"("fixed_at");

-- CreateIndex
CREATE UNIQUE INDEX "SelectorState_original_strategy_original_selector_key" ON "SelectorState"("original_strategy", "original_selector");

-- CreateIndex
CREATE INDEX "SessionLog_original_strategy_original_selector_createdAt_idx" ON "SessionLog"("original_strategy", "original_selector", "createdAt");
