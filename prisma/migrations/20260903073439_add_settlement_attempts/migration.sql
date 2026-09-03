-- CreateEnum
CREATE TYPE "SettlementKind" AS ENUM ('CAPTURE', 'RELEASE');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'CAPTURED', 'FAILED_RETRYABLE', 'FAILED_DEFINITIVE', 'RELEASED', 'RELEASE_FAILED');

-- CreateTable
CREATE TABLE "SettlementAttempt" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "preBidId" TEXT NOT NULL,
    "kind" "SettlementKind" NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "attemptNo" INTEGER NOT NULL,
    "amountCents" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeResult" TEXT,
    "failureKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementAttempt_cycleId_status_idx" ON "SettlementAttempt"("cycleId", "status");

-- CreateIndex
CREATE INDEX "SettlementAttempt_idempotencyKey_idx" ON "SettlementAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAttempt_cycleId_preBidId_kind_attemptNo_key" ON "SettlementAttempt"("cycleId", "preBidId", "kind", "attemptNo");

-- AddForeignKey
ALTER TABLE "SettlementAttempt" ADD CONSTRAINT "SettlementAttempt_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AuctionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
