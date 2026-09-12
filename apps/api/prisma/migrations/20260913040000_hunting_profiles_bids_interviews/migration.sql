-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('DRAFT', 'SENT', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN', 'WON');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "HuntingProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HuntingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HuntingBid" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceUrl" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "amountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HuntingBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HuntingInterview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "bidId" TEXT,
    "company" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT NOT NULL DEFAULT '',
    "scheduledAt" TIMESTAMP(3),
    "scheduleEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HuntingInterview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HuntingProfile_userId_idx" ON "HuntingProfile"("userId");

-- CreateIndex
CREATE INDEX "HuntingBid_userId_idx" ON "HuntingBid"("userId");

-- CreateIndex
CREATE INDEX "HuntingBid_profileId_idx" ON "HuntingBid"("profileId");

-- CreateIndex
CREATE INDEX "HuntingInterview_userId_idx" ON "HuntingInterview"("userId");

-- CreateIndex
CREATE INDEX "HuntingInterview_profileId_idx" ON "HuntingInterview"("profileId");

-- CreateIndex
CREATE INDEX "HuntingInterview_bidId_idx" ON "HuntingInterview"("bidId");

-- AddForeignKey
ALTER TABLE "HuntingProfile" ADD CONSTRAINT "HuntingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuntingBid" ADD CONSTRAINT "HuntingBid_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuntingBid" ADD CONSTRAINT "HuntingBid_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "HuntingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuntingInterview" ADD CONSTRAINT "HuntingInterview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuntingInterview" ADD CONSTRAINT "HuntingInterview_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "HuntingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuntingInterview" ADD CONSTRAINT "HuntingInterview_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "HuntingBid"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate existing HuntingApplication rows into Default profiles + bids (+ interviews when needed)
DO $$
DECLARE
  app RECORD;
  profile_id TEXT;
  bid_id TEXT;
  interview_id TEXT;
  bid_status "BidStatus";
  need_interview BOOLEAN;
BEGIN
  FOR app IN SELECT * FROM "HuntingApplication" LOOP
    SELECT "id" INTO profile_id
    FROM "HuntingProfile"
    WHERE "userId" = app."userId" AND "name" = 'Default'
    LIMIT 1;

    IF profile_id IS NULL THEN
      profile_id := 'c' || substr(md5(random()::text || clock_timestamp()::text || app."userId"), 1, 24);
      INSERT INTO "HuntingProfile" ("id", "userId", "name", "label", "active", "createdAt", "updatedAt")
      VALUES (profile_id, app."userId", 'Default', '', true, NOW(), NOW());
    END IF;

    bid_status := CASE app."stage"::text
      WHEN 'SAVED' THEN 'DRAFT'::"BidStatus"
      WHEN 'APPLIED' THEN 'SENT'::"BidStatus"
      WHEN 'INTERVIEW' THEN 'SHORTLISTED'::"BidStatus"
      WHEN 'OFFER' THEN 'SHORTLISTED'::"BidStatus"
      WHEN 'REJECTED' THEN 'REJECTED'::"BidStatus"
      WHEN 'WITHDRAWN' THEN 'WITHDRAWN'::"BidStatus"
      ELSE 'DRAFT'::"BidStatus"
    END;

    bid_id := app."id";
    INSERT INTO "HuntingBid" (
      "id", "userId", "profileId", "company", "roleTitle", "status",
      "sourceUrl", "notes", "appliedAt", "createdAt", "updatedAt"
    ) VALUES (
      bid_id, app."userId", profile_id, app."company", app."roleTitle", bid_status,
      app."sourceUrl", app."notes", app."appliedAt", app."createdAt", app."updatedAt"
    );

    need_interview := (app."stage"::text = 'INTERVIEW') OR (app."scheduledAt" IS NOT NULL);
    IF need_interview THEN
      interview_id := 'c' || substr(md5(random()::text || clock_timestamp()::text || app."id"), 1, 24);
      INSERT INTO "HuntingInterview" (
        "id", "userId", "profileId", "bidId", "company", "roleTitle", "status",
        "notes", "scheduledAt", "scheduleEndsAt", "createdAt", "updatedAt"
      ) VALUES (
        interview_id, app."userId", profile_id, bid_id, app."company", app."roleTitle",
        'SCHEDULED'::"InterviewStatus", app."notes", app."scheduledAt", app."scheduleEndsAt",
        app."createdAt", app."updatedAt"
      );

      UPDATE "CalendarEvent"
      SET "sourceId" = interview_id
      WHERE "sourceType" = 'HUNTING' AND "sourceId" = app."id";
    ELSE
      DELETE FROM "CalendarEvent"
      WHERE "sourceType" = 'HUNTING' AND "sourceId" = app."id";
    END IF;
  END LOOP;
END $$;

-- DropTable
DROP TABLE "HuntingApplication";

-- DropEnum
DROP TYPE "HuntingStage";
