-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "packageName" TEXT,
    "version" TEXT,
    "platform" TEXT,
    "md5" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "App_md5_key" ON "App"("md5");
