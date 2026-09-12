-- Allow calendar share invites to any email (owner may not have an account yet)
ALTER TABLE "CalendarShare" ADD COLUMN IF NOT EXISTS "ownerEmail" TEXT;

-- Backfill from linked owner users
UPDATE "CalendarShare" AS cs
SET "ownerEmail" = lower(u.email)
FROM "User" AS u
WHERE cs."ownerId" = u.id
  AND (cs."ownerEmail" IS NULL OR cs."ownerEmail" = '');

-- Any leftover rows without email (should not exist)
DELETE FROM "CalendarShare" WHERE "ownerEmail" IS NULL OR "ownerEmail" = '';

ALTER TABLE "CalendarShare" ALTER COLUMN "ownerEmail" SET NOT NULL;

DROP INDEX IF EXISTS "CalendarShare_requesterId_ownerId_key";

-- ownerId becomes optional
ALTER TABLE "CalendarShare" ALTER COLUMN "ownerId" DROP NOT NULL;

CREATE UNIQUE INDEX "CalendarShare_requesterId_ownerEmail_key" ON "CalendarShare"("requesterId", "ownerEmail");
CREATE INDEX "CalendarShare_ownerEmail_status_idx" ON "CalendarShare"("ownerEmail", "status");
