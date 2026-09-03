/**
 * Part 2 remediation proof — PreBid.stripePaymentIntentId uniqueness.
 * Proves, against the real DB:
 *
 *   A. The unique constraint (migration add_prebid_payment_intent_unique)
 *      actually rejects a duplicate non-null value at the raw Prisma layer.
 *   B. attachStripePaymentIntentId treats a same-row retry (identical
 *      preBid + identical PaymentIntent id, attempted twice) as an
 *      idempotent no-op — not an error.
 *   C. attachStripePaymentIntentId treats a genuine conflict (same
 *      PaymentIntent id, a DIFFERENT preBid) as a PaymentIntentConflictError
 *      — never a raw/opaque Prisma error — and leaves the losing row
 *      untouched (no partial write).
 *
 * Usage: npx tsx scripts/payment-intent-uniqueness-proof.ts
 * This script creates and deletes only its own synthetic zz-proof-* rows;
 * it never touches the real grid or reseeds anything.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client';
import { attachStripePaymentIntentId, PaymentIntentConflictError } from '../src/server/auction/payment-intent';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: ['error'],
});

const PLOT_ID = 'zz-proof-payment-intent';
const PREBID_A = 'zz-proof-pi-a';
const PREBID_B = 'zz-proof-pi-b';

let failures = 0;
let total = 0;
function check(name: string, ok: boolean, detail = ''): void {
  total += 1;
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function cleanup(): Promise<void> {
  await prisma.preBid.deleteMany({ where: { plotId: PLOT_ID } });
  await prisma.plot.deleteMany({ where: { id: PLOT_ID } });
}

async function main() {
  await cleanup();

  await prisma.plot.create({
    data: { id: PLOT_ID, tier: 'MID', originX: 0, originY: 0, spanX: 1, spanY: 1, status: 'IDLE' },
  });
  await prisma.preBid.create({
    data: {
      id: PREBID_A,
      plotId: PLOT_ID,
      bidderId: 'proof-bidder-a',
      maxBidCents: 500,
      companyName: 'Alpha',
      targetUrl: 'https://alpha.example.com',
      twitterHandle: 'alpha',
    },
  });
  await prisma.preBid.create({
    data: {
      id: PREBID_B,
      plotId: PLOT_ID,
      bidderId: 'proof-bidder-b',
      maxBidCents: 500,
      companyName: 'Beta',
      targetUrl: 'https://beta.example.com',
      twitterHandle: 'beta',
    },
  });

  // --- A: raw DB constraint rejects a duplicate non-null value ---------
  await prisma.preBid.update({ where: { id: PREBID_A }, data: { stripePaymentIntentId: 'pi_proof_alpha' } });
  let rawConflictThrew = false;
  let rawConflictIsP2002 = false;
  try {
    await prisma.preBid.update({ where: { id: PREBID_B }, data: { stripePaymentIntentId: 'pi_proof_alpha' } });
  } catch (err) {
    rawConflictThrew = true;
    rawConflictIsP2002 = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }
  check('A1: raw duplicate update throws', rawConflictThrew);
  check('A2: raw duplicate update throws Prisma P2002 specifically', rawConflictIsP2002);
  const bAfterRawAttempt = await prisma.preBid.findUniqueOrThrow({ where: { id: PREBID_B } });
  check(
    'A3: failed raw update left PreBid B untouched (still null)',
    bAfterRawAttempt.stripePaymentIntentId === null,
    `got ${bAfterRawAttempt.stripePaymentIntentId}`,
  );

  // --- B: helper treats a same-row retry as an idempotent no-op --------
  let retrySecondCallThrew = false;
  try {
    await attachStripePaymentIntentId(prisma, PREBID_A, 'pi_proof_alpha'); // 1st call: already set to this value above
    await attachStripePaymentIntentId(prisma, PREBID_A, 'pi_proof_alpha'); // 2nd call: retry, must be a no-op
  } catch {
    retrySecondCallThrew = true;
  }
  check('B1: same preBid + same PaymentIntent id retried twice does not throw', !retrySecondCallThrew);
  const aAfterRetry = await prisma.preBid.findUniqueOrThrow({ where: { id: PREBID_A } });
  check(
    'B2: PreBid A still holds its own PaymentIntent id after the retry',
    aAfterRetry.stripePaymentIntentId === 'pi_proof_alpha',
  );

  // --- C: helper treats a genuine cross-row conflict as a typed error --
  let conflictError: unknown = null;
  try {
    await attachStripePaymentIntentId(prisma, PREBID_B, 'pi_proof_alpha');
  } catch (err) {
    conflictError = err;
  }
  check('C1: cross-row conflict throws', conflictError !== null);
  check('C2: cross-row conflict throws PaymentIntentConflictError (typed, not raw Prisma)', conflictError instanceof PaymentIntentConflictError);
  if (conflictError instanceof PaymentIntentConflictError) {
    check('C3: error identifies the losing preBid', conflictError.preBidId === PREBID_B);
    check('C4: error identifies the conflicting PaymentIntent id', conflictError.stripePaymentIntentId === 'pi_proof_alpha');
    check('C5: error identifies the existing owner preBid', conflictError.conflictingPreBidId === PREBID_A);
  }
  const bAfterConflict = await prisma.preBid.findUniqueOrThrow({ where: { id: PREBID_B } });
  check(
    'C6: failed helper attach left PreBid B untouched (still null)',
    bAfterConflict.stripePaymentIntentId === null,
    `got ${bAfterConflict.stripePaymentIntentId}`,
  );

  await cleanup();

  if (failures === 0) {
    console.log(`PASS: all ${total} checks green (unique constraint + idempotent retry + typed conflict)`);
  } else {
    console.error(`${failures} check(s) FAILED`);
    process.exit(1);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => {});
    await prisma.$disconnect();
    process.exit(1);
  });
