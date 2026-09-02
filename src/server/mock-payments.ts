/**
 * Phase 2.5 — the mock-money kill switch.
 *
 * Until 3.1 wires Stripe, every settlement call in `auction/finalize.ts` is
 * a stub that "succeeds" without moving money. That is only ever acceptable
 * when this deployment has explicitly opted in with `MOCK_PAYMENTS=1`:
 *
 *   - ON  → stubs settle nothing but return success, so the full
 *           claim → bid → resolve → next-cycle loop is exercisable.
 *   - OFF → the stubs THROW (MockPaymentsDisabledError). Every capture
 *           fails, so a resolution produces no winner and the plot reverts
 *           to IDLE rather than crowning a tenant nobody paid for.
 *
 * Read through the function (not a module constant) so tests can flip the
 * env var at runtime.
 */

export function isMockPaymentsEnabled(): boolean {
  return process.env.MOCK_PAYMENTS === '1';
}

/** Thrown by the M3 payment stubs when the mock path is not enabled. */
export class MockPaymentsDisabledError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(
      `${operation}: MOCK_PAYMENTS is not enabled — refusing to fake a settlement. ` +
        `Set MOCK_PAYMENTS=1 for the phase 2.5 mock loop, or land the real Stripe call (phase 3.1).`,
    );
    this.name = 'MockPaymentsDisabledError';
    this.operation = operation;
  }
}

/**
 * Called at the top of every payment stub. Deliberately throws instead of
 * silently succeeding: a silent fake settlement would crown a winner for a
 * plot nobody paid for the moment this ships without the flag.
 */
export function requireMockPayments(operation: string): void {
  if (!isMockPaymentsEnabled()) throw new MockPaymentsDisabledError(operation);
}
