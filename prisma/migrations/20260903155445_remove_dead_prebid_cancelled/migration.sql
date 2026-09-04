-- Remove the unreachable PreBidStatus.CANCELLED variant (no writer ever
-- produced it; shell-cancel paths leave rows EXPIRED via authorization).
-- AlterEnum
BEGIN;
CREATE TYPE "PreBidStatus_new" AS ENUM ('ACTIVE', 'WON', 'LOST', 'EXPIRED');
ALTER TABLE "public"."PreBid" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PreBid" ALTER COLUMN "status" TYPE "PreBidStatus_new" USING ("status"::text::"PreBidStatus_new");
ALTER TYPE "PreBidStatus" RENAME TO "PreBidStatus_old";
ALTER TYPE "PreBidStatus_new" RENAME TO "PreBidStatus";
DROP TYPE "public"."PreBidStatus_old";
ALTER TABLE "PreBid" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;
