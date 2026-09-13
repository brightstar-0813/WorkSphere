-- Default project timezone: Asia/Tokyo (UTC+9)
ALTER TABLE "User" ALTER COLUMN "timeZone" SET DEFAULT 'Asia/Tokyo';
UPDATE "User" SET "timeZone" = 'Asia/Tokyo' WHERE "timeZone" IS NULL OR TRIM("timeZone") = '';
