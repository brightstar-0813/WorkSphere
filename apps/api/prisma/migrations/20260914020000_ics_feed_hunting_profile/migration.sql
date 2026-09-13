-- Link imported ICS calendars to hunting profiles (Bid Tracking)
ALTER TABLE "CalendarIcsFeed" ADD COLUMN "profileId" TEXT;

CREATE UNIQUE INDEX "CalendarIcsFeed_profileId_key" ON "CalendarIcsFeed"("profileId");

ALTER TABLE "CalendarIcsFeed"
  ADD CONSTRAINT "CalendarIcsFeed_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "HuntingProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
