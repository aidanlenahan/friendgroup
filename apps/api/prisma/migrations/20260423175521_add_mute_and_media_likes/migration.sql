-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "mutedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MediaAssetLike" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAssetLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAssetLike_assetId_idx" ON "MediaAssetLike"("assetId");

-- CreateIndex
CREATE INDEX "MediaAssetLike_userId_idx" ON "MediaAssetLike"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAssetLike_assetId_userId_key" ON "MediaAssetLike"("assetId", "userId");

-- AddForeignKey
ALTER TABLE "MediaAssetLike" ADD CONSTRAINT "MediaAssetLike_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAssetLike" ADD CONSTRAINT "MediaAssetLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
