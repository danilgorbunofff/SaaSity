'use client';

import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';

/**
 * M0 placeholder — proves the /api/plots read path works end to end.
 * Replaced by the real 3D city in Milestone 1.
 */

interface PlotsSummary {
  total: number;
  byTier: Record<string, number>;
  byStatus: Record<string, number>;
  source: 'api' | 'unavailable';
}

export default function CityPlaceholder() {
  const [summary, setSummary] = useState<PlotsSummary | null>(null);

  useEffect(() => {
    fetch('/api/plots')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((payload: { plots: PlotDto[] }) => {
        const byTier: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        for (const p of payload.plots) {
          byTier[p.tier] = (byTier[p.tier] ?? 0) + 1;
          byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
        }
        setSummary({ total: payload.plots.length, byTier, byStatus, source: 'api' });
      })
      .catch(() => setSummary({ total: 0, byTier: {}, byStatus: {}, source: 'unavailable' }));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex items-center gap-3">
        <Building2 className="h-8 w-8 text-neon-cyan" aria-hidden />
        <h1 className="text-3xl font-bold tracking-tight">SaaSity</h1>
      </div>
      <p className="text-muted">M0 placeholder — the isometric city arrives in Milestone 1.</p>
      <div className="rounded-lg border border-neon-cyan/30 bg-surface p-6 font-mono text-sm">
        {summary === null && <p className="animate-pulse">Loading grid…</p>}
        {summary?.source === 'unavailable' && (
          <p className="text-neon-magenta">
            /api/plots unreachable — run migrate + seed (see docs/plans/00-*).
          </p>
        )}
        {summary?.source === 'api' && (
          <>
            <p className="text-neon-cyan">{summary.total} plots online</p>
            <p>by tier: {JSON.stringify(summary.byTier)}</p>
            <p>by status: {JSON.stringify(summary.byStatus)}</p>
          </>
        )}
      </div>
    </main>
  );
}

interface PlotDto {
  id: string;
  tier: string;
  status: string;
}
