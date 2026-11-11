import type { HistoryPoint } from "../types";

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function uniqueSorted(history: HistoryPoint[]) {
  const byDate = new Map<string, HistoryPoint>();
  for (const item of history) {
    if (!item.date || Number(item.close) <= 0) continue;
    byDate.set(item.date, { date: item.date, close: Number(item.close) });
  }
  return [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

export function analyzeRecentPosition(history: HistoryPoint[]) {
  const bars = uniqueSorted(history);
  if (bars.length < 7) {
    return {
      status: "unavailable" as const,
      label: "近半月数据不足",
      percentile: null,
      currentPercentile: null,
      rangeLow: null,
      rangeHigh: null,
      baseClose: null,
      return15: null
    };
  }
  const current = bars.at(-1)!;
  const prior = bars.slice(0, -1).slice(-15);
  const base = prior.at(-1)!;
  const low = Math.min(...prior.map((item) => item.close));
  const high = Math.max(...prior.map((item) => item.close));
  const span = Math.max(high - low, 0.0001);
  const percentile = clamp(((base.close - low) / span) * 100);
  const currentWindow = bars.slice(-15);
  const currentLow = Math.min(...currentWindow.map((item) => item.close));
  const currentHigh = Math.max(...currentWindow.map((item) => item.close));
  const currentSpan = Math.max(currentHigh - currentLow, 0.0001);
  const currentPercentile = clamp(
    ((current.close - currentLow) / currentSpan) * 100
  );
  const status =
    percentile <= 35 ? "low" : percentile >= 70 ? "high" : "middle";
  return {
    status: status as "low" | "middle" | "high",
    label:
      status === "low"
        ? "近半月低位启动"
        : status === "high"
          ? "近半月高位加速"
          : "近半月中位启动",
    percentile,
    currentPercentile,
    rangeLow: low,
    rangeHigh: high,
    baseClose: base.close,
    return15:
      bars.length > 15
        ? current.close / bars.at(-16)!.close - 1
        : current.close / bars[0].close - 1
  };
}
