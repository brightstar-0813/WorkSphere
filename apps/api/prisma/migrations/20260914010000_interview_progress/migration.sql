-- Interview Progress (manual CRUD) + editable step/status options
CREATE TYPE "InterviewProgressOptionKind" AS ENUM ('STEP', 'STATUS');

CREATE TABLE "InterviewProgressOption" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "InterviewProgressOptionKind" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewProgressOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InterviewProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT,
    "jobTitle" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "jobSiteSource" TEXT NOT NULL DEFAULT '',
    "salary" TEXT NOT NULL DEFAULT '',
    "step" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "scheduledAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InterviewProgressOption_userId_kind_label_key" ON "InterviewProgressOption"("userId", "kind", "label");
CREATE INDEX "InterviewProgressOption_userId_kind_sortOrder_idx" ON "InterviewProgressOption"("userId", "kind", "sortOrder");
CREATE INDEX "InterviewProgress_userId_idx" ON "InterviewProgress"("userId");
CREATE INDEX "InterviewProgress_profileId_idx" ON "InterviewProgress"("profileId");
CREATE INDEX "InterviewProgress_userId_scheduledAt_idx" ON "InterviewProgress"("userId", "scheduledAt");

ALTER TABLE "InterviewProgressOption" ADD CONSTRAINT "InterviewProgressOption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewProgress" ADD CONSTRAINT "InterviewProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewProgress" ADD CONSTRAINT "InterviewProgress_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "HuntingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
