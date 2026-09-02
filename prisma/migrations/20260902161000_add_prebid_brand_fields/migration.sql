-- AlterTable
ALTER TABLE "PreBid" ADD COLUMN     "companyName" TEXT NOT NULL DEFAULT 'Unknown',
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "targetUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "twitterHandle" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mrrText" TEXT;