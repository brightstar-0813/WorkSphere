-- Rename body -> title (work item name); add optional description
ALTER TABLE "JobDayItem" RENAME COLUMN "body" TO "title";
ALTER TABLE "JobDayItem" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
