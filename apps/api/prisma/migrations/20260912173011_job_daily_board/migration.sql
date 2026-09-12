-- CreateEnum
CREATE TYPE "JobDayItemType" AS ENUM ('TODO', 'BLOCKER', 'PROGRESS');

-- CreateEnum
CREATE TYPE "JobDayItemStatus" AS ENUM ('OPEN', 'DONE', 'RESOLVED');

-- CreateTable
CREATE TABLE "JobDayLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDayLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDayItem" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "type" "JobDayItemType" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "JobDayItemStatus" NOT NULL DEFAULT 'OPEN',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDayItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobDayLog_userId_day_idx" ON "JobDayLog"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "JobDayLog_jobId_day_key" ON "JobDayLog"("jobId", "day");

-- CreateIndex
CREATE INDEX "JobDayItem_logId_type_idx" ON "JobDayItem"("logId", "type");

-- AddForeignKey
ALTER TABLE "JobDayLog" ADD CONSTRAINT "JobDayLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDayLog" ADD CONSTRAINT "JobDayLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDayItem" ADD CONSTRAINT "JobDayItem_logId_fkey" FOREIGN KEY ("logId") REFERENCES "JobDayLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
