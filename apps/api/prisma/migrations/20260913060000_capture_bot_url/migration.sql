-- AlterTable
ALTER TABLE "HuntingProfile" ADD COLUMN "captureBotUrl" TEXT NOT NULL DEFAULT 'http://127.0.0.1:3847';
ALTER TABLE "HuntingProfile" ADD COLUMN "captureSyncedAt" TIMESTAMP(3);
