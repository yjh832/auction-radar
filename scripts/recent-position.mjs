function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

const POSITION_WINDOW = 10;
const MIN_REQUIRED_BARS = 11;

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
      label: "10日数据不足",
      percentile: null,
      currentPercentile: null,
      rangeLow: null,
      rangeHigh: null,
      baseClose: null,
      baseDate: null,
      streak: Math.max(0, Math.floor(limitStreak)),
      tenDayReturn: null,
      distanceToTenDayLimit: null,
      tenDayStartDate: null,
      tenDayStartClose: null,
      return10: null
    };
  }
  const current = bars.at(-1);
  const streak = Math.max(1, Math.floor(limitStreak || 1));
  const launchIndex = Math.max(0, bars.length - streak);
  const prior = bars.slice(0, launchIndex).slice(-POSITION_WINDOW);
  if (prior.length < POSITION_WINDOW) {
    return {
      status: "unavailable",
      label: "连板前10日数据不足",
      percentile: null,
      currentPercentile: null,
      rangeLow: null,
      rangeHigh: null,
      baseClose: null,
      baseDate: null,
      streak,
      tenDayReturn: null,
      distanceToTenDayLimit: null,
      tenDayStartDate: null,
      tenDayStartClose: null,
      return10: null
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
  const tenDayStart = bars.at(-POSITION_WINDOW - 1);
  const tenDayReturn = current.close / tenDayStart.close - 1;
  const distanceToTenDayLimit = Math.max(0, 1 - tenDayReturn);
  const status =
    tenDayReturn <= 0.3 && distanceToTenDayLimit >= 0.7
      ? "low"
      : tenDayReturn <= 0.6 && distanceToTenDayLimit >= 0.4
        ? "middle"
        : "high";
  return {
    status,
    label:
      status === "low"
        ? "10日低位启动"
        : status === "high"
          ? "10日高位加速"
          : "10日中位启动",
    percentile,
    currentPercentile,
    rangeLow: low,
    rangeHigh: high,
    baseClose: base.close,
    baseDate: base.date,
    streak,
    tenDayReturn,
    distanceToTenDayLimit,
    tenDayStartDate: tenDayStart.date,
    tenDayStartClose: tenDayStart.close,
    return10: tenDayReturn
  };
}
