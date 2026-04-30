-- AlterTable
ALTER TABLE "NotificationEvent" ADD COLUMN "url" TEXT;

-- CreateIndex
CREATE INDEX "NotificationEvent_recipientId_createdAt_idx" ON "NotificationEvent"("recipientId", "createdAt" DESC);
