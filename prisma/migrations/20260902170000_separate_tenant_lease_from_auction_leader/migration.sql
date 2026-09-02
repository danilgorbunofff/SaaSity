-- Part 1 lifecycle fix (core-lease-semantics): separate the ACTIVE TENANT
-- (who is publicly displayed on the billboard) from the current auction's
-- provisional leader (currentLeaderPreBidId, untouched by this migration).
--
-- The existing leader* columns were populated by the old resolveCycle,
-- which wrote whoever was CURRENTLY LEADING a live auction — not
-- necessarily a bidder who ever won and paid. That data does not represent
-- a real tenancy under the new model, so it is intentionally dropped
-- rather than renamed/copied: every plot starts "no confirmed tenant yet"
-- and tenant fields are populated going forward only by
-- src/server/auction/engine.ts#activateTenant at successful settlement.

-- AlterTable
ALTER TABLE "Plot" DROP COLUMN "leaderCompanyName",
DROP COLUMN "leaderLogoHidden",
DROP COLUMN "leaderLogoUrl",
DROP COLUMN "leaderMrrText",
DROP COLUMN "leaderTagline",
DROP COLUMN "leaderTargetUrl",
DROP COLUMN "leaderTwitterHandle",
ADD COLUMN     "tenantPreBidId" TEXT,
ADD COLUMN     "tenantSince" TIMESTAMP(3),
ADD COLUMN     "tenantCompanyName" TEXT,
ADD COLUMN     "tenantTagline" TEXT,
ADD COLUMN     "tenantTwitterHandle" TEXT,
ADD COLUMN     "tenantLogoUrl" TEXT,
ADD COLUMN     "tenantMrrText" TEXT,
ADD COLUMN     "tenantLogoHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tenantTargetUrl" TEXT;
