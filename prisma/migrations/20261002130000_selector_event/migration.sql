-- CreateTable
CREATE TABLE "SelectorEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "original_strategy" TEXT NOT NULL,
    "original_selector" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SelectorEvent_original_strategy_original_selector_createdAt_idx" ON "SelectorEvent"("original_strategy", "original_selector", "createdAt");
