-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "triggeredExtension" BOOLEAN NOT NULL DEFAULT false;

-- Normalize defaults added while backfilling NOT NULL brand columns on a
-- non-empty table; schema.prisma has no defaults for these.
ALTER TABLE "PreBid" ALTER COLUMN "companyName" DROP DEFAULT,
ALTER COLUMN "targetUrl" DROP DEFAULT,
ALTER COLUMN "twitterHandle" DROP DEFAULT;