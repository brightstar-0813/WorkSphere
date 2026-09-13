-- CreateTable
CREATE TABLE "JobFileMeta" (
    "id" TEXT NOT NULL DEFAULT 'workspace',
    "fileName" TEXT NOT NULL DEFAULT '',
    "uploadedAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobFileMeta_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "JobFileMeta" ADD CONSTRAINT "JobFileMeta_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
