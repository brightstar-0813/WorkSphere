-- AlterTable
ALTER TABLE "HuntingProfile" ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HuntingProfile_userId_country_idx" ON "HuntingProfile"("userId", "country");