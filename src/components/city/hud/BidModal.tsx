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
  parseDollarsToCents,
  type BidFormInput,
  type BidMode,
  type FieldErrors,
} from '@/lib/validation/bid-form';
import type { PlotDto } from '@/types/api';
import { saveBrand } from '@/lib/bid/brand-memory';
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
  // Part 6 `amount-parser`: strict parser only — parseFloat accepted `5junk`.
  const r = parseDollarsToCents(dollars);
  return r.ok ? r.cents : NaN;
}

function modeCopy(mode: string): { title: string; blurb: string; cta: string } {
  switch (mode) {
    case 'bid':
      return {
        title: 'Place a bid',
        blurb:
          'This plot has a live auction. Set your maximum — the proxy bids the minimum needed to lead, and late bids can extend the timer.',
        cta: 'Submit bid',
      };
    case 'prebid':
      return {
        title: 'Schedule a pre-bid',
        blurb:
          'This plot opens its next auction soon. Set your maximum now — the proxy bids for you up to that max once the cycle opens.',
        cta: 'Schedule pre-bid',
      };
    default:
      return {
        title: 'Claim this plot',
        blurb:
          'This plot is idle. Claiming opens a fresh auction at the tier floor price with your maximum as the opening bid.',
        cta: 'Claim now',
      };
  }
}

export function BidModal() {
  const open = useBidFormStore((s) => s.open);
  const plotId = useBidFormStore((s) => s.plotId);
  const mode = useBidFormStore((s) => s.mode);
  const plot = useCityStore((s) => (plotId ? (s.plots.get(plotId) ?? null) : null));
  if (!open || !plot || !plotId) return null;
  // Key remount per plot: per-open form state comes from useState
  // initializers inside — no seeding effects, no cascading renders. A mode
  // flip on the same plot (claim-first) keeps typed values by design.
  return <BidDialog key={plotId} plot={plot} mode={mode} />;
}

/** Per-open seed: caller's saved brand + suggested server minimum. */
function seedValues(): FormValues {
  const { prefill, suggestedMinCents } = useBidFormStore.getState();
  const seeded: FormValues = { ...EMPTY };
  if (prefill) {
    seeded.companyName = prefill.companyName;
    seeded.tagline = prefill.tagline;
    seeded.targetUrl = prefill.targetUrl;
    seeded.twitterHandle = prefill.twitterHandle;
    seeded.mrrText = prefill.mrrText;
  }
  if (typeof suggestedMinCents === 'number') {
    seeded.maxBidDollars = (suggestedMinCents / 100).toFixed(2);
  }
  return seeded;
}

function BidDialog({ plot, mode }: { plot: PlotDto; mode: BidMode }) {
  const status = useBidFormStore((s) => s.status);
  const serverError = useBidFormStore((s) => s.serverError);
  const closeBidForm = useBidFormStore((s) => s.closeBidForm);
  const openBidForm = useBidFormStore((s) => s.openBidForm);
  const setStatus = useBidFormStore((s) => s.setStatus);
  const tryMarkSubmit = useBidFormStore((s) => s.tryMarkSubmit);

  const prefill = useBidFormStore((s) => s.prefill);
  const suggestedMinCents = useBidFormStore((s) => s.suggestedMinCents);
  const outbidMinimumCents = useBidFormStore((s) => s.outbidMinimumCents);
  const setOutbid = useBidFormStore((s) => s.setOutbid);

  const mockResolveEnabled = useCityStore((s) => s.mockResolveEnabled);
  const myPreBidIds = useCityStore((s) => s.myPreBidIds);

  const [values, setValues] = useState<FormValues>(seedValues);
  // The open-time snapshot — dirty is typed edits, never the prefill itself.
  const [initial] = useState<FormValues>(values);
  const [touched, setTouched] = useState<Set<string>>(() =>
    typeof useBidFormStore.getState().suggestedMinCents === 'number'
      ? new Set(['maxBidDollars'])
      : new Set(),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  /** Receipt state: the exact commitment the server accepted. */
  const [committedCents, setCommittedCents] = useState<number | null>(null);
  /** Top-up compact mode: identity collapsed to "Bidding as X". */
  const [compactIdentity, setCompactIdentity] = useState(() => {
    const p = useBidFormStore.getState().prefill;
    return !!p && (mode === 'bid' || mode === 'prebid');
  });
  /** Server-brand divergence acknowledged (overwrite confirm). */
  const [overwriteAck, setOverwriteAck] = useState(false);
  const [announce, setAnnounce] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  /** Element that opened the modal — focus returns here, never to body. */
  const openerRef = useRef<Element | null>(null);

  const min = useMemo(() => {
    // Part 6 `outbid-retry`: a server-supplied minimum wins over the stale
    // client computation — it is fresher than this tab's snapshot.
    if (typeof suggestedMinCents === 'number') return suggestedMinCents;
    if (status === 'outbid' && typeof outbidMinimumCents === 'number') return outbidMinimumCents;
    return minimumBidCents(mode, plot.tier, plot.currentPriceCents);
  }, [plot, mode, suggestedMinCents, status, outbidMinimumCents]);

  // Capture the opener before the dialog steals focus (a11y-structure).
  useEffect(() => {
    openerRef.current = document.activeElement;
  }, []);

  // Focus management on mount: amount field when a server minimum was
  // suggested or identity arrived prefilled (top-up), else first field.
  useEffect(() => {
    const { suggestedMinCents: suggested, prefill: saved } = useBidFormStore.getState();
    const t = window.setTimeout(() => {
      if (typeof suggested === 'number' || (saved && (mode === 'bid' || mode === 'prebid'))) {
        amountRef.current?.focus();
      } else {
        firstFieldRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [mode]);

  // Focus "Keep editing" when the discard confirm opens (alertdialog).
  useEffect(() => {
    if (!confirmDiscard) return;
    const t = window.setTimeout(() => keepEditingRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [confirmDiscard]);

  // Background inert + scroll lock while the dialog lives (a11y-structure).
  useEffect(() => {
    const root = document.getElementById('city-root');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root?.setAttribute('inert', '');
    return () => {
      document.body.style.overflow = prevOverflow;
      root?.removeAttribute('inert');
    };
  }, []);

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  const requestClose = () => {
    if (status === 'submitting') return;
    // Deterministic Escape: with the confirm open, Escape cancels the
    // confirm (keeps the form); otherwise dirty forms arm the confirm.
    if (confirmDiscard) {
      cancelDiscard();
      return;
    }
    if (dirty && status === 'idle') {
      setConfirmDiscard(true);
      return;
    }
    doClose();
  };
  /** Cancel the discard confirm — focus returns to the close control. */
  const cancelDiscard = () => {
    setConfirmDiscard(false);
    closeBtnRef.current?.focus();
  };
  const doClose = () => {
    // State needs no reset: the keyed dialog unmounts on close, discarding
    // per-open state. Focus returns to the exact opening trigger.
    closeBidForm();
    const opener = openerRef.current;
    if (opener instanceof HTMLElement) {
      window.setTimeout(() => opener.focus(), 0);
    }
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
    const errors = { ...r.errors };
    // The amount field always explains itself with the strict parser's
    // message; other fields leave the amount error as the schema computed.
    if (key === 'maxBidDollars') {
      const msg = amountError(values.maxBidDollars);
      if (msg) errors.maxBidCents = msg;
    }
    setFieldErrors(errors);
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
    const errors = { ...r.errors };
    const amountMsg = amountError(values.maxBidDollars);
    if (amountMsg) errors.maxBidCents = amountMsg;
    setFieldErrors(errors);
    setTouched(
      new Set(['companyName', 'tagline', 'targetUrl', 'twitterHandle', 'mrrText', 'maxBidDollars']),
    );
    if (amountMsg || !r.ok || !r.values) {
      // a11y-structure: move focus to the error summary, not nowhere.
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return;
    }
    // Confirm before overwriting newer server-side brand data.
    if (divergent && !overwriteAck) {
      setStatus(
        'error',
        'The billboard shows a newer brand than your saved one — choose which to keep above before submitting.',
      );
      return;
    }
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
        setCommittedCents(r.values.maxBidCents);
        // Remember the caller's own brand for the next top-up prefill.
        saveBrand(plot.id, {
          companyName: r.values.companyName,
          tagline: r.values.tagline ?? '',
          targetUrl: r.values.targetUrl,
          twitterHandle: r.values.twitterHandle,
          mrrText: r.values.mrrText ?? '',
        });
        setStatus('success');
        // Re-pull /api/plots + /api/me/bids immediately: the submitting
        // client must see its own new lease (and leader badge) without
        // waiting for the SSE echo to round-trip.
        window.dispatchEvent(new Event('city-refetch'));
        return;
      case 'outbid':
        // Part 6 `outbid-retry`: keep the server's fresh minimum with the
        // message so "Bid higher" applies it instead of stale form state.
        setOutbid(outcome.message, outcome.minimumNextBidCents ?? null);
        return;
      case 'claim-first':
        // The auction the pre-bid targeted is gone (stale tab, or the plot
        // was never LIVE). Flip into claim mode keeping the typed values,
        // so the next click opens the bidding instead of failing again.
        // Same key (same plot) → no remount, values survive the flip.
        openBidForm(plot.id, 'claim');
        setCompactIdentity(false);
        setStatus('error', outcome.message);
        return;
      case 'fieldErrors':
        // Server-side truth wins — same contract, same field names.
        setFieldErrors(outcome.fieldErrors);
        setTouched(
          new Set([
            'companyName',
            'tagline',
            'targetUrl',
            'twitterHandle',
            'mrrText',
            'maxBidDollars',
          ]),
        );
        setStatus('idle');
        return;
      case 'error':
        setStatus('error', outcome.message);
        return;
    }
  };

  const copy = modeCopy(mode);
  const locked = status === 'submitting' || status === 'success';
  const iAmTenant = !!plot.tenantPreBidId && myPreBidIds.has(plot.tenantPreBidId);
  // Newer server-side brand: I hold the lease but the billboard shows a
  // different company than my saved prefill (edited from another tab/device).
  const divergent =
    !!prefill &&
    iAmTenant &&
    !!plot.tenant?.companyName &&
    plot.tenant.companyName !== prefill.companyName;

  const parsedAmount = parseDollarsToCents(values.maxBidDollars);
  const submitLabel =
    status === 'submitting'
      ? 'Submitting…'
      : parsedAmount.ok
        ? `${copy.cta} · ${plot.id} · up to ${formatPrice(parsedAmount.cents)}`
        : `${copy.cta} · ${plot.id}`;

  const errorEntries = Object.entries(fieldErrors).filter(([, m]) => !!m) as [string, string][];

  /** Outbid retry: apply the server minimum, refresh state, keep my values. */
  const handleOutbidRetry = () => {
    window.dispatchEvent(new Event('city-refetch'));
    if (typeof outbidMinimumCents === 'number') {
      setValues((v) => ({ ...v, maxBidDollars: (outbidMinimumCents / 100).toFixed(2) }));
      setTouched((t) => new Set(t).add('maxBidDollars'));
      setAnnounce(`New minimum ${formatPrice(outbidMinimumCents)} applied. Review and resubmit.`);
    }
    setStatus('idle');
    window.setTimeout(() => amountRef.current?.focus(), 0);
  };

  /** Take the billboard's newer brand into the form instead of my prefill. */
  const useBillboardBrand = () => {
    const t = plot.tenant;
    if (!t) return;
    setValues((v) => ({
      ...v,
      companyName: t.companyName ?? v.companyName,
      tagline: t.tagline ?? '',
      targetUrl: t.targetUrl ?? v.targetUrl,
      twitterHandle: t.twitterHandle ?? '',
      mrrText: t.mrrText ?? '',
    }));
    setCompactIdentity(false);
    setOverwriteAck(true);
  };
  const showErr = (k: keyof FieldErrors) =>
    (touched.has(k) ||
      (k === 'maxBidCents' && touched.has('maxBidDollars')) ||
      status === 'error') &&
    fieldErrors[k];

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bid-modal-title"
          aria-describedby="bid-modal-blurb"
          onKeyDown={onKeyDown}
          className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-[#12303a] bg-[#050508] p-5 shadow-[0_0_40px_rgba(0,240,255,0.2)]"
        >
          {/* Screen-reader announcements (retry minimums, corrections). */}
          <div aria-live="polite" role="status" className="sr-only">
            {announce}
          </div>
          {status === 'success' ? (
            <SuccessView
              mode={mode}
              plotLabel={plot.id}
              result={result}
              committedCents={committedCents}
              mockResolveEnabled={mockResolveEnabled}
              onClose={doClose}
            />
          ) : status === 'outbid' ? (
            <OutbidView
              message={serverError}
              minimumCents={outbidMinimumCents}
              onRetry={handleOutbidRetry}
              onClose={doClose}
            />
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2
                    id="bid-modal-title"
                    className="text-base font-bold uppercase tracking-wider text-[#00f0ff]"
                  >
                    {copy.title}
                  </h2>
                  <p id="bid-modal-blurb" className="mt-1 text-xs leading-snug text-[#9fd8e6]">
                    {copy.blurb}
                  </p>
                </div>
                <button
                  ref={closeBtnRef}
                  type="button"
                  onClick={requestClose}
                  aria-label="Close dialog"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded px-1.5 text-base leading-none text-[#9fd8e6] hover:text-[#e8f6ff] focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
                >
                  ×
                </button>
              </div>

              {plot.status === 'LIVE' && mode === 'bid' ? (
                <div className="mt-3 flex items-center justify-between rounded border border-[#12303a] bg-[#0b0e14] px-3 py-2 font-mono text-xs">
                  <span className="text-[#6b7a8c]">
                    current {formatPrice(plot.currentPriceCents ?? 0)}
                  </span>
                  <span className="text-[#9fd8e6]">min next {formatPrice(min)}</span>
                </div>
              ) : (
                <div className="mt-3 rounded border border-[#12303a] bg-[#0b0e14] px-3 py-2 font-mono text-xs text-[#9fd8e6]">
                  floor {formatPrice(min)} · {plot.tier} tier
                </div>
              )}

              {/* Financial consent: proxy, clearing, capture, cancellation. */}
              <div className="mt-3 rounded border border-[#12303a] bg-[#0b0e14]/60 px-3 py-2 text-xs leading-snug text-[#9fd8e6]">
                <p>
                  Your maximum is the most you will ever pay. The proxy bids the lowest amount
                  needed to keep you ahead — you pay the clearing price (about second-highest + one
                  increment), never the full max unless challenged that far.
                </p>
                <p className="mt-1.5">
                  Nothing is charged now. The winner is charged when the cycle closes.{' '}
                  {mockResolveEnabled
                    ? 'Demo environment: settlement is simulated, no real card is charged.'
                    : 'Payments are not connected yet: your bid locks the lease outcome but no charge runs today.'}
                </p>
                <p className="mt-1.5">
                  Outbid before close? Your authorization is released automatically — raise your max
                  any time to retake the lead.
                </p>
              </div>

              {divergent && !overwriteAck ? (
                <div
                  role="alert"
                  className="mt-3 rounded border border-[#ffb400]/50 bg-[#ffb400]/10 px-3 py-2 text-xs text-[#ffb400]"
                >
                  <p>
                    The billboard shows a newer brand (“{plot.tenant?.companyName}”) than your saved
                    one (“{prefill?.companyName}”). Submitting would overwrite it.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={useBillboardBrand}
                      className="min-h-11 flex-1 rounded border border-[#ffb400]/60 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-[#ffb400]/10"
                    >
                      Use billboard brand
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverwriteAck(true)}
                      className="min-h-11 flex-1 rounded border border-[#2a3a46] px-2 py-1.5 text-xs uppercase tracking-wider text-[#9fd8e6] hover:text-[#e8f6ff]"
                    >
                      Keep my saved brand
                    </button>
                  </div>
                </div>
              ) : null}

              {errorEntries.length > 0 ? (
                <div
                  ref={errorSummaryRef}
                  tabIndex={-1}
                  role="alert"
                  aria-label={`${errorEntries.length} problem${errorEntries.length === 1 ? '' : 's'} to fix`}
                  className="mt-3 rounded border border-[#ff0055]/50 bg-[#ff0055]/10 px-3 py-2 text-xs text-[#ff5c8a] focus:outline-none focus-visible:outline-2 focus-visible:outline-[#ff0055]"
                >
                  <p className="font-semibold uppercase tracking-wider">
                    Check {errorEntries.length === 1 ? 'this field' : 'these fields'}:
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {errorEntries.map(([field, msg]) => (
                      <li key={field}>{msg}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <form
                className="mt-4 space-y-3"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                {compactIdentity && prefill ? (
                  <div className="flex items-center justify-between gap-2 rounded border border-[#12303a] bg-[#0b0e14] px-3 py-2">
                    <span className="text-xs text-[#9fd8e6]">
                      Bidding as <strong className="text-[#e8f6ff]">{prefill.companyName}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCompactIdentity(false);
                        window.setTimeout(() => firstFieldRef.current?.focus(), 0);
                      }}
                      className="min-h-11 shrink-0 rounded px-2 py-1 text-xs text-[#00f0ff] underline decoration-[#00f0ff]/40 hover:decoration-[#00f0ff] focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
                    >
                      Change identity
                    </button>
                  </div>
                ) : (
                  <>
                    <Field
                      label="Company name *"
                      error={showErr('companyName')}
                      htmlFor="bid-company"
                    >
                      <input
                        ref={firstFieldRef}
                        id="bid-company"
                        name="companyName"
                        type="text"
                        autoComplete="organization"
                        spellCheck={false}
                        value={values.companyName}
                        onChange={set('companyName')}
                        onBlur={blur('companyName')}
                        disabled={locked}
                        maxLength={48}
                        placeholder="CodeShip"
                        aria-invalid={!!showErr('companyName')}
                        aria-describedby={showErr('companyName') ? 'bid-company-err' : undefined}
                        className={inputCls(showErr('companyName'))}
                      />
                    </Field>
                    <Field
                      label="Target URL *"
                      error={showErr('targetUrl')}
                      htmlFor="bid-url"
                      errId="bid-url-err"
                    >
                      <input
                        id="bid-url"
                        name="targetUrl"
                        type="url"
                        autoComplete="url"
                        inputMode="url"
                        spellCheck={false}
                        value={values.targetUrl}
                        onChange={set('targetUrl')}
                        onBlur={blur('targetUrl')}
                        disabled={locked}
                        maxLength={2000}
                        placeholder="https://codeship.dev"
                        aria-invalid={!!showErr('targetUrl')}
                        aria-describedby={showErr('targetUrl') ? 'bid-url-err' : undefined}
                        className={inputCls(showErr('targetUrl'))}
                      />
                    </Field>
                    <Field
                      label="X handle *"
                      error={showErr('twitterHandle')}
                      htmlFor="bid-handle"
                      errId="bid-handle-err"
                    >
                      <input
                        id="bid-handle"
                        name="twitterHandle"
                        type="text"
                        autoComplete="username"
                        spellCheck={false}
                        value={values.twitterHandle}
                        onChange={set('twitterHandle')}
                        onBlur={blur('twitterHandle')}
                        disabled={locked}
                        maxLength={32}
                        placeholder="@codeship"
                        aria-invalid={!!showErr('twitterHandle')}
                        aria-describedby={showErr('twitterHandle') ? 'bid-handle-err' : undefined}
                        className={inputCls(showErr('twitterHandle'))}
                      />
                    </Field>
                    <Field
                      label="Tagline"
                      error={showErr('tagline')}
                      htmlFor="bid-tagline"
                      errId="bid-tagline-err"
                    >
                      <input
                        id="bid-tagline"
                        name="tagline"
                        type="text"
                        autoComplete="off"
                        spellCheck
                        value={values.tagline}
                        onChange={set('tagline')}
                        onBlur={blur('tagline')}
                        disabled={locked}
                        maxLength={80}
                        placeholder="Ship faster"
                        aria-invalid={!!showErr('tagline')}
                        aria-describedby={showErr('tagline') ? 'bid-tagline-err' : undefined}
                        className={inputCls(showErr('tagline'))}
                      />
                    </Field>
                    <Field
                      label="MRR badge (optional, e.g. $12k)"
                      error={showErr('mrrText')}
                      htmlFor="bid-mrr"
                      errId="bid-mrr-err"
                    >
                      <input
                        id="bid-mrr"
                        name="mrrText"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={values.mrrText}
                        onChange={set('mrrText')}
                        onBlur={blur('mrrText')}
                        disabled={locked}
                        maxLength={20}
                        placeholder="$12k"
                        aria-invalid={!!showErr('mrrText')}
                        aria-describedby={showErr('mrrText') ? 'bid-mrr-err' : undefined}
                        className={inputCls(showErr('mrrText'))}
                      />
                    </Field>
                  </>
                )}
                <Field
                  label={`Your maximum (USD) * — at least ${formatPrice(min)}`}
                  error={showErr('maxBidCents')}
                  htmlFor="bid-amount"
                  errId="bid-amount-err"
                >
                  <input
                    ref={amountRef}
                    id="bid-amount"
                    name="maxBidCents"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={values.maxBidDollars}
                    onChange={(e) => setValues((v) => ({ ...v, maxBidDollars: e.target.value }))}
                    onBlur={() => {
                      setTouched((t) => new Set(t).add('maxBidDollars'));
                      blur('maxBidDollars')();
                    }}
                    disabled={locked}
                    inputMode="decimal"
                    placeholder={(min / 100).toFixed(2)}
                    aria-invalid={!!showErr('maxBidCents')}
                    aria-describedby={showErr('maxBidCents') ? 'bid-amount-err' : 'bid-amount-help'}
                    className={inputCls(showErr('maxBidCents'))}
                  />
                  <span id="bid-amount-help" className="mt-1 block text-xs text-[#6b7a8c]">
                    Type the exact max — nothing is filled in for you. You pay the clearing price,
                    capped at this max.
                  </span>
                </Field>

                {status === 'error' && serverError ? (
                  <p
                    role="alert"
                    className="rounded border border-[#ff0055]/50 bg-[#ff0055]/10 px-3 py-2 text-xs text-[#ff5c8a]"
                  >
                    {serverError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={locked}
                  aria-label={submitLabel}
                  className="mt-2 min-h-11 w-full rounded border border-[#00f0ff]/60 bg-[#00f0ff]/15 px-3 py-2.5 text-sm font-bold uppercase tracking-wider text-[#00f0ff] hover:bg-[#00f0ff]/25 active:bg-[#00f0ff]/35 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00f0ff]"
                >
                  {submitLabel}
                </button>
                <p className="text-center text-xs leading-snug text-[#9fd8e6]">
                  No account — you&apos;re identified by a browser cookie. Clearing cookies or
                  switching devices means you can&apos;t manage this bid later, but it never affects
                  the auction itself.
                </p>
                {confirmDiscard ? (
                  <div
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="discard-title"
                    aria-describedby="discard-desc"
                    className="rounded border border-[#ffb400]/40 bg-[#ffb400]/10 px-3 py-2 text-xs text-[#ffb400]"
                  >
                    <p id="discard-title" className="font-semibold uppercase tracking-wider">
                      Discard unsaved changes?
                    </p>
                    <p id="discard-desc" className="mt-0.5 text-[#9fd8e6]">
                      Your typed bid details will be lost. Esc keeps editing.
                    </p>
                    <span className="mt-2 flex gap-2">
                      <button
                        ref={keepEditingRef}
                        type="button"
                        onClick={cancelDiscard}
                        className="min-h-11 flex-1 rounded border border-[#ffb400]/70 px-2 py-1.5 font-semibold uppercase tracking-wider text-[#ffb400] hover:bg-[#ffb400]/10 focus-visible:outline-2 focus-visible:outline-[#ffb400]"
                      >
                        Keep editing
                      </button>
                      <button
                        type="button"
                        onClick={doClose}
                        className="min-h-11 flex-1 rounded border border-[#2a3a46] px-2 py-1.5 uppercase tracking-wider text-[#9fd8e6] hover:text-[#e8f6ff] focus-visible:outline-2 focus-visible:outline-[#9fd8e6]"
                      >
                        Discard
                      </button>
                    </span>
                  </div>
                ) : null}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function toInput(v: FormValues, plotId: string, fallbackMin: number): BidFormInput {
  // Part 6 `financial-consent-copy`: an empty amount is NOT silently filled
  // with the minimum — it fails validation so the bidder types an explicit
  // number (the minimum is shown as helper text, never auto-submitted).
  const trimmed = v.maxBidDollars.trim();
  const cents = trimmed === '' ? NaN : toCents(v.maxBidDollars);
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

/**
 * Part 6 `amount-parser`: overlay the strict parser's precise message over
 * the schema's generic minimum error, so `5junk` explains itself instead of
 * reading as a too-low amount.
 */
function amountError(rawDollars: string): string | null {
  const r = parseDollarsToCents(rawDollars);
  return r.ok ? null : r.error;
}

function inputCls(hasErr: unknown): string {
  // Part 6 `undersized-ui`: 16px input text stops iOS focus zoom.
  const base =
    'w-full rounded border bg-[#0b0e14] px-3 py-2.5 text-base text-[#e8f6ff] placeholder:text-[#3a4a56] focus:outline-none focus:border-[#00f0ff]/70 focus-visible:outline-2 focus-visible:outline-[#00f0ff] disabled:opacity-50';
  return hasErr ? `${base} border-[#ff0055]/60` : `${base} border-[#12303a]`;
}

function Field({
  label,
  error,
  htmlFor,
  errId,
  children,
}: {
  label: string;
  error?: string | false | undefined;
  htmlFor: string;
  errId?: string;
  children: React.ReactNode;
}) {
  const describedId = errId ?? `${htmlFor}-err`;
  return (
    <div className="block">
      <label
        htmlFor={htmlFor}
        className="mb-1 block font-mono text-xs uppercase tracking-[0.15em] text-[#9fd8e6]"
      >
        {label}
      </label>
      {children}
      {error ? (
        <span id={describedId} className="mt-1 block text-xs text-[#ff5c8a]">
          {error}
        </span>
      ) : null}
    </div>
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
  committedCents,
  mockResolveEnabled,
  onClose,
}: {
  mode: string;
  plotLabel: string;
  result: SubmitResult | null;
  /** The exact max the server accepted — receipt-quality, not re-derived. */
  committedCents: number | null;
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
      <div className="text-3xl" aria-hidden>
        🛰️
      </div>
      <h2 className="mt-2 text-base font-bold uppercase tracking-wider text-[#00f0ff]">
        {headline}
      </h2>
      {/* Receipt-quality summary: exact plot, exact commitment, what next. */}
      {committedCents != null ? (
        <dl className="mx-auto mt-3 max-w-[300px] rounded border border-[#12303a] bg-[#0b0e14] px-3 py-2 text-left text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-[#6b7a8c]">Plot</dt>
            <dd className="font-mono text-[#e8f6ff]">{plotLabel}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <dt className="text-[#6b7a8c]">Your max</dt>
            <dd className="font-mono text-[#e8f6ff]">{formatPrice(committedCents)}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <dt className="text-[#6b7a8c]">You pay</dt>
            <dd className="text-right text-[#9fd8e6]">clearing price, capped at your max</dd>
          </div>
        </dl>
      ) : null}
      <p className="mx-auto mt-2 max-w-[300px] text-xs leading-snug text-[#9fd8e6]">
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

      <button
        type="button"
        onClick={onClose}
        className="mt-4 rounded border border-[#00f0ff]/60 bg-[#00f0ff]/15 px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-[#00f0ff] hover:bg-[#00f0ff]/25"
      >
        Back to the city
      </button>
    </div>
  );
}

function OutbidView({
  message,
  minimumCents,
  onRetry,
  onClose,
}: {
  message: string | null;
  /** Server's fresh required minimum — applied to the form on retry. */
  minimumCents: number | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="py-6 text-center">
      <div className="text-3xl" aria-hidden>
        ⚠️
      </div>
      <h2 className="mt-2 text-base font-bold uppercase tracking-wider text-[#ffb400]">
        You were outbid mid-submit
      </h2>
      <p className="mx-auto mt-2 max-w-[300px] text-xs leading-snug text-[#9fd8e6]">
        {message ?? 'Someone else just took the lead — try a higher amount.'}
      </p>
      {minimumCents != null ? (
        <p className="mx-auto mt-2 max-w-[300px] font-mono text-xs text-[#ffb400]">
          New minimum to lead: {formatPrice(minimumCents)} — applied to your form on retry.
        </p>
      ) : null}
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded border border-[#ffb400]/70 bg-[#ffb400]/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#ffb400] hover:bg-[#ffb400]/25 focus-visible:outline-2 focus-visible:outline-[#ffb400]"
        >
          Bid higher
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded border border-[#2a3a46] px-4 py-2 text-xs uppercase tracking-wider text-[#9fd8e6] hover:text-[#e8f6ff] focus-visible:outline-2 focus-visible:outline-[#9fd8e6]"
        >
          Later
        </button>
      </div>
    </div>
  );
}
