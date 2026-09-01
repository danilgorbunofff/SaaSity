-- CreateEnum
CREATE TYPE "PlotTier" AS ENUM ('OUTER', 'MID', 'CORE');

-- CreateEnum
CREATE TYPE "PlotStatus" AS ENUM ('IDLE', 'LIVE');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('OPEN', 'RESOLVING', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PreBidStatus" AS ENUM ('ACTIVE', 'WON', 'LOST', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Plot" (
    "id" TEXT NOT NULL,
    "tier" "PlotTier" NOT NULL,
    "originX" INTEGER NOT NULL,
    "originY" INTEGER NOT NULL,
    "spanX" INTEGER NOT NULL,
    "spanY" INTEGER NOT NULL,
    "status" "PlotStatus" NOT NULL DEFAULT 'IDLE',
    "currentCycleId" TEXT,
    "currentLeaderPreBidId" TEXT,
    "leaderCompanyName" TEXT,
    "leaderTagline" TEXT,
    "leaderTwitterHandle" TEXT,
    "leaderLogoUrl" TEXT,
    "leaderMrrText" TEXT,
    "leaderLogoHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionCycle" (
    "id" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'OPEN',
    "floorPriceCents" INTEGER NOT NULL,
    "incrementCents" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3) NOT NULL,
    "softCloseExtensions" INTEGER NOT NULL DEFAULT 0,
    "clearingPriceCents" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "winnerPreBidId" TEXT,
    "currentPriceCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuctionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreBid" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT,
    "plotId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripePaymentIntentId" TEXT,
    "maxBidCents" INTEGER NOT NULL,
    "status" "PreBidStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "preBidId" TEXT,
    "bidderId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "isProxy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plot_currentCycleId_key" ON "Plot"("currentCycleId");

-- CreateIndex
CREATE INDEX "Plot_status_idx" ON "Plot"("status");

-- CreateIndex
CREATE INDEX "Plot_originX_originY_idx" ON "Plot"("originX", "originY");

-- CreateIndex
CREATE INDEX "Plot_tier_idx" ON "Plot"("tier");

-- CreateIndex
CREATE INDEX "AuctionCycle_status_endAt_idx" ON "AuctionCycle"("status", "endAt");

-- CreateIndex
CREATE INDEX "AuctionCycle_plotId_status_idx" ON "AuctionCycle"("plotId", "status");

-- CreateIndex
CREATE INDEX "PreBid_cycleId_status_idx" ON "PreBid"("cycleId", "status");

-- CreateIndex
CREATE INDEX "PreBid_plotId_bidderId_idx" ON "PreBid"("plotId", "bidderId");

-- CreateIndex
CREATE INDEX "PreBid_bidderId_status_idx" ON "PreBid"("bidderId", "status");

-- CreateIndex
CREATE INDEX "Bid_cycleId_createdAt_idx" ON "Bid"("cycleId", "createdAt");

-- CreateIndex
CREATE INDEX "Bid_plotId_createdAt_idx" ON "Bid"("plotId", "createdAt");

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_currentCycleId_fkey" FOREIGN KEY ("currentCycleId") REFERENCES "AuctionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionCycle" ADD CONSTRAINT "AuctionCycle_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreBid" ADD CONSTRAINT "PreBid_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AuctionCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreBid" ADD CONSTRAINT "PreBid_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AuctionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_preBidId_fkey" FOREIGN KEY ("preBidId") REFERENCES "PreBid"("id") ON DELETE SET NULL ON UPDATE CASCADE;
