import type {
  Candidate,
  HoldingPosition,
  HoldingSignal,
  HoldingSnapshot,
  HoldingTechnicalProfile,
  LiveResult,
  ReviewMaps,
  StockQuoteDetail
} from "../types";

const HOLDINGS_KEY = "auction-radar:holdings:v1";
const NOTIFIED_KEY = "auction-radar:holding-alerts:v1";

export interface HoldingTick {
  at: number;
  price: number;
  volumeLots: number;
  amount: number;
  avgPrice: number;
  high: number;
}

export function loadHoldings(): HoldingPosition[] {
  try {
    const raw = localStorage.getItem(HOLDINGS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is HoldingPosition => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return (
        typeof row.code === "string" &&
        typeof row.cost === "number" &&
        typeof row.shares === "number"
      );
    });
  } catch {
    return [];
  }
}

export function saveHoldings(holdings: HoldingPosition[]) {
  try {
    localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings));
  } catch {
    // The monitor remains usable for the current session.
  }
}

export function evaluateHolding(
  position: HoldingPosition,
  quote: StockQuoteDetail,
  rapidSignal?: HoldingSignal | null,
  technical?: HoldingTechnicalProfile | null
): HoldingSnapshot {
  const avgPrice =
    quote.volumeLots > 0 ? quote.amount / (quote.volumeLots * 100) : quote.price;
  const marketValue = quote.price * position.shares;
  const pnl = (quote.price - position.cost) * position.shares;
  const pnlPct = position.cost > 0 ? quote.price / position.cost - 1 : 0;
  const dayPct = quote.changePct / 100;
  const drawdownFromHigh =
    quote.high > 0 ? quote.price / quote.high - 1 : 0;
  const costStopPrice = position.cost * (1 - position.stopLossPct / 100);
  const technicalStopCandidates = technical
    ? [technical.low20, technical.ma20 * 0.97].filter(
        (price) => price > 0 && price < quote.price * 0.995
      )
    : [];
  const technicalStop =
    technicalStopCandidates.length > 0
      ? Math.max(...technicalStopCandidates)
      : 0;
  const stopPrice = Math.max(costStopPrice, technicalStop);
  const costTakePrice = position.cost * (1 + position.takeProfitPct / 100);
  const technicalTakePrice =
    technical && technical.high20 > quote.price * 1.005
      ? technical.high20
      : 0;
  const takeCandidates = [costTakePrice, technicalTakePrice].filter(
    (price) => price > quote.price
  );
  const takeProfitPrice =
    takeCandidates.length > 0 ? Math.min(...takeCandidates) : costTakePrice;
  const takeProfitStretch =
    takeCandidates.length > 1 ? Math.max(...takeCandidates) : null;
  const belowAverage = avgPrice > 0 && quote.price < avgPrice;
  const signals: HoldingSignal[] = [];
  if (rapidSignal?.triggered) signals.push(rapidSignal);

  if (quote.price <= stopPrice) {
    signals.push({
      kind: "stop",
      title: "触发止损观察",
      detail: `现价 ${quote.price.toFixed(2)} 已跌破止损参考 ${stopPrice.toFixed(2)}，优先检查承接并控制风险。`,
      triggered: true
    });
  }

  if (quote.price >= takeProfitPrice) {
    signals.push({
      kind: "take_profit",
      title: "进入止盈区间",
      detail: `现价 ${quote.price.toFixed(2)} 已达到第一止盈参考 ${takeProfitPrice.toFixed(2)}，可观察是否分批锁定利润。`,
      triggered: true
    });
  }

  if (
    belowAverage &&
    (dayPct <= -0.03 ||
      (drawdownFromHigh <= -0.04 && quote.changePct >= 1))
  ) {
    signals.push({
      kind: "reduce",
      title: "分时转弱，减仓观察",
      detail:
        drawdownFromHigh <= -0.04
          ? `较日内高点回落 ${(drawdownFromHigh * 100).toFixed(2)}%，冲高回落明显。`
          : `现价低于分时均价 ${avgPrice.toFixed(2)}，当日跌幅 ${dayPct.toFixed(2)}%。`,
      triggered: true
    });
  }

  if (
    pnlPct >= -0.05 &&
    pnlPct <= 0.035 &&
    dayPct >= 0.01 &&
    quote.price >= avgPrice &&
    quote.volumeRatio >= 1.15 &&
    drawdownFromHigh > -0.025
  ) {
    signals.push({
      kind: "add",
      title: "成本附近转强，加仓观察",
      detail: `价格站上分时均价 ${avgPrice.toFixed(2)}，量比 ${quote.volumeRatio.toFixed(2)}，且未明显冲高回落。`,
      triggered: true
    });
  }

  if (drawdownFromHigh <= -0.04 && quote.changePct > 1) {
    signals.push({
      kind: "watch",
      title: "冲高回落，等待承接",
      detail: `较日内高点回落 ${(drawdownFromHigh * 100).toFixed(2)}%，暂不追涨。`,
      triggered: false
    });
  }

  if (!signals.some((signal) => signal.triggered)) {
    signals.push({
      kind: "hold",
      title: "暂无触发动作",
      detail: `当前盈亏 ${(pnlPct * 100).toFixed(2)}%，量比 ${quote.volumeRatio.toFixed(2)}，继续观察分时均价和日内高低点。`,
      triggered: false
    });
  }

  const priority: HoldingSignal["kind"][] = [
    "stop",
    "distribution",
    "washout",
    "take_profit",
    "reduce",
    "breakout",
    "add",
    "watch",
    "hold"
  ];
  const signal =
    priority
      .map((kind) => signals.find((item) => item.kind === kind))
      .find((item): item is HoldingSignal => Boolean(item)) ?? signals[0];

  return {
    position,
    quote,
    avgPrice,
    marketValue,
    pnl,
    pnlPct,
    dayPct,
    drawdownFromHigh,
    stopPrice,
    takeProfitPrice,
    takeProfitStretch,
    signal,
    signals,
    updatedAt: new Date().toISOString()
  };
}

export function createHoldingTick(quote: StockQuoteDetail): HoldingTick {
  return {
    at: Date.now(),
    price: quote.price,
    volumeLots: quote.volumeLots,
    amount: quote.amount,
    avgPrice:
      quote.volumeLots > 0 ? quote.amount / (quote.volumeLots * 100) : quote.price,
    high: quote.high
  };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function detectRapidMove(
  position: HoldingPosition,
  quote: StockQuoteDetail,
  ticks: HoldingTick[]
): HoldingSignal | null {
  if (ticks.length < 3 || quote.volumeLots <= 0) return null;
  const current = createHoldingTick(quote);
  const previous = ticks.at(-1);
  if (!previous) return null;
  const elapsedSeconds = Math.max(1, (current.at - previous.at) / 1000);
  const volumeDelta = Math.max(0, current.volumeLots - previous.volumeLots);
  const rates: number[] = [];
  for (let index = 1; index < ticks.length; index += 1) {
    const seconds = Math.max(1, (ticks[index].at - ticks[index - 1].at) / 1000);
    const delta = Math.max(
      0,
      ticks[index].volumeLots - ticks[index - 1].volumeLots
    );
    if (delta > 0) rates.push(delta / seconds);
  }
  const baselineRate = median(rates.slice(-12));
  const currentRate = volumeDelta / elapsedSeconds;
  if (baselineRate <= 0 || currentRate <= 0) return null;
  const volumePulse =
    currentRate / baselineRate;
  const tick60 = [...ticks]
    .reverse()
    .find((tick) => current.at - tick.at >= 55_000);
  const tick180 = [...ticks]
    .reverse()
    .find((tick) => current.at - tick.at >= 170_000);
  const change60 = tick60 ? quote.price / tick60.price - 1 : 0;
  const change180 = tick180 ? quote.price / tick180.price - 1 : change60;
  const belowAverage = quote.price < current.avgPrice;
  const nearHigh = quote.high > 0 && quote.price >= quote.high * 0.995;

  if (
    (change60 <= -0.015 || change180 <= -0.025) &&
    volumePulse >= 1.8 &&
    belowAverage
  ) {
    return {
      kind: "distribution",
      title: "放量急跌，疑似出货",
      detail:
        `近${tick180 ? "3分钟" : "1分钟"}下跌${Math.abs(
          (tick180 ? change180 : change60) * 100
        ).toFixed(2)}%，成交速度约为近期基线${volumePulse.toFixed(1)}倍，且跌破分时均价${current.avgPrice.toFixed(2)}。先防放量兑现，不能确认一定是出货。`,
      triggered: true
    };
  }

  if (
    (change60 <= -0.012 || change180 <= -0.02) &&
    volumePulse < 1.25 &&
    quote.price >= position.cost * 0.965
  ) {
    return {
      kind: "washout",
      title: "缩量急跌，疑似洗盘",
      detail:
        `短时下跌${Math.abs((change180 || change60) * 100).toFixed(2)}%，但成交速度仅为近期基线${volumePulse.toFixed(1)}倍。若随后快速收复${current.avgPrice.toFixed(2)}可分步观察，未收复前不补仓。`,
      triggered: true
    };
  }

  if (change60 >= 0.018 && volumePulse >= 1.6 && quote.price >= current.avgPrice) {
    return {
      kind: "breakout",
      title: "放量上冲，突破观察",
      detail:
        `近1分钟上涨${(change60 * 100).toFixed(2)}%，成交速度约为近期基线${volumePulse.toFixed(1)}倍。只有站稳分时均价${current.avgPrice.toFixed(2)}且回踩不破，才考虑加仓。`,
      triggered: true
    };
  }

  if (change60 >= 0.015 && belowAverage) {
    return {
      kind: "distribution",
      title: "冲高回落，疑似兑现",
      detail:
        `近1分钟虽上涨${(change60 * 100).toFixed(2)}%，但价格已低于分时均价${current.avgPrice.toFixed(2)}，高位追单承接不足时优先减仓观察。`,
      triggered: true
    };
  }

  if (
    volumePulse >= 2 &&
    Math.abs(change60) < 0.005 &&
    quote.price >= current.avgPrice &&
    nearHigh
  ) {
    return {
      kind: "distribution",
      title: "高位放量滞涨",
      detail:
        `成交速度骤增至近期基线${volumePulse.toFixed(1)}倍，但1分钟价格变化不足0.5%，且接近日内高点。警惕大单兑现，降低追涨优先级。`,
      triggered: true
    };
  }

  return null;
}

export function buildHoldingReviewAdvice(
  position: HoldingPosition,
  snapshot: HoldingSnapshot,
  candidate: Candidate | undefined,
  maps: ReviewMaps | undefined,
  live: LiveResult | null | undefined,
  auctionWindow = false
): HoldingSignal {
  const liveCandidate = live?.candidates.find(
    (item) => item.code === position.code
  );
  const auctionPhase = live?.mode === "auction" || auctionWindow;
  const sellSignal =
    snapshot.signal.kind === "stop"
      ? "stop"
      : snapshot.signal.kind === "distribution" ||
          snapshot.signal.kind === "reduce"
        ? "reduce"
        : snapshot.signal.kind === "take_profit"
          ? "take_profit"
          : null;
  const pricePlan =
    `止损参考 ${snapshot.stopPrice.toFixed(2)}，第一止盈 ${snapshot.takeProfitPrice.toFixed(2)}` +
    (snapshot.takeProfitStretch
      ? `，延伸止盈 ${snapshot.takeProfitStretch.toFixed(2)}`
      : "") +
    "。";

  if (auctionPhase && !liveCandidate) {
    if (snapshot.dayPct <= -0.02) {
      return {
        kind: "reduce",
        title: "竞价明显低开，减仓观察",
        detail: `当前竞价涨跌 ${(snapshot.dayPct * 100).toFixed(2)}%，未取得候选评级。${pricePlan}`,
        triggered: true
      };
    }
    if (snapshot.dayPct >= 0.01) {
      return {
        kind: "hold",
        title: "竞价红盘，持续持有观察",
        detail: `当前竞价涨跌 ${(snapshot.dayPct * 100).toFixed(2)}%。${pricePlan}`,
        triggered: true
      };
    }
    return {
      kind: "watch",
      title: "竞价平开，等待9:35承接",
      detail: `当前竞价涨跌 ${(snapshot.dayPct * 100).toFixed(2)}%。${pricePlan}`,
      triggered: true
    };
  }

  if (auctionPhase && liveCandidate && !liveCandidate.liveEligible) {
    return {
      kind: "reduce",
      title: "竞价未通过，减仓观察",
      detail: `${liveCandidate.liveReason ?? "竞价量价未通过"}。${pricePlan}`,
      triggered: true
    };
  }

  if (sellSignal === "stop" || sellSignal === "take_profit") {
    return {
      kind: sellSignal,
      title:
        sellSignal === "stop"
          ? "止损条件触发，优先控制风险"
          : "进入止盈区间，考虑分批锁定",
      detail: pricePlan,
      triggered: true
    };
  }

  if (sellSignal === "reduce") {
    return {
      kind: "reduce",
      title: "量价转弱，建议减仓观察",
      detail: `${snapshot.signal.detail}${pricePlan}`,
      triggered: true
    };
  }

  if (
    candidate?.riskLevel === "high" &&
    (snapshot.pnlPct <= 0 || snapshot.dayPct < 0)
  ) {
    return {
      kind: "reduce",
      title: "高风险持仓，降低暴露",
      detail: `${candidate.riskNotes.join("；")}。${pricePlan}`,
      triggered: true
    };
  }

  if (
    auctionPhase &&
    liveCandidate?.liveEligible &&
    liveCandidate.rank <= 3
  ) {
    return {
      kind: "hold",
      title: "竞价确认，持续持有观察",
      detail: `竞价通过且位于候选前${liveCandidate.rank}。${pricePlan}`,
      triggered: true
    };
  }

  if (candidate && candidate.rank <= 6) {
    return {
      kind: "hold",
      title: "复盘核心池内，持续持有观察",
      detail: `位于复盘候选第${candidate.rank}，三图总分${candidate.mapScores ? Math.round(candidate.mapScores.total * 100) : "—"}。${pricePlan}`,
      triggered: true
    };
  }

  if (maps?.conclusion.stance === "defend") {
    return {
      kind: "reduce",
      title: "市场进入防守状态",
      detail: `三图联合结论为“${maps.conclusion.title}”。${pricePlan}`,
      triggered: true
    };
  }

  return {
    kind: "watch",
    title: "持有观察，按价位纪律执行",
    detail: candidate
      ? `当前位于候选池第${candidate.rank}，未进入前六。${pricePlan}`
      : `当前不在核心候选池。${pricePlan}`,
    triggered: true
  };
}

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported" as const;
  if (Notification.permission === "granted") return "granted" as const;
  const permission = await Notification.requestPermission();
  return permission;
}

export async function showHoldingTestNotification() {
  if (
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return false;
  }
  const options: NotificationOptions & { vibrate?: number[] } = {
    body: "通知链路正常。交易时段出现止盈、止损、疑似出货或洗盘信号时，会按条件提醒。",
    icon: `${import.meta.env.BASE_URL}icon-192.png`,
    badge: `${import.meta.env.BASE_URL}icon-192.png`,
    tag: "auction-radar-notification-test",
    vibrate: [100, 50, 100],
    data: { url: import.meta.env.BASE_URL }
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification("竞价雷达 · 通知测试", options);
    } else {
      new Notification("竞价雷达 · 通知测试", options);
    }
    return true;
  } catch {
    return false;
  }
}

function tradeDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function wasNotified(key: string) {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return false;
    return Boolean((parsed as Record<string, unknown>)[key]);
  } catch {
    return false;
  }
}

function markNotified(key: string) {
  try {
    const today = tradeDateKey();
    const raw = localStorage.getItem(NOTIFIED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const current =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    const next: Record<string, unknown> = {};
    for (const [entryKey, value] of Object.entries(current)) {
      if (entryKey.startsWith(today)) next[entryKey] = value;
    }
    next[key] = Date.now();
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(next));
  } catch {
    // Notification de-duplication is best-effort.
  }
}

export async function notifyHoldingSignal(snapshot: HoldingSnapshot) {
  if (
    !snapshot.signal.triggered ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return false;
  }
  const key = `${tradeDateKey()}-${snapshot.position.code}-${snapshot.signal.kind}`;
  if (wasNotified(key)) return false;
  const title = `${snapshot.position.name} · ${snapshot.signal.title}`;
  const options: NotificationOptions & {
    vibrate?: number[];
    renotify?: boolean;
  } = {
    body: `${snapshot.signal.detail} 盈亏 ${(snapshot.pnlPct * 100).toFixed(2)}%。`,
    icon: `${import.meta.env.BASE_URL}icon-192.png`,
    badge: `${import.meta.env.BASE_URL}icon-192.png`,
    tag: key,
    renotify: true,
    vibrate:
      snapshot.signal.kind === "stop" ||
      snapshot.signal.kind === "distribution"
        ? [180, 80, 180]
        : [100],
    data: { url: import.meta.env.BASE_URL }
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
    markNotified(key);
    return true;
  } catch {
    return false;
  }
}

export async function notifyHoldingAdvice(
  snapshot: HoldingSnapshot,
  phase: "review" | "auction"
) {
  if (
    !snapshot.reviewAdvice ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return false;
  }
  const advice = snapshot.reviewAdvice;
  const key = `${tradeDateKey()}-${snapshot.position.code}-${phase}-${advice.kind}`;
  if (wasNotified(key)) return false;
  const title = `${snapshot.position.name} · ${phase === "review" ? "收盘复盘" : "9:25竞价"}建议`;
  const options: NotificationOptions & {
    vibrate?: number[];
    renotify?: boolean;
  } = {
    body: `${advice.title}。${advice.detail}`,
    icon: `${import.meta.env.BASE_URL}icon-192.png`,
    badge: `${import.meta.env.BASE_URL}icon-192.png`,
    tag: key,
    renotify: true,
    vibrate: advice.kind === "reduce" || advice.kind === "stop" ? [180, 80, 180] : [100],
    data: { url: import.meta.env.BASE_URL }
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
    markNotified(key);
    return true;
  } catch {
    return false;
  }
}
