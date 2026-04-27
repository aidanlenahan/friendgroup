/*
  Warnings:

  - A unique constraint covering the columns `[calendarToken]` on the table `Membership` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "calendarToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Membership_calendarToken_key" ON "Membership"("calendarToken");
