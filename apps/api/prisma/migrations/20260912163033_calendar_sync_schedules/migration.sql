-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "allDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "HuntingApplication" ADD COLUMN     "scheduleEndsAt" TIMESTAMP(3),
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CalendarEvent_userId_sourceType_sourceId_idx" ON "CalendarEvent"("userId", "sourceType", "sourceId");
