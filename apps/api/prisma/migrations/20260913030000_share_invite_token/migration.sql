-- Invite token for email Accept links
ALTER TABLE "CalendarShare" ADD COLUMN IF NOT EXISTS "inviteToken" TEXT;
ALTER TABLE "CalendarShare" ADD COLUMN IF NOT EXISTS "lastInvitedAt" TIMESTAMP(3);

UPDATE "CalendarShare"
SET "inviteToken" = md5(random()::text || id || clock_timestamp()::text)
WHERE "inviteToken" IS NULL OR "inviteToken" = '';

ALTER TABLE "CalendarShare" ALTER COLUMN "inviteToken" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarShare_inviteToken_key" ON "CalendarShare"("inviteToken");
