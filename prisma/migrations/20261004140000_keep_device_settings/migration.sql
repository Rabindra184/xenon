-- CreateTable
CREATE TABLE "DeviceSetting" (
    "udid" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "teamId" TEXT,
    "tags" TEXT,
    "userBlocked" BOOLEAN NOT NULL DEFAULT false,
    "reservationReason" TEXT,
    "reservedBy" TEXT,
    "reservedByUserId" TEXT,
    "reservedUntil" REAL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("udid", "host"),
    CONSTRAINT "DeviceSetting_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DeviceSetting_teamId_idx" ON "DeviceSetting"("teamId");
