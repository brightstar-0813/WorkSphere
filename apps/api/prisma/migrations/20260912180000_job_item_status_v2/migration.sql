-- Rebuild JobDayItem status model: drop type, expand statuses

ALTER TABLE "JobDayItem" ADD COLUMN IF NOT EXISTS "status_tmp" TEXT;

UPDATE "JobDayItem"
SET "status_tmp" = CASE
  WHEN "status"::text = 'DONE' THEN 'DONE'
  WHEN "status"::text = 'RESOLVED' THEN 'DONE'
  WHEN "type"::text = 'PROGRESS' THEN 'IN_PROGRESS'
  WHEN "type"::text = 'BLOCKER' THEN 'FAILED'
  ELSE 'TODO'
END;

ALTER TABLE "JobDayItem" DROP COLUMN "status";
ALTER TABLE "JobDayItem" DROP COLUMN "type";

DROP TYPE IF EXISTS "JobDayItemStatus";
DROP TYPE IF EXISTS "JobDayItemType";

CREATE TYPE "JobDayItemStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'FAILED', 'BACKLOG', 'OVERDUE');

ALTER TABLE "JobDayItem"
  ADD COLUMN "status" "JobDayItemStatus" NOT NULL DEFAULT 'TODO';

UPDATE "JobDayItem"
SET "status" = "status_tmp"::"JobDayItemStatus";

ALTER TABLE "JobDayItem" DROP COLUMN "status_tmp";

CREATE INDEX IF NOT EXISTS "JobDayItem_logId_status_idx" ON "JobDayItem"("logId", "status");