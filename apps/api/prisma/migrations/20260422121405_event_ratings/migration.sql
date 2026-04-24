/*
  Warnings:

  - You are about to drop the column `rating` on the `Event` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Event" DROP COLUMN "rating";

-- CreateTable
CREATE TABLE "EventRating" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventRating_eventId_idx" ON "EventRating"("eventId");

-- CreateIndex
CREATE INDEX "EventRating_userId_idx" ON "EventRating"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRating_eventId_userId_key" ON "EventRating"("eventId", "userId");

-- AddForeignKey
ALTER TABLE "EventRating" ADD CONSTRAINT "EventRating_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRating" ADD CONSTRAINT "EventRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
