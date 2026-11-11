function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

const POSITION_WINDOW = 30;
const MIN_REQUIRED_BARS = 15;

export function analyzeRecentPosition(history, limitStreak = 1) {
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
  if (bars.length < MIN_REQUIRED_BARS) {
    return {
      status: "unavailable",
      label: "30日数据不足",
      percentile: null,
      currentPercentile: null,
      rangeLow: null,
      rangeHigh: null,
      baseClose: null,
      baseDate: null,
      streak: Math.max(0, Math.floor(limitStreak)),
      return30: null
    };
  }
  const current = bars.at(-1);
  const streak = Math.max(1, Math.floor(limitStreak || 1));
  const launchIndex = Math.max(0, bars.length - streak);
  const prior = bars.slice(0, launchIndex).slice(-POSITION_WINDOW);
  if (prior.length < MIN_REQUIRED_BARS) {
    return {
      status: "unavailable",
      label: "连板前30日数据不足",
      percentile: null,
      currentPercentile: null,
      rangeLow: null,
      rangeHigh: null,
      baseClose: null,
      baseDate: null,
      streak,
      return30: null
    };
  }
  const base = prior.at(-1);
  const low = Math.min(...prior.map((item) => item.close));
  const high = Math.max(...prior.map((item) => item.close));
  const percentile = clamp(((base.close - low) / Math.max(high - low, 0.0001)) * 100);
  const currentWindow = bars.slice(-POSITION_WINDOW);
  const currentLow = Math.min(...currentWindow.map((item) => item.close));
  const currentHigh = Math.max(...currentWindow.map((item) => item.close));
  const currentPercentile = clamp(
    ((current.close - currentLow) / Math.max(currentHigh - currentLow, 0.0001)) * 100
  );
  return {
    status: percentile <= 35 ? "low" : percentile >= 70 ? "high" : "middle",
    label:
      percentile <= 35
        ? "30日低位启动"
        : percentile >= 70
          ? "30日高位加速"
          : "30日中位启动",
    percentile,
    currentPercentile,
    rangeLow: low,
    rangeHigh: high,
    baseClose: base.close,
    baseDate: base.date,
    streak,
    return30:
      bars.length > POSITION_WINDOW
        ? current.close / bars.at(-POSITION_WINDOW - 1).close - 1
        : current.close / bars[0].close - 1
  };
}
