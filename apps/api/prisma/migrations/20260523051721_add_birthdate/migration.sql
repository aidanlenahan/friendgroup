-- AlterTable
ALTER TABLE "User" ADD COLUMN     "birthdate" TIMESTAMP(3),
ADD COLUMN     "birthdateSet" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing users with default birthdate Jan 1, 2000 (birthdateSet stays false = one edit allowed)
UPDATE "User" SET "birthdate" = '2000-01-01 00:00:00' WHERE "birthdate" IS NULL;
