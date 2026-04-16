-- Add inviteCode to Group
ALTER TABLE "Group" ADD COLUMN "inviteCode" TEXT;
CREATE UNIQUE INDEX "Group_inviteCode_key" ON "Group"("inviteCode");

-- Add status to Membership (default 'active' for existing rows)
ALTER TABLE "Membership" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
CREATE INDEX "Membership_groupId_status_idx" ON "Membership"("groupId", "status");
