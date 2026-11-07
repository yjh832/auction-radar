import type { Candidate, LiveResult, StrategyDashboard } from "../types";

export interface SinaStock {
  symbol: string;
  code: string;
  name: string;
  open: number;
  preClose: number;
  current: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  turnover: number;
}

export function chinaClock(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${parts.second}`,
    hour,
    minute,
    weekday: parts.weekday,
    minutes: hour * 60 + minute
  };
}

export function detectMarketStatus(now = new Date()) {
  const clock = chinaClock(now);
  if (clock.weekday === "Sat" || clock.weekday === "Sun") {
    return { key: "closed", label: "周末休市", liveEligible: false, clock };
  }
  if (clock.minutes < 9 * 60 + 15) {
    return { key: "preopen", label: "盘前准备", liveEligible: false, clock };
  }
  if (clock.minutes < 9 * 60 + 20) {
    return { key: "auction_open", label: "竞价可撤单", liveEligible: true, clock };
  }
  if (clock.minutes < 9 * 60 + 25) {
    return { key: "auction_final", label: "竞价锁定中", liveEligible: true, clock };
  }
  if (clock.minutes < 9 * 60 + 30) {
    return { key: "auction_result", label: "竞价结果", liveEligible: true, clock };
  }
  if (
    (clock.minutes >= 9 * 60 + 30 && clock.minutes < 11 * 60 + 30) ||
    (clock.minutes >= 13 * 60 && clock.minutes < 15 * 60)
  ) {
    return { key: "trading", label: "连续竞价", liveEligible: false, clock };
  }
  if (clock.minutes >= 11 * 60 + 30 && clock.minutes < 13 * 60) {
    return { key: "lunch", label: "午间休市", liveEligible: false, clock };
  }
  return { key: "closed", label: "已收盘", liveEligible: false, clock };
}

function isSinaRow(value: unknown): value is Record<string, string | number> {
  return typeof value === "object" && value !== null && "code" in value;
}

function toSinaStock(row: Record<string, string | number>): SinaStock {
  return {
    symbol: String(row.symbol),
    code: String(row.code),
    name: String(row.name),
    open: Number(row.open),
    preClose: Number(row.settlement),
    current: Number(row.trade),
    high: Number(row.high),
    low: Number(row.low),
    volume: Number(row.volume),
    amount: Number(row.amount),
    turnover: Number(row.turnoverratio)
  };
}

function fetchSnapshotPage(page: number): Promise<SinaStock[]> {
  return new Promise((resolve, reject) => {
    const callbackName = `__auctionRadarPage_${page}_${Date.now()}_${Math.floor(
      Math.random() * 10_000
    )}`;
    const jsonpWindow = window as typeof window & Record<string, unknown>;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`行情分页 ${page} 超时`));
    }, 15_000);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      try {
        jsonpWindow[callbackName] = undefined;
      } catch {
        // JSONP created by `var` can be non-configurable but remains writable.
      }
    }

    script.charset = "gbk";
    script.async = true;
    script.src =
      "https://vip.stock.finance.sina.com.cn/quotes_service/api/jsonp_v2.php/" +
      `var%20${callbackName}=/Market_Center.getHQNodeData` +
      `?page=${page}&num=100&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=page` +
      `&_=${Date.now()}`;
    script.onload = () => {
      const payload = jsonpWindow[callbackName];
      cleanup();
      if (!Array.isArray(payload)) {
        reject(new Error(`行情分页 ${page} 格式异常`));
        return;
      }
      resolve(payload.filter(isSinaRow).map(toSinaStock));
    };
    script.onerror = () => {
      cleanup();
      reject(new Error(`行情分页 ${page} 加载失败`));
    };
    document.head.appendChild(script);
  });
}

export async function fetchSinaMarketSnapshot(
  onProgress?: (loaded: number) => void
): Promise<SinaStock[]> {
  const all: SinaStock[] = [];
  const batchSize = 8;
  let page = 1;
  let done = false;

  while (!done && page <= 70) {
    const pages = Array.from({ length: batchSize }, (_, index) => page + index);
    const results = await Promise.all(
      pages.map(async (pageNumber) => {
        try {
          return { pageNumber, rows: await fetchSnapshotPage(pageNumber) };
        } catch (error) {
          if (pageNumber === 1) throw error;
          return { pageNumber, rows: [] as SinaStock[] };
        }
      })
    );
    results.sort((a, b) => a.pageNumber - b.pageNumber);
    for (const result of results) {
      all.push(...result.rows);
      if (result.rows.length < 100) {
        done = true;
        break;
      }
    }
    page += batchSize;
    onProgress?.(all.length);
  }

  const unique = new Map(all.map((stock) => [stock.code, stock]));
  if (unique.size < 1000) {
    throw new Error(`行情返回数量异常：${unique.size}`);
  }
  return [...unique.values()];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function enrichCandidate(candidate: Candidate, quote: SinaStock | undefined) {
  if (!quote || !quote.open || !quote.preClose) {
    return {
      ...candidate,
      liveEligible: false,
      liveReason: "未取得有效行情"
    };
  }
  const gap = quote.open / quote.preClose - 1;
  const gapStrength = gap / candidate.limit;
  const auctionRatio = quote.amount / Math.max(candidate.avg5Amount || 1, 1);
  const limitPrice =
    Math.round(quote.preClose * (1 + candidate.limit) * 100 + 0.00001) / 100;
  const oneWord = quote.open >= limitPrice - 0.005;
  const auctionQuality = clamp((auctionRatio - 0.006) / 0.03, 0, 1);
  const gapFit = 1 - clamp(Math.abs(gapStrength - 0.38) / 0.38, 0, 1);
  const sectorHeat =
    clamp(candidate.sectorStrongCount / 4, 0, 1) * 0.6 +
    clamp(candidate.sectorLimitCount / 3, 0, 1) * 0.4;
  const livePass =
    gapStrength >= 0.08 &&
    gapStrength <= 0.72 &&
    auctionRatio >= 0.006 &&
    !oneWord;
  const liveScore =
    candidate.modelScore * 0.58 +
    auctionQuality * 0.18 +
    gapFit * 0.14 +
    sectorHeat * 0.1 -
    candidate.riskPenalty;
  return {
    ...candidate,
    liveEligible: livePass,
    liveReason: livePass
      ? "通过竞价硬条件"
      : oneWord
        ? "接近一字板，失去可执行性"
        : gapStrength < 0.08
          ? "竞价高开强度不足"
          : gapStrength > 0.72
            ? "竞价过度接近涨停"
            : "竞价量能不足",
    live: {
      open: quote.open,
      preClose: quote.preClose,
      current: quote.current,
      gap,
      gapStrength,
      auctionAmount: quote.amount,
      auctionRatio,
      liveScore
    }
  };
}

export function scoreWithSnapshot(
  strategy: StrategyDashboard,
  snapshot: SinaStock[],
  now = new Date()
): LiveResult {
  const status = detectMarketStatus(now);
  const quoteMap = new Map(snapshot.map((stock) => [stock.code, stock]));
  const enriched = strategy.candidates.map((candidate) =>
    enrichCandidate(candidate, quoteMap.get(candidate.code))
  );
  const sorted = status.liveEligible
    ? enriched.sort(
        (a, b) =>
          Number(b.liveEligible) - Number(a.liveEligible) ||
          (b.live?.liveScore ?? 0) - (a.live?.liveScore ?? 0)
      )
    : enriched.sort((a, b) => a.rank - b.rank);
  const recommendation = status.liveEligible
    ? (sorted.find((candidate) => candidate.liveEligible) ?? null)
    : null;
  return {
    recommendation,
    noPickReason: status.liveEligible
      ? recommendation
        ? null
        : "没有候选同时通过高开强度、竞价量能和可执行性条件"
      : "当前不是集合竞价窗口，保留盘前模型首选",
    candidates: sorted,
    fetchedAt: new Date().toISOString(),
    quoteCount: snapshot.length,
    positiveOpenCount: snapshot.filter((stock) => stock.open > stock.preClose).length,
    mode: status.liveEligible ? "auction" : "off_hours",
    marketStatus: status
  };
}
