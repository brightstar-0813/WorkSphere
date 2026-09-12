-- CreateEnum
CREATE TYPE "BidSource" AS ENUM ('MANUAL', 'SHEET');

-- CreateEnum
CREATE TYPE "CapturedJobStatus" AS ENUM ('NEW', 'QUEUED', 'DISMISSED', 'BIDDED');

-- AlterTable HuntingProfile
ALTER TABLE "HuntingProfile" ADD COLUMN "spreadsheetUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HuntingProfile" ADD COLUMN "sheetsWebAppUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HuntingProfile" ADD COLUMN "sheetSyncedAt" TIMESTAMP(3);

-- AlterTable HuntingBid
ALTER TABLE "HuntingBid" ADD COLUMN "source" "BidSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "HuntingBid" ADD COLUMN "sheetKey" TEXT;
ALTER TABLE "HuntingBid" ADD COLUMN "salary" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "HuntingBid_profileId_sheetKey_idx" ON "HuntingBid"("profileId", "sheetKey");

-- CreateTable
CREATE TABLE "CapturedJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "externalId" TEXT,
    "platform" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT,
    "salary" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "status" "CapturedJobStatus" NOT NULL DEFAULT 'NEW',
    "payloadJson" TEXT NOT NULL DEFAULT '',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapturedJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CapturedJob_userId_idx" ON "CapturedJob"("userId");

-- CreateIndex
CREATE INDEX "CapturedJob_profileId_status_idx" ON "CapturedJob"("profileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CapturedJob_profileId_externalId_key" ON "CapturedJob"("profileId", "externalId");

-- AddForeignKey
ALTER TABLE "CapturedJob" ADD CONSTRAINT "CapturedJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapturedJob" ADD CONSTRAINT "CapturedJob_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "HuntingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
