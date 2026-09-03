'use client';

import dynamic from 'next/dynamic';

/**
 * Client wrapper hosting the ssr:false dynamic import — `ssr: false` is only
 * legal inside Client Components (Next 16), so page.tsx (server) renders this.
 */

const CityScene = dynamic(() => import('./CityScene').then((m) => m.CityScene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[var(--background)]">
      <p className="animate-pulse font-mono text-sm text-[var(--muted)]">booting city renderer…</p>
    </div>
  ),
});

export function CityViewport() {
  return (
    <div className="absolute inset-0">
      <CityScene />
    </div>
  );
}
