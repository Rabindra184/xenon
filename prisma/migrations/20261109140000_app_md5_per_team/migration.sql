-- DropIndex
DROP INDEX "App_md5_key";

-- AlterTable
ALTER TABLE "App" ADD COLUMN "buildNumber" TEXT;

-- CreateIndex
CREATE INDEX "App_md5_idx" ON "App"("md5");

