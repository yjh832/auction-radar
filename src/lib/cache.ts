import type { LiveResult } from "../types";

const CACHE_KEY = "auction-radar:latest-snapshot:v1";

interface CachedSnapshot {
  savedAt: string;
  tradeDate: string;
  live: LiveResult;
}

export function loadCachedResult(): LiveResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedSnapshot;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    return cached.tradeDate === today ? cached.live : null;
  } catch {
    return null;
  }
}

export function saveCachedResult(live: LiveResult) {
  try {
    const tradeDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    const cached: CachedSnapshot = {
      savedAt: new Date().toISOString(),
      tradeDate,
      live
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // Local storage can be disabled; the live result still remains in memory.
  }
}
