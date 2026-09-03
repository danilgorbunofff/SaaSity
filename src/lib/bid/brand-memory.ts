/**
 * Part 6 `outbid-form-not-prefilled`: the caller-side brand memory.
 *
 * `/api/me/bids` deliberately never returns brand or max amounts (privacy),
 * so the client remembers what *it* last submitted per plot in localStorage.
 * "Jump & Outbid" then reopens a form already filled with the caller's own
 * brand — the top-up asks only for the new maximum.
 *
 * Amounts are the caller's own data on their own device; nothing sensitive.
 */

export interface SavedBrand {
  companyName: string;
  tagline: string;
  targetUrl: string;
  twitterHandle: string;
  mrrText: string;
  savedAt: number;
}

const KEY_PREFIX = 'saasity.brand.';

function keyFor(plotId: string): string {
  return KEY_PREFIX + plotId;
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveBrand(plotId: string, brand: Omit<SavedBrand, 'savedAt'>): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(keyFor(plotId), JSON.stringify({ ...brand, savedAt: Date.now() }));
  } catch {
    // Quota/private-mode: prefill is a convenience, never a blocker.
  }
}

export function loadBrand(plotId: string): SavedBrand | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(keyFor(plotId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedBrand>;
    if (typeof parsed.companyName !== 'string' || typeof parsed.targetUrl !== 'string') return null;
    return {
      companyName: parsed.companyName,
      tagline: typeof parsed.tagline === 'string' ? parsed.tagline : '',
      targetUrl: parsed.targetUrl,
      twitterHandle: typeof parsed.twitterHandle === 'string' ? parsed.twitterHandle : '',
      mrrText: typeof parsed.mrrText === 'string' ? parsed.mrrText : '',
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearBrand(plotId: string): void {
  try {
    storage()?.removeItem(keyFor(plotId));
  } catch {
    // Never blocks.
  }
}
