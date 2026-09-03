/**
 * Part 5 `selection-feedback` (minimap leg): cell resolution is pinned —
 * outbid overrides the base kind, and selection is tracked independently
 * so the minimap can render it in sync with the 3D ring.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { minimapCellKind } from '../../src/components/city/hud/Minimap';
import type { PlotDto } from '../../src/types/api';

function plot(overrides: Partial<PlotDto> & Pick<PlotDto, 'id' | 'status'>): PlotDto {
  return {
    id: overrides.id,
    tier: 'OUTER',
    originX: 0,
    originY: 0,
    spanX: 1,
    spanY: 1,
    status: overrides.status,
    currentPriceCents: overrides.currentPriceCents,
    endAt: overrides.endAt,
    cycleId: overrides.cycleId,
    currentLeaderPreBidId: overrides.currentLeaderPreBidId,
  };
}

test('idle plot with no position resolves idle', () => {
  assert.equal(minimapCellKind(plot({ id: 'a', status: 'IDLE' }), new Set(), new Set()), 'idle');
});

test('live plot led by a rival resolves taken', () => {
  const p = plot({ id: 'a', status: 'LIVE', currentLeaderPreBidId: 'rival-prebid' });
  assert.equal(minimapCellKind(p, new Set(['mine']), new Set()), 'taken');
});

test('live plot we lead resolves mine', () => {
  const p = plot({ id: 'a', status: 'LIVE', currentLeaderPreBidId: 'my-prebid' });
  assert.equal(minimapCellKind(p, new Set(['my-prebid']), new Set()), 'mine');
});

test('outbid flips override even though the rival leads', () => {
  const p = plot({ id: 'a', status: 'LIVE', currentLeaderPreBidId: 'rival-prebid' });
  assert.equal(
    minimapCellKind(p, new Set(['my-prebid']), new Set(['a'])),
    'outbid',
  );
});
