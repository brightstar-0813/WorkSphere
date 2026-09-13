-- AlterTable
ALTER TABLE "ChatRoom" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChatRoomUnlock" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRoomUnlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatRoomUnlock_roomId_userId_key" ON "ChatRoomUnlock"("roomId", "userId");
CREATE INDEX IF NOT EXISTS "ChatRoomUnlock_userId_idx" ON "ChatRoomUnlock"("userId");

DO $$ BEGIN
  ALTER TABLE "ChatRoomUnlock" ADD CONSTRAINT "ChatRoomUnlock_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChatRoomUnlock" ADD CONSTRAINT "ChatRoomUnlock_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
