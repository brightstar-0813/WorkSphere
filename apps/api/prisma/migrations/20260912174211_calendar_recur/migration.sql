-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "recur" TEXT NOT NULL DEFAULT 'ONCE',
ADD COLUMN     "recurUntil" TIMESTAMP(3);
