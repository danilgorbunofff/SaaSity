-- CreateTable
CREATE TABLE "RealtimeOutbox" (
    "seq" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealtimeOutbox_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "RealtimeOutbox_seq_idx" ON "RealtimeOutbox"("seq");

-- CreateIndex
CREATE INDEX "RealtimeOutbox_plotId_seq_idx" ON "RealtimeOutbox"("plotId", "seq");
