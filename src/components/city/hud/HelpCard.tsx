'use client';

/**
 * Part 6 `no-help-onboarding`: first-visit explainer + persistent help.
 * Shows automatically once (localStorage), then lives behind the ? button.
 * Tier names and the full lease lifecycle are explained AT the decision
 * points (claim vs bid vs pre-bid), not behind a separate docs page.
 */

import { useState } from 'react';
import { useCityStore } from '@/lib/city/store';

const SEEN_KEY = 'saasity.onboarded.v1';

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Private mode: the card just shows again next visit. Harmless.
  }
}

function isSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function HelpCard() {
  const pulseIdlePlots = useCityStore((s) => s.pulseIdlePlots);
  // First visit only (localStorage) — lazy initializer, no show-effect.
  // Client-only tree (ssr:false scene), so window access here is safe.
  const [open, setOpen] = useState<boolean>(() => !isSeen());

  const dismiss = () => {
    markSeen();
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close help' : 'Open help: how SaaSity works'}
        title="How SaaSity works"
        className="absolute right-3 top-3 z-20 flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[#12303a] bg-[#050508]/85 font-mono text-sm text-[#9fd8e6] backdrop-blur-sm hover:border-[#00f0ff]/50 hover:text-[#00f0ff] focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
      >
        ?
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="help-title"
          data-testid="hud-help"
          className="absolute bottom-[max(5.5rem,env(safe-area-inset-bottom))] left-3 z-20 max-h-[min(60dvh,26rem)] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-[#12303a] bg-[#050508]/95 p-4 backdrop-blur-sm"
        >
          <h2 id="help-title" className="text-sm font-bold uppercase tracking-wider text-[#00f0ff]">
            How SaaSity works
          </h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-snug text-[#9fd8e6]">
            <li>
              <strong className="text-[#e8f6ff]">Pick a tower.</strong> 49 plots in three tiers —{' '}
              <strong className="text-[#e8f6ff]">CORE</strong> (tallest, priciest), MID, OUTER.
              Click a tower, a RADAR cell, or an entry in 🔨 Auctions.
            </li>
            <li>
              <strong className="text-[#e8f6ff]">Idle plot?</strong> Claim it at the floor price to
              open a fresh auction.
            </li>
            <li>
              <strong className="text-[#e8f6ff]">Live auction?</strong> Bid at least one increment
              over the leader. Late bids can extend the timer (soft-close).
            </li>
            <li>
              <strong className="text-[#e8f6ff]">Set a max, not a price.</strong> The proxy bids the
              minimum needed to keep you ahead — you pay the clearing price, capped at your max.
            </li>
            <li>
              <strong className="text-[#e8f6ff]">Win → you&apos;re on the billboard</strong> until
              someone outbids you for the next lease. Losing bids are released.
            </li>
          </ol>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                pulseIdlePlots();
                dismiss();
              }}
              className="min-h-11 flex-1 rounded border border-[#00f0ff]/60 bg-[#00f0ff]/15 px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-[#00f0ff] hover:bg-[#00f0ff]/25 focus-visible:outline-2 focus-visible:outline-[#00f0ff]"
            >
              Show me idle plots
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="min-h-11 flex-1 rounded border border-[#2a3a46] px-2 py-1.5 text-xs uppercase tracking-wider text-[#9fd8e6] hover:text-[#e8f6ff] focus-visible:outline-2 focus-visible:outline-[#9fd8e6]"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
