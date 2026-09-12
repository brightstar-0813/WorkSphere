-- CreateEnum
CREATE TYPE "CalendarShareStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "CalendarShare" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "CalendarShareStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "CalendarShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarIcsFeed" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Outlook',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarIcsFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarShare_ownerId_status_idx" ON "CalendarShare"("ownerId", "status");

-- CreateIndex
CREATE INDEX "CalendarShare_requesterId_status_idx" ON "CalendarShare"("requesterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarShare_requesterId_ownerId_key" ON "CalendarShare"("requesterId", "ownerId");

-- CreateIndex
CREATE INDEX "CalendarIcsFeed_userId_idx" ON "CalendarIcsFeed"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarIcsFeed_userId_url_key" ON "CalendarIcsFeed"("userId", "url");

-- AddForeignKey
ALTER TABLE "CalendarShare" ADD CONSTRAINT "CalendarShare_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarShare" ADD CONSTRAINT "CalendarShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarIcsFeed" ADD CONSTRAINT "CalendarIcsFeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
