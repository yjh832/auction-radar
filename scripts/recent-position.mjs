function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export function analyzeRecentPosition(history) {
  const byDate = new Map();
  for (const item of history ?? []) {
    if (!item?.date || Number(item.close) <= 0) continue;
    byDate.set(item.date, {
      date: item.date,
      close: Number(item.close)
    });
  }
  const bars = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  if (bars.length < 7) {
    return {
      status: "unavailable",
      label: "近半月数据不足",
      percentile: null,
      currentPercentile: null,
      rangeLow: null,
      rangeHigh: null,
      baseClose: null,
      return15: null
    };
  }
  const current = bars.at(-1);
  const prior = bars.slice(0, -1).slice(-15);
  const base = prior.at(-1);
  const low = Math.min(...prior.map((item) => item.close));
  const high = Math.max(...prior.map((item) => item.close));
  const percentile = clamp(((base.close - low) / Math.max(high - low, 0.0001)) * 100);
  const currentWindow = bars.slice(-15);
  const currentLow = Math.min(...currentWindow.map((item) => item.close));
  const currentHigh = Math.max(...currentWindow.map((item) => item.close));
  const currentPercentile = clamp(
    ((current.close - currentLow) / Math.max(currentHigh - currentLow, 0.0001)) * 100
  );
  return {
    status: percentile <= 35 ? "low" : percentile >= 70 ? "high" : "middle",
    label:
      percentile <= 35
        ? "近半月低位启动"
        : percentile >= 70
          ? "近半月高位加速"
          : "近半月中位启动",
    percentile,
    currentPercentile,
    rangeLow: low,
    rangeHigh: high,
    baseClose: base.close,
    return15:
      bars.length > 15
        ? current.close / bars.at(-16).close - 1
        : current.close / bars[0].close - 1
  };
}
