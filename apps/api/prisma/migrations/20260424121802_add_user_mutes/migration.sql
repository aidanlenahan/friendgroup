-- CreateTable
CREATE TABLE "UserMute" (
    "id" TEXT NOT NULL,
    "muterId" TEXT NOT NULL,
    "mutedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMute_muterId_idx" ON "UserMute"("muterId");

-- CreateIndex
CREATE INDEX "UserMute_mutedId_idx" ON "UserMute"("mutedId");

-- CreateIndex
CREATE UNIQUE INDEX "UserMute_muterId_mutedId_key" ON "UserMute"("muterId", "mutedId");

-- AddForeignKey
ALTER TABLE "UserMute" ADD CONSTRAINT "UserMute_muterId_fkey" FOREIGN KEY ("muterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMute" ADD CONSTRAINT "UserMute_mutedId_fkey" FOREIGN KEY ("mutedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
