-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "alertEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "remindMinutes" INTEGER NOT NULL DEFAULT 30;
