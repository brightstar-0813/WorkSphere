-- Calendar OAuth connections + external event mirror fields

ALTER TYPE "CalendarSourceType" ADD VALUE IF NOT EXISTS 'GOOGLE';
ALTER TYPE "CalendarSourceType" ADD VALUE IF NOT EXISTS 'OUTLOOK';

DO $migration$ BEGIN
  CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'OUTLOOK');
EXCEPTION
  WHEN duplicate_object THEN null;
END $migration$;

ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "attendees" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "htmlLink" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarEvent_userId_sourceType_externalId_key"
  ON "CalendarEvent"("userId", "sourceType", "externalId");

CREATE TABLE IF NOT EXISTS "CalendarConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "CalendarProvider" NOT NULL,
  "accountEmail" TEXT NOT NULL,
  "accessTokenEnc" TEXT NOT NULL,
  "refreshTokenEnc" TEXT NOT NULL DEFAULT '',
  "expiresAt" TIMESTAMP(3),
  "scope" TEXT NOT NULL DEFAULT '',
  "externalCalendarId" TEXT NOT NULL DEFAULT 'primary',
  "lastSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarConnection_userId_provider_key"
  ON "CalendarConnection"("userId", "provider");

CREATE INDEX IF NOT EXISTS "CalendarConnection_userId_idx"
  ON "CalendarConnection"("userId");

DO $migration$ BEGIN
  ALTER TABLE "CalendarConnection"
    ADD CONSTRAINT "CalendarConnection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $migration$;