/**
 * Part 5 `selection-feedback` (minimap leg): cell resolution is pinned —
 * outbid overrides the base kind, and selection is tracked independently
 * so the minimap can render it in sync with the 3D ring.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { minimapCellKind, findNextCell } from '../../src/components/city/hud/Minimap';
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
  assert.equal(minimapCellKind(p, new Set(['my-prebid']), new Set(['a'])), 'outbid');
});

// Part 6 `keyboard-fallback` — arrows skip empty cells predictably.
test('findNextCell skips empties in the pressed direction', () => {
  const cells: (string | null)[][] = [
    ['a', null, null],
    [null, null, 'b'],
    [null, null, null],
  ];
  assert.deepEqual(findNextCell(cells, 0, 0, 1, 0), null); // row 0: nothing right
  assert.deepEqual(findNextCell(cells, 0, 0, 0, 1), null); // col 0: nothing below
  assert.deepEqual(findNextCell(cells, 0, 1, 1, 0)?.id, 'b'); // gap skipped
});

test('findNextCell returns null at the edge (focus stays put)', () => {
  const cells: (string | null)[][] = [[null, 'a']];
  assert.equal(findNextCell(cells, 1, 0, 1, 0), null);
  assert.equal(findNextCell(cells, 1, 0, -1, 0), null);
});
