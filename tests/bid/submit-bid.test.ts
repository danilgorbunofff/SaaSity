/**
 * Part 6 `outbid-retry` — UI-to-request proof: a 409 outbid response carries
 * the server's fresh minimum through submitBid so the modal applies it to
 * the retry form instead of returning to stale price state.
 */
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { submitBid } from '../../src/lib/bid/submit-bid';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

const values = {
  plotId: 'mid-01',
  companyName: 'CodeShip',
  targetUrl: 'https://codeship.dev',
  twitterHandle: 'codeship',
  maxBidCents: 600,
};

test('409 outbid maps to outbid kind with the server minimum intact', async () => {
  stubFetch(409, { code: 'outbid', error: 'Taken', minimumNextBidCents: 900 });
  const r = await submitBid({ plotId: 'mid-01', mode: 'bid', values });
  assert.equal(r.kind, 'outbid');
  assert.equal(r.kind === 'outbid' && r.minimumNextBidCents, 900);
});

test('409 outbid without a minimum still retries (no minimum attached)', async () => {
  stubFetch(409, { code: 'outbid', error: 'Taken' });
  const r = await submitBid({ plotId: 'mid-01', mode: 'bid', values });
  assert.equal(r.kind, 'outbid');
  assert.equal(r.kind === 'outbid' && r.minimumNextBidCents, undefined);
});

test('422 field errors pass through verbatim', async () => {
  stubFetch(422, { fieldErrors: { maxBidCents: 'Must be at least $9.00' } });
  const r = await submitBid({ plotId: 'mid-01', mode: 'bid', values });
  assert.equal(r.kind, 'fieldErrors');
});
