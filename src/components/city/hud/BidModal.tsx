'use client';

/**
 * Phase 2.1 — the shared bid/claim/pre-bid modal. Three modes, one shell.
 * Validation is the SHARED contract from lib/validation/bid-form, so the
 * exact same rules run here and on the server.
 *
 * Phase 2.5: submit now hits the REAL 2.2 engine (claim/bid/prebid) through
 * `lib/bid/submit-bid`; the 2.1 mock endpoint is deleted. The success view
 * shows a live countdown to `endAt` and — when the server reports the mock
 * path is enabled — a dev-only "fast-forward to resolution" button.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCityStore } from '@/lib/city/store';
import { useBidFormStore } from '@/lib/bid/bid-form-store';
import { submitBid, type SubmitResult } from '@/lib/bid/submit-bid';
import { useHudTick, hudNowMs, formatHudCountdown } from '@/lib/city/hud-hooks';
import {
  validateBidForm,
  minimumBidCents,
  type BidFormInput,
  type FieldErrors,
} from '@/lib/validation/bid-form';
import { formatPrice } from '@/lib/tiers';

interface FormValues {
  companyName: string;
  tagline: string;
  targetUrl: string;
  twitterHandle: string;
  mrrText: string;
  /** dollars as typed; converted to cents for validation/submit */
  maxBidDollars: string;
}

const EMPTY: FormValues = {
  companyName: '',
  tagline: '',
  targetUrl: '',
  twitterHandle: '',
  mrrText: '',
  maxBidDollars: '',
};

function toCents(dollars: string): number {
  const n = Number.parseFloat(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function modeCopy(mode: string): { title: string; blurb: string; cta: string } {
  switch (mode) {
    case 'bid':
      return {
        title: 'Place a bid',
        blurb: 'Beat the current leader by at least one increment. Soft-close may extend the timer.',
        cta: 'Submit bid',
      };
    case 'prebid':
      return {
        title: 'Schedule a pre-bid',
        blurb: 'For the next cycle of this plot. The proxy auto-bids for you, up to your max, only when challenged — timezone fair.',
        cta: 'Schedule pre-bid',
      };
    default:
      return {
        title: 'Claim this plot',
        blurb: 'Instant claim at the tier floor price — opens a fresh cycle from the clean-slate minimum.',
        cta: 'Claim now',
      };
  }
}

export function BidModal() {
  const open = useBidFormStore((s) => s.open);
  const plotId = useBidFormStore((s) => s.plotId);
  const mode = useBidFormStore((s) => s.mode);
  const status = useBidFormStore((s) => s.status);
  const serverError = useBidFormStore((s) => s.serverError);
  const closeBidForm = useBidFormStore((s) => s.closeBidForm);
  const setStatus = useBidFormStore((s) => s.setStatus);
  const tryMarkSubmit = useBidFormStore((s) => s.tryMarkSubmit);

  const plot = useCityStore((s) => (plotId ? s.plots.get(plotId) ?? null : null));
  const mockResolveEnabled = useCityStore((s) => s.mockResolveEnabled);

  const [values, setValues] = useState<FormValues>(EMPTY);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const min = useMemo(() => {
    if (!plot) return 0;
    return minimumBidCents(mode, plot.tier, plot.currentPriceCents);
  }, [plot, mode]);

  // No prefill state: an empty amount field means "bid the contextual
  // minimum" (shown as the placeholder), which avoids effect-driven setState.

  // Focus management: first field on open, trap Tab inside the dialog.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(EMPTY), [values]);

  if (!open || !plot) return null;

  const requestClose = () => {
    if (status === 'submitting') return;
    if (dirty && status === 'idle') {
      setConfirmDiscard(true);
      return;
    }
    doClose();
  };
  const doClose = () => {
    setConfirmDiscard(false);
    setTouched(new Set());
    setValues(EMPTY);
    setResult(null);
    closeBidForm();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const nodes = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  };

  const set = (key: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setConfirmDiscard(false);
  };
  const blur = (key: keyof FormValues) => () => {
    setTouched((t) => new Set(t).add(key));
    const input = toInput(values, plot.id, min);
    const r = validateBidForm(input, {
      mode,
      tier: plot.tier,
      currentPriceCents: plot.currentPriceCents,
      selfHostnames: typeof window !== 'undefined' ? [window.location.hostname] : [],
    });
    setFieldErrors(r.errors);
  };

  const submit = async () => {
    if (status === 'submitting') return;
    const input = toInput(values, plot.id, min);
    const r = validateBidForm(input, {
      mode,
      tier: plot.tier,
      currentPriceCents: plot.currentPriceCents,
      selfHostnames: typeof window !== 'undefined' ? [window.location.hostname] : [],
    });
    setFieldErrors(r.errors);
    setTouched(new Set(['companyName', 'tagline', 'targetUrl', 'twitterHandle', 'mrrText', 'maxBidDollars']));
    if (!r.ok || !r.values) return;
    // Only consume the throttle token once the submit is really going out —
    // a validation failure must not lock the user out for 5s.
    if (!tryMarkSubmit()) {
      setStatus('error', 'Please wait a few seconds between submissions.');
      return;
    }

    setStatus('submitting');
    const outcome = await submitBid({ plotId: plot.id, mode, values: r.values });

    switch (outcome.kind) {
      case 'ok':
        setResult(outcome);
        setStatus('success');
        // Re-pull /api/plots + /api/me/bids immediately: the submitting
        // client must see its own new lease (and leader badge) without
        // waiting for the SSE echo to round-trip.
        window.dispatchEvent(new Event('city-refetch'));
        return;
      case 'outbid':
        setStatus('outbid', outcome.message);
        return;
      case 'fieldErrors':
        // Server-side truth wins — same contract, same field names.
        setFieldErrors(outcome.fieldErrors);
        setTouched(new Set(['companyName', 'tagline', 'targetUrl', 'twitterHandle', 'mrrText', 'maxBidDollars']));
        setStatus('idle');
        return;
      case 'error':
        setStatus('error', outcome.message);
        return;
    }
  };

  const copy = modeCopy(mode);
  const locked = status === 'submitting' || status === 'success';
  const showErr = (k: keyof FieldErrors) =>
    (touched.has(k) || (k === 'maxBidCents' && touched.has('maxBidDollars')) || status === 'error') &&
    fieldErrors[k];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${copy.title} — plot ${plot.id}`}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-lg border border-[#12303a] bg-[#050508] p-5 shadow-[0_0_40px_rgba(0,240,255,0.2)]"
      >
        {status === 'success' ? (
          <SuccessView
            mode={mode}
            plotLabel={plot.id}
            result={result}
            mockResolveEnabled={mockResolveEnabled}
            onClose={doClose}
          />
        ) : status === 'outbid' ? (
          <OutbidView
            message={serverError}
            onRetry={() => setStatus('idle')}
            onClose={doClose}
          />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-bold uppercase tracking-wider text-[#00f0ff]">{copy.title}</h2>
                <p className="mt-1 text-[12px] leading-snug text-[#6b7a8c]">{copy.blurb}</p>
              </div>
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close"
                className="rounded px-1.5 text-[16px] leading-none text-[#6b7a8c] hover:text-[#e8f6ff]"
              >
                ×
              </button>
            </div>

            {plot.status === 'LIVE' && mode === 'bid' ? (
              <div className="mt-3 flex items-center justify-between rounded border border-[#12303a] bg-[#0b0e14] px-3 py-2 font-mono text-[12px]">
                <span className="text-[#6b7a8c]">current {formatPrice(plot.currentPriceCents ?? 0)}</span>
                <span className="text-[#9fd8e6]">min next {formatPrice(min)}</span>
              </div>
            ) : (
              <div className="mt-3 rounded border border-[#12303a] bg-[#0b0e14] px-3 py-2 font-mono text-[12px] text-[#9fd8e6]">
                floor {formatPrice(min)} · {plot.tier} tier
              </div>
            )}

            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Field label="Company name *" error={showErr('companyName')}>
                <input ref={firstFieldRef} value={values.companyName} onChange={set('companyName')} onBlur={blur('companyName')} disabled={locked} maxLength={64} placeholder="CodeShip" className={inputCls(showErr('companyName'))} />
              </Field>
              <Field label="Target URL *" error={showErr('targetUrl')}>
                <input value={values.targetUrl} onChange={set('targetUrl')} onBlur={blur('targetUrl')} disabled={locked} placeholder="https://codeship.dev" inputMode="url" className={inputCls(showErr('targetUrl'))} />
              </Field>
              <Field label="X handle *" error={showErr('twitterHandle')}>
                <input value={values.twitterHandle} onChange={set('twitterHandle')} onBlur={blur('twitterHandle')} disabled={locked} placeholder="@codeship" className={inputCls(showErr('twitterHandle'))} />
              </Field>
              <Field label="Tagline" error={showErr('tagline')}>
                <input value={values.tagline} onChange={set('tagline')} onBlur={blur('tagline')} disabled={locked} maxLength={96} placeholder="Ship faster" className={inputCls(showErr('tagline'))} />
              </Field>
              <Field label="MRR badge (optional)" error={showErr('mrrText')}>
                <input value={values.mrrText} onChange={set('mrrText')} onBlur={blur('mrrText')} disabled={locked} maxLength={24} placeholder="$12k MRR" className={inputCls(showErr('mrrText'))} />
              </Field>
              <Field label={mode === 'bid' ? `Your max bid (USD) * min ${formatPrice(min)}` : `Your max (USD) * min ${formatPrice(min)}`} error={showErr('maxBidCents')}>
                <input
                  value={values.maxBidDollars}
                  onChange={(e) => setValues((v) => ({ ...v, maxBidDollars: e.target.value }))}
                  onBlur={() => {
                    setTouched((t) => new Set(t).add('maxBidDollars'));
                    blur('maxBidDollars')();
                  }}
                  disabled={locked}
                  inputMode="decimal"
                  placeholder={(min / 100).toFixed(2)}
                  className={inputCls(showErr('maxBidCents'))}
                />
              </Field>

              <fieldset disabled aria-label="Payment method (coming soon)" className="mt-4 rounded border border-dashed border-[#2a3a46] bg-[#0b0e14]/60 px-3 py-2">
                <legend className="px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#6b7a8c]">Payment</legend>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#3a4a56]">💳 Card on file — connects in phase 3.1</span>
                  <span className="rounded bg-[#12303a] px-2 py-0.5 font-mono text-[10px] text-[#6b7a8c]">STUB</span>
                </div>
              </fieldset>

              {status === 'error' && serverError ? (
                <p role="alert" className="rounded border border-[#ff0055]/50 bg-[#ff0055]/10 px-3 py-2 text-[12px] text-[#ff5c8a]">
                  {serverError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={locked}
                className="mt-2 w-full rounded border border-[#00f0ff]/60 bg-[#00f0ff]/15 px-3 py-2.5 text-[13px] font-bold uppercase tracking-wider text-[#00f0ff] hover:bg-[#00f0ff]/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === 'submitting' ? 'Submitting…' : copy.cta}
              </button>
              {confirmDiscard ? (
                <div className="flex items-center justify-between gap-2 rounded border border-[#ffb400]/40 bg-[#ffb400]/10 px-3 py-2 text-[12px] text-[#ffb400]">
                  <span>Discard unsaved changes?</span>
                  <span className="flex gap-2">
                    <button type="button" onClick={() => setConfirmDiscard(false)} className="underline">Keep editing</button>
                    <button type="button" onClick={doClose} className="font-bold underline">Discard</button>
                  </span>
                </div>
              ) : null}
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function toInput(v: FormValues, plotId: string, fallbackMin: number): BidFormInput {
  // Empty amount = submit the contextual minimum (placeholder shows it).
  const cents = v.maxBidDollars.trim() === '' ? fallbackMin : toCents(v.maxBidDollars);
  return {
    plotId,
    companyName: v.companyName,
    ...(v.tagline.trim() ? { tagline: v.tagline } : {}),
    targetUrl: v.targetUrl,
    twitterHandle: v.twitterHandle,
    ...(v.mrrText.trim() ? { mrrText: v.mrrText } : {}),
    maxBidCents: Number.isNaN(cents) ? fallbackMin - 1 : cents,
  };
}

function inputCls(hasErr: unknown): string {
  const base =
    'w-full rounded border bg-[#0b0e14] px-3 py-1.5 text-[13px] text-[#e8f6ff] placeholder:text-[#3a4a56] focus:outline-none focus:border-[#00f0ff]/70 disabled:opacity-50';
  return hasErr ? `${base} border-[#ff0055]/60` : `${base} border-[#12303a]`;
}

function Field({ label, error, children }: { label: string; error?: string | false | undefined; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.15em] text-[#6b7a8c]">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[11px] text-[#ff5c8a]">{error}</span> : null}
    </label>
  );
}

/**
 * Success view (phase 2.5): live countdown to the cycle's endAt and, when
 * the deployment runs the mock path, a dev fast-forward to resolution. Both
 * come from the server's own submit response — no client-side clock math.
 */
function SuccessView({
  mode,
  plotLabel,
  result,
  mockResolveEnabled,
  onClose,
}: {
  mode: string;
  plotLabel: string;
  result: SubmitResult | null;
  mockResolveEnabled: boolean;
  onClose: () => void;
}) {
  const tick = useHudTick();
  void tick;
  const [busy, setBusy] = useState(false);
  const [ffError, setFfError] = useState<string | null>(null);

  const cycleId = result?.kind === 'ok' ? result.cycleId : null;
  const endAt = result?.kind === 'ok' ? result.endAt : null;
  const countdown = endAt ? formatHudCountdown(endAt, hudNowMs()) : null;

  const fastForward = async () => {
    if (!cycleId || busy) return;
    setBusy(true);
    setFfError(null);
    try {
      const res = await fetch(`/api/mock-resolve/${encodeURIComponent(cycleId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'resolve' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setFfError(body.error ?? `Fast-forward failed (${res.status})`);
        return;
      }
      window.dispatchEvent(new Event('city-refetch'));
      onClose();
    } catch {
      setFfError('Network error — resolution did not run.');
    } finally {
      setBusy(false);
    }
  };

  const headline =
    mode === 'prebid'
      ? 'Pre-bid queued'
      : mode === 'bid'
        ? result?.kind === 'ok' && result.youAreLeader
          ? 'You lead this auction'
          : 'Bid placed — you were outbid'
        : 'Plot claimed';

  return (
    <div className="py-6 text-center">
      <div className="text-3xl">🛰️</div>
      <h2 className="mt-2 text-[15px] font-bold uppercase tracking-wider text-[#00f0ff]">{headline}</h2>
      <p className="mx-auto mt-2 max-w-[300px] text-[12px] leading-snug text-[#9fd8e6]">
        {mode === 'prebid'
          ? `Proxy pre-bid queued for the NEXT cycle of ${plotLabel}. The system bids for you up to your max once that cycle opens.`
          : result?.kind === 'ok' && result.youAreLeader
            ? `You lead ${plotLabel} at ${formatPrice(result.currentPriceCents ?? 0)}. Rivals can still challenge — soft-close extends the timer on late bids.`
            : `Your max is recorded on ${plotLabel}. The proxy engine will bid for you up to it when challenged.`}
      </p>

      {countdown ? (
        <div className="mx-auto mt-4 w-[220px] rounded border border-[#12303a] bg-[#0b0e14] px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#6b7a8c]">
            cycle ends in
          </div>
          <div
            data-testid="bid-success-countdown"
            className="mt-0.5 font-mono text-xl font-bold text-[#e8f6ff]"
          >
            {countdown}
          </div>
          {result?.kind === 'ok' && result.softCloseExtended ? (
            <div className="mt-1 text-[11px] text-[#ffb400]">soft-close: timer extended</div>
          ) : null}
        </div>
      ) : null}

      {mockResolveEnabled && cycleId ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void fastForward()}
            disabled={busy}
            title="Dev only — forces endAt to now and runs the real worker resolution"
            className="rounded border border-[#ffb400]/70 bg-[#ffb400]/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[#ffb400] hover:bg-[#ffb400]/20 disabled:opacity-50"
          >
            {busy ? 'Resolving…' : '⏩ Fast-forward to resolution'}
          </button>
          {ffError ? <div className="mt-1 text-[11px] text-[#ff5c8a]">{ffError}</div> : null}
        </div>
      ) : null}

      <button type="button" onClick={onClose} className="mt-4 rounded border border-[#00f0ff]/60 bg-[#00f0ff]/15 px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-[#00f0ff] hover:bg-[#00f0ff]/25">
        Back to the city
      </button>
    </div>
  );
}

function OutbidView({
  message,
  onRetry,
  onClose,
}: {
  message: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="py-6 text-center">
      <div className="text-3xl">⚠️</div>
      <h2 className="mt-2 text-[15px] font-bold uppercase tracking-wider text-[#ffb400]">You were outbid mid-submit</h2>
      <p className="mx-auto mt-2 max-w-[300px] text-[12px] leading-snug text-[#9fd8e6]">
        {message ?? 'Someone else just took the lead — try a higher amount.'}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" onClick={onRetry} className="rounded border border-[#ffb400]/70 bg-[#ffb400]/15 px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-[#ffb400] hover:bg-[#ffb400]/25">
          Bid higher
        </button>
        <button type="button" onClick={onClose} className="rounded border border-[#2a3a46] px-4 py-2 text-[12px] uppercase tracking-wider text-[#6b7a8c] hover:text-[#e8f6ff]">
          Later
        </button>
      </div>
    </div>
  );
}