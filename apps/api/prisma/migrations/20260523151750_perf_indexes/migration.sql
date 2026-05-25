-- CreateIndex
CREATE INDEX "Membership_groupId_userId_idx" ON "Membership"("groupId", "userId");

-- CreateIndex
CREATE INDEX "Message_channelId_createdAt_idx" ON "Message"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_recipientId_readAt_idx" ON "NotificationEvent"("recipientId", "readAt");
