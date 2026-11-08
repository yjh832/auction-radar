import type {
  CandidateAnomaly,
  HistoryPoint,
  HoldingAnomalyRisk
} from "../types";

function ratioGap(limit: number, value: number | null) {
  return value === null ? null : limit - value;
}

export function buildAnomalyFromHistory(
  code: string,
  history: HistoryPoint[],
  riskNotes: string[] = []
): CandidateAnomaly {
  const closes = history
    .filter((item) => item.date && Number(item.close) > 0)
    .map((item) => ({ date: item.date, close: Number(item.close) }));
  const threshold = code.startsWith("30") || code.startsWith("68") ? 0.3 : 0.2;
  if (closes.length < 4) {
    return {
      threshold,
      threeDayReturn: 0,
      distanceToThreshold: threshold,
      tenDayReturn: null,
      thirtyDayReturn: null,
      distanceToTenDayLimit: null,
      distanceToThirtyDayLimit: null,
      nextTriggerPrice: null,
      lastAbnormalDate: null,
      daysSinceLastAbnormal: null,
      abnormalCount30: 0,
      regulatoryStatus: "clear",
      regulatoryLabels: []
    };
  }
  const current = closes.at(-1)!.close;
  const threeDayReturn = current / closes.at(-4)!.close - 1;
  const tenDayReturn =
    closes.length >= 11 ? current / closes.at(-11)!.close - 1 : null;
  const thirtyDayReturn =
    closes.length >= 31 ? current / closes.at(-31)!.close - 1 : null;
  const distanceToTenDayLimit = ratioGap(1, tenDayReturn);
  const distanceToThirtyDayLimit = ratioGap(2, thirtyDayReturn);
  const nextTriggerPrice =
    closes.length >= 3 ? closes.at(-3)!.close * (1 + threshold) : null;
  const events: Array<{ date: string; value: number }> = [];
  for (let index = 3; index < closes.length; index += 1) {
    const value = closes[index].close / closes[index - 3].close - 1;
    if (Math.abs(value) >= threshold) {
      events.push({ date: closes[index].date, value });
    }
  }
  const lastEvent = events.at(-1);
  const lastAbnormalDate = lastEvent?.date ?? null;
  const lastIndex = lastAbnormalDate
    ? closes.findIndex((item) => item.date === lastAbnormalDate)
    : -1;
  const daysSinceLastAbnormal =
    lastIndex >= 0 ? closes.length - 1 - lastIndex : null;
  const labels: string[] = [];
  if (Math.abs(threeDayReturn) >= threshold) {
    labels.push("当前3日异动阈值已达到");
  }
  if (tenDayReturn !== null && tenDayReturn >= 1) {
    labels.push("10日累计涨幅达到100%红线");
  }
  if (thirtyDayReturn !== null && thirtyDayReturn >= 2) {
    labels.push("30日累计涨幅达到200%红线");
  }
  if (lastAbnormalDate && daysSinceLastAbnormal !== null && daysSinceLastAbnormal <= 3) {
    labels.push(`近${daysSinceLastAbnormal + 1}日出现异动`);
  }
  if (/异常波动|风险提示|监管|关注函|问询|立案/.test(riskNotes.join(" "))) {
    labels.push("公开风险提示命中");
  }
  const distanceToThreshold = Math.max(0, threshold - threeDayReturn);
  const regulatoryStatus =
    labels.some((label) => label.includes("阈值已达到")) ||
    labels.some((label) => label.includes("红线")) ||
    (daysSinceLastAbnormal !== null && daysSinceLastAbnormal <= 3)
      ? "abnormal"
      : distanceToThreshold / threshold <= 0.3 ||
          (distanceToTenDayLimit !== null && distanceToTenDayLimit <= 0.15) ||
          (distanceToThirtyDayLimit !== null && distanceToThirtyDayLimit <= 0.3) ||
          labels.length > 0
        ? "watch"
        : "clear";
  return {
    threshold,
    threeDayReturn,
    distanceToThreshold,
    tenDayReturn,
    thirtyDayReturn,
    distanceToTenDayLimit,
    distanceToThirtyDayLimit,
    nextTriggerPrice,
    lastAbnormalDate,
    daysSinceLastAbnormal,
    abnormalCount30: events.length,
    regulatoryStatus,
    regulatoryLabels: labels
  };
}

export function applyIndexDeviationRisk(
  baseAnomaly: CandidateAnomaly,
  risk: HoldingAnomalyRisk | null | undefined
): CandidateAnomaly {
  if (!risk) return baseAnomaly;
  return {
    ...baseAnomaly,
    method: "index_deviation",
    benchmarkCode: risk.benchmarkCode,
    benchmarkName: risk.benchmarkName,
    currentDayDeviation: risk.currentDayDeviation,
    tenDayDeviation: risk.tenDayDeviation,
    thirtyDayDeviation: risk.thirtyDayDeviation,
    tenDayRemaining: risk.tenDayRemaining,
    thirtyDayRemaining: risk.thirtyDayRemaining,
    tenDayRedLinePrice: risk.tenDayRedLinePrice,
    thirtyDayRedLinePrice: risk.thirtyDayRedLinePrice,
    nextDayTenDayRedLinePrice: risk.nextDayTenDayRedLinePrice,
    riskAction: risk.action,
    regulatoryStatus:
      risk.status === "breached"
        ? "abnormal"
        : risk.status === "near" || risk.status === "watch"
          ? "watch"
          : "clear",
    regulatoryLabels: [risk.label, ...baseAnomaly.regulatoryLabels]
  };
}
