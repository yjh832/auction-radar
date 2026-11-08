import type {
  Candidate,
  DailyBar,
  DragonTigerRecord,
  DragonTigerSeatAnalysis,
  HoldingBenchmark,
  HoldingTechnicalProfile,
  IntradayPoint,
  IntradaySeries,
  LimitUpSeed,
  LiveResult,
  ReviewMaps,
  SectorAuctionPulse,
  StockDetailData,
  StockQuoteDetail,
  SeatRecord,
  StrategyDashboard
} from "../types";
import {
  buildReviewMaps,
  fetchLhbStocks,
  fetchLimitPools,
  scoreCandidateWithMaps
} from "./reviewMaps";

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

function enrichCandidate(
  candidate: Candidate,
  quote: SinaStock | undefined,
  auctionSector?: SectorAuctionPulse
) {
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
  const staticSectorHeat =
    clamp(candidate.sectorStrongCount / 4, 0, 1) * 0.6 +
    clamp(candidate.sectorLimitCount / 3, 0, 1) * 0.4;
  const sectorHeat = auctionSector
    ? auctionSector.score * 0.72 + staticSectorHeat * 0.28
    : staticSectorHeat;
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

function buildAuctionSectorPulses(
  candidates: Candidate[],
  snapshot: SinaStock[]
): SectorAuctionPulse[] {
  const quoteMap = new Map(snapshot.map((stock) => [stock.code, stock]));
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.industry) ?? [];
    group.push(candidate);
    groups.set(candidate.industry, group);
  }
  return [...groups.entries()]
    .map(([name, group]) => {
      const samples = group.flatMap((candidate) => {
        const quote = quoteMap.get(candidate.code);
        if (!quote?.preClose || !quote.open) return [];
        const gap = quote.open / quote.preClose - 1;
        return [{
          candidate,
          gap,
          gapStrength: gap / candidate.limit,
          auctionRatio: quote.amount / Math.max(candidate.avg5Amount || 1, 1),
          amount: quote.amount,
          positive: gap > 0
        }];
      });
      if (!samples.length) return null;
      const avgGap =
        samples.reduce((sum, item) => sum + item.gap, 0) / samples.length;
      const avgGapStrength =
        samples.reduce((sum, item) => sum + item.gapStrength, 0) / samples.length;
      const avgAuctionRatio =
        samples.reduce((sum, item) => sum + item.auctionRatio, 0) / samples.length;
      const positiveOpenCount = samples.filter((item) => item.positive).length;
      const positiveOpenRate = positiveOpenCount / samples.length;
      const totalAuctionAmount = samples.reduce((sum, item) => sum + item.amount, 0);
      const avgModelScore =
        samples.reduce((sum, item) => sum + item.candidate.modelScore, 0) /
        samples.length;
      const score = clamp(
        clamp(avgGapStrength / 0.5, 0, 1) * 0.28 +
          clamp(avgAuctionRatio / 0.05, 0, 1) * 0.34 +
          positiveOpenRate * 0.2 +
          clamp(samples.length / 3, 0, 1) * 0.1 +
          clamp(avgModelScore, 0, 1) * 0.08,
        0,
        1
      );
      return {
        name,
        candidateCount: samples.length,
        positiveOpenCount,
        avgGap,
        totalAuctionAmount,
        avgAuctionRatio,
        score,
        reason:
          `${samples.length}只候选平均${avgGap >= 0 ? "高开" : "低开"}` +
          `${(Math.abs(avgGap) * 100).toFixed(2)}%，` +
          `竞价红盘${positiveOpenCount}只，` +
          `竞价量额比${(avgAuctionRatio * 100).toFixed(2)}%。`
      };
    })
    .filter((item): item is SectorAuctionPulse => Boolean(item))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.positiveOpenCount - a.positiveOpenCount ||
        b.totalAuctionAmount - a.totalAuctionAmount
    );
}

export function scoreWithSnapshot(
  strategy: StrategyDashboard,
  snapshot: SinaStock[],
  now = new Date()
): LiveResult {
  const status = detectMarketStatus(now);
  const quoteMap = new Map(snapshot.map((stock) => [stock.code, stock]));
  const auctionUniverse = strategy.reviewUniverse?.length
    ? strategy.reviewUniverse
    : strategy.candidates;
  const sectorPulses = buildAuctionSectorPulses(auctionUniverse, snapshot);
  const sectorPulseMap = new Map(sectorPulses.map((item) => [item.name, item]));
  const enriched = strategy.candidates.map((candidate) =>
    enrichCandidate(
      candidate,
      quoteMap.get(candidate.code),
      sectorPulseMap.get(candidate.industry)
    )
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
    sectorPulses,
    strongestSector: sectorPulses[0] ?? null,
    mode: status.liveEligible ? "auction" : "off_hours",
    marketStatus: status
  };
}

export async function reviewWithSnapshot(
  strategy: StrategyDashboard,
  snapshot: SinaStock[],
  now = new Date()
): Promise<LiveResult> {
  const status = detectMarketStatus(now);
  const quoteMap = new Map(snapshot.map((stock) => [stock.code, stock]));
  const universe = strategy.reviewUniverse?.length
    ? strategy.reviewUniverse
    : strategy.candidates;
  const [pools, lhbStocks] = await Promise.all([
    fetchLimitPools(status.clock.date),
    fetchLhbStocks(status.clock.date)
  ]);
  const fallbackPreviousLimitUps: LimitUpSeed[] = strategy.reviewUniverse
    ?.filter((candidate) => candidate.limitToday)
    .map((candidate) => ({
      code: candidate.code,
      name: candidate.name,
      sector: candidate.industry,
      streak: candidate.limitStreak,
      close: candidate.close
    })) ?? [];
  const reviewMaps: ReviewMaps = buildReviewMaps({
    snapshot,
    pools,
    lhbStocks,
    previousLimitUps:
      strategy.reviewMaps?.date === status.clock.date
        ? strategy.reviewMaps.previousLimitUps
        : strategy.reviewMaps?.limitUps ?? fallbackPreviousLimitUps,
    previousDate: strategy.asOf,
    date: status.clock.date
  });
  const reviewed = universe
    .map((candidate) => {
      const quote = quoteMap.get(candidate.code);
      if (!quote || !quote.preClose) {
        return {
          ...candidate,
          reviewMetrics: null,
          reviewScore: -1
        };
      }
      const dayReturn = quote.current / quote.preClose - 1;
      const closePosition =
        quote.high > quote.low
          ? (quote.current - quote.low) / (quote.high - quote.low)
          : 0.5;
      const amountRatio = quote.amount / Math.max(candidate.avg5Amount || 1, 1);
      const turnoverQuality =
        1 -
        Math.min(1, Math.abs(quote.turnover - 12) / 24);
      const sectorHeat =
        clamp(candidate.sectorStrongCount / 5, 0, 1) * 0.55 +
        clamp(candidate.sectorLimitCount / 3, 0, 1) * 0.45;
      const baseSignal =
        (candidate.modelScore - candidate.riskPenalty) * 0.53 +
        closePosition * 0.2 +
        clamp((dayReturn + 0.03) / 0.13, 0, 1) * 0.15 +
        clamp(amountRatio / 0.18, 0, 1) * 0.15 +
        turnoverQuality * 0.05 +
        sectorHeat * 0.04;
      const mapped = scoreCandidateWithMaps(
        candidate,
        quote,
        reviewMaps,
        baseSignal
      );
      return {
        ...candidate,
        reviewScore: mapped.reviewScore,
        mapScores: mapped.mapScores,
        reviewTags: mapped.reviewTags,
        reviewMetrics: {
          dayReturn,
          closePosition,
          amountRatio,
          turnover: quote.turnover,
          current: quote.current,
          amount: quote.amount
        }
      };
    })
    .sort((a, b) => b.reviewScore - a.reviewScore);

  const selected = reviewed.slice(0, 6);
  return {
    recommendation: selected[0] ?? null,
    noPickReason: selected.length ? null : "复盘池暂无有效行情",
    candidates: selected,
    fetchedAt: new Date().toISOString(),
    quoteCount: snapshot.length,
    positiveOpenCount: snapshot.filter((stock) => stock.current > stock.preClose).length,
    reviewMaps,
    mode: "review",
    marketStatus: status
  };
}

function numberOrZero(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseTencentQuote(symbol: string, fields: string[]): StockQuoteDetail {
  if (fields.length < 50) throw new Error("实时行情字段不足");
  return {
    symbol,
    name: fields[1],
    price: numberOrZero(fields[3]),
    preClose: numberOrZero(fields[4]),
    open: numberOrZero(fields[5]),
    high: numberOrZero(fields[33]),
    low: numberOrZero(fields[34]),
    change: numberOrZero(fields[31]),
    changePct: numberOrZero(fields[32]),
    volumeLots: numberOrZero(fields[36]),
    amount: numberOrZero(fields[37]) * 10_000,
    turnoverRate: numberOrZero(fields[38]),
    amplitude: numberOrZero(fields[43]),
    marketCap: numberOrZero(fields[44]) * 100_000_000,
    floatCap: numberOrZero(fields[45]) * 100_000_000,
    volumeRatio: numberOrZero(fields[49]),
    updatedAt: fields[30] ?? ""
  };
}

export function holdingSymbolForCode(code: string) {
  return `${code.startsWith("6") ? "sh" : code.startsWith("8") || code.startsWith("4") ? "bj" : "sz"}${code}`;
}

export interface HoldingBenchmarkConfig {
  code: string;
  name: string;
  symbol: string;
}

export function benchmarkForCode(code: string): HoldingBenchmarkConfig {
  if (code.startsWith("30")) {
    return { code: "399006", name: "创业板指", symbol: "sz399006" };
  }
  if (code.startsWith("8") || code.startsWith("4")) {
    return { code: "899050", name: "北证50", symbol: "bj899050" };
  }
  if (code.startsWith("6")) {
    return { code: "000001", name: "上证指数", symbol: "sh000001" };
  }
  return { code: "399001", name: "深证成指", symbol: "sz399001" };
}

async function fetchTencentQuotesBySymbol(
  symbols: string[]
): Promise<Map<string, StockQuoteDetail>> {
  if (!symbols.length) return new Map();
  const response = await fetch(`https://qt.gtimg.cn/q=${symbols.join(",")}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`实时行情请求失败：${response.status}`);
  }
  const text = new TextDecoder("gb18030").decode(await response.arrayBuffer());
  const result = new Map<string, StockQuoteDetail>();
  for (const match of text.matchAll(/v_([a-z]{2}\d{6})="([^"]*)"/g)) {
    const symbol = match[1];
    const fields = match[2].split("~");
    if (fields.length < 50) continue;
    result.set(symbol, parseTencentQuote(symbol, fields));
  }
  return result;
}

export async function fetchHoldingQuotes(
  codes: string[]
): Promise<Map<string, StockQuoteDetail>> {
  const symbols = [...new Set(codes.map(holdingSymbolForCode))];
  const bySymbol = await fetchTencentQuotesBySymbol(symbols);
  const result = new Map<string, StockQuoteDetail>();
  for (const symbol of symbols) {
    const quote = bySymbol.get(symbol);
    if (quote) result.set(quote.symbol.slice(2), quote);
  }
  return result;
}

async function fetchTencentQuote(symbol: string): Promise<StockQuoteDetail> {
  const response = await fetch(
    `https://qt.gtimg.cn/q=${encodeURIComponent(symbol)}`,
    { cache: "no-store" }
  );
  if (!response.ok) {
    throw new Error(`实时行情请求失败：${response.status}`);
  }
  const text = new TextDecoder("gb18030").decode(await response.arrayBuffer());
  const match = text.match(/="([^"]*)"/);
  if (!match) throw new Error("实时行情格式异常");
  return parseTencentQuote(symbol, match[1].split("~"));
}

async function fetchTencentKline(
  symbol: string,
  adjusted = true
): Promise<DailyBar[]> {
  const adjustment = adjusted ? "qfq" : "";
  const url =
    "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?" +
    `param=${encodeURIComponent(`${symbol},day,,,65,${adjustment}`)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`K线请求失败：${response.status}`);
  const payload = (await response.json()) as {
    data?: Record<
      string,
      { qfqday?: Array<Array<string | number>>; day?: Array<Array<string | number>> }
    >;
  };
  const rows = adjusted
    ? payload.data?.[symbol]?.qfqday ?? payload.data?.[symbol]?.day ?? []
    : payload.data?.[symbol]?.day ?? payload.data?.[symbol]?.qfqday ?? [];
  const parsed = rows.map((row) => ({
    date: String(row[0]),
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[3]),
    low: Number(row[4]),
    volume: Number(row[5])
  }));
  const withMa = parsed.map((bar, index) => {
    const preClose = index > 0 ? parsed[index - 1].close : bar.open;
    if (index < 4) return { ...bar, preClose, ma5: null };
    const sample = parsed.slice(index - 4, index + 1);
    return {
      ...bar,
      preClose,
      ma5: sample.reduce((sum, item) => sum + item.close, 0) / sample.length
    };
  });
  return withMa;
}

export async function fetchHoldingTechnical(
  code: string
): Promise<HoldingTechnicalProfile> {
  const symbol = holdingSymbolForCode(code);
  const [bars, rawBars] = await Promise.all([
    fetchTencentKline(symbol, true),
    fetchTencentKline(symbol, false)
  ]);
  if (bars.length < 5) throw new Error("技术数据不足");
  const last20 = bars.slice(-20);
  const ma5Sample = bars.slice(-5);
  return {
    ma5:
      ma5Sample.reduce((sum, bar) => sum + bar.close, 0) /
      Math.max(ma5Sample.length, 1),
    ma20:
      last20.reduce((sum, bar) => sum + bar.close, 0) /
      Math.max(last20.length, 1),
    high20: Math.max(...last20.map((bar) => bar.high)),
    low20: Math.min(...last20.map((bar) => bar.low)),
    ret5:
      bars.length >= 6
        ? bars.at(-1)!.close / bars.at(-6)!.close - 1
        : 0,
    ret10:
      bars.length >= 11
        ? bars.at(-1)!.close / bars.at(-11)!.close - 1
        : 0,
    ret30:
      bars.length >= 31
        ? bars.at(-1)!.close / bars.at(-31)!.close - 1
        : 0,
    history: rawBars.slice(-40).map((bar) => ({
      date: bar.date,
      close: bar.close
    }))
  };
}

export async function fetchHoldingBenchmark(
  code: string
): Promise<HoldingBenchmark> {
  const benchmark = benchmarkForCode(code);
  const [quote, bars] = await Promise.all([
    fetchTencentQuote(benchmark.symbol),
    fetchTencentKline(benchmark.symbol, false)
  ]);
  return {
    ...benchmark,
    quote,
    history: bars.slice(-40).map((bar) => ({
      date: bar.date,
      close: bar.close
    }))
  };
}

const intradayFileCache = new Map<
  string,
  Record<string, IntradaySeries>
>();

function parseTencentIntradayLines(
  lines: string[],
  date: string,
  preClose: number
): IntradaySeries {
  let previousVolume = 0;
  let previousAmount = 0;
  let cumulativeVolume = 0;
  let cumulativeAmount = 0;
  const points: IntradayPoint[] = lines.flatMap((line) => {
    const [time, priceText, volumeText, amountText] = line.split(" ");
    if (!time || !priceText) return [];
    cumulativeVolume = numberOrZero(volumeText);
    cumulativeAmount = numberOrZero(amountText);
    const volume = Math.max(0, cumulativeVolume - previousVolume);
    previousVolume = cumulativeVolume;
    previousAmount = cumulativeAmount;
    return [{
      time: `${time.slice(0, 2)}:${time.slice(2, 4)}`,
      price: Number(priceText),
      avgPrice:
        cumulativeVolume > 0
          ? cumulativeAmount / (cumulativeVolume * 100)
          : Number(priceText),
      volume
    }];
  });
  const prices = points.map((point) => point.price);
  return {
    date,
    preClose,
    open: prices[0] ?? 0,
    close: prices.at(-1) ?? 0,
    high: prices.length ? Math.max(...prices) : 0,
    low: prices.length ? Math.min(...prices) : 0,
    amount: Math.max(previousAmount, cumulativeAmount),
    volume: Math.max(previousVolume, cumulativeVolume),
    points
  };
}

export async function fetchIntradayData(
  candidate: Candidate,
  date: string,
  preClose: number
): Promise<IntradaySeries> {
  if (!intradayFileCache.has(candidate.code)) {
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}intraday/${candidate.code}.json`,
        { cache: "no-store" }
      );
      if (response.ok) {
        intradayFileCache.set(
          candidate.code,
          (await response.json()) as Record<string, IntradaySeries>
        );
      } else {
        intradayFileCache.set(candidate.code, {});
      }
    } catch {
      intradayFileCache.set(candidate.code, {});
    }
  }
  const bundled = intradayFileCache.get(candidate.code)?.[date];
  if (bundled?.points?.length) {
    return {
      ...bundled,
      preClose,
      points: bundled.points.map((point) => {
        if (!Array.isArray(point)) return point;
        const values = point as unknown[];
        return {
          time: String(values[0] ?? ""),
          price: Number(values[1] ?? 0),
          avgPrice: Number(values[2] ?? values[1] ?? 0),
          volume: Number(values[3] ?? 0)
        };
      })
    };
  }

  const compactDate = date.replaceAll("-", "");
  const response = await fetch(
    "https://web.ifzq.gtimg.cn/appstock/app/day/query?" +
      `code=${encodeURIComponent(candidate.symbol)}`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error(`分时请求失败：${response.status}`);
  const payload = (await response.json()) as {
    data?: Record<
      string,
      { data?: Array<{ date?: string; data?: string[] }> }
    >;
  };
  const day = payload.data?.[candidate.symbol]?.data?.find(
    (item) => item.date === compactDate
  );
  if (!day?.data?.length) {
    throw new Error(`${date} 的历史分时暂不可用`);
  }
  return parseTencentIntradayLines(day.data, date, preClose);
}

async function fetchDragonTiger(code: string): Promise<DragonTigerRecord[]> {
  const params = new URLSearchParams({
    reportName: "RPT_DAILYBILLBOARD_DETAILSNEW",
    columns: "ALL",
    filter: `(SECURITY_CODE="${code}")`,
    pageNumber: "1",
    pageSize: "8",
    sortColumns: "TRADE_DATE",
    sortTypes: "-1",
    source: "WEB",
    client: "WEB"
  });
  const response = await fetch(
    `https://datacenter-web.eastmoney.com/api/data/v1/get?${params}`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error(`龙虎榜请求失败：${response.status}`);
  const payload = (await response.json()) as {
    result?: { data?: Array<Record<string, unknown>> } | null;
  };
  return (payload.result?.data ?? []).map((item) => ({
    date: String(item.TRADE_DATE ?? "").slice(0, 10),
    reason: String(item.EXPLANATION ?? "龙虎榜"),
    note: String(item.EXPLAIN ?? ""),
    changePct: numberOrZero(item.CHANGE_RATE),
    turnoverRate: numberOrZero(item.TURNOVERRATE),
    buyAmount: numberOrZero(item.BILLBOARD_BUY_AMT),
    sellAmount: numberOrZero(item.BILLBOARD_SELL_AMT),
    netAmount: numberOrZero(item.BILLBOARD_NET_AMT),
    boardAmount: numberOrZero(item.BILLBOARD_DEAL_AMT),
    boardAmountRatio: numberOrZero(item.DEAL_AMOUNT_RATIO),
    after1d: nullableNumber(item.D1_CLOSE_ADJCHRATE),
    after5d: nullableNumber(item.D5_CLOSE_ADJCHRATE)
    ,
    changeType: String(item.CHANGE_TYPE ?? "")
  }));
}

function seatProfile(name: string): SeatRecord["profile"] {
  if (name.includes("机构专用")) {
    return {
      style: "institution",
      label: "机构专用",
      habit: "偏趋势与组合配置，单日爆量后不一定连续加速",
      followBias: 64
    };
  }
  if (name.includes("沪股通") || name.includes("深股通")) {
    return {
      style: "northbound",
      label: "北向资金",
      habit: "偏大市值和基本面，短线连板跟随度通常弱于游资",
      followBias: 56
    };
  }
  if (name.includes("东方财富") && /拉萨|东环路/.test(name)) {
    return {
      style: "quant",
      label: "高频活跃席位",
      habit: "成交活跃、换手高，次日波动大但持续性不稳定",
      followBias: 44
    };
  }
  if (
    (name.includes("开源证券") && name.includes("西安西大街")) ||
    (name.includes("华鑫证券") && /上海分公司|瑞平路/.test(name)) ||
    (name.includes("国泰海通") && /南京太平南路|江苏路/.test(name)) ||
    (name.includes("中信证券") && /上海分公司|西安朱雀大街|北京北三环中路/.test(name)) ||
    (name.includes("银河证券") && name.includes("绍兴")) ||
    (name.includes("国盛证券") && name.includes("宁波桑田路")) ||
    (name.includes("财通证券") && name.includes("杭州上塘路")) ||
    (name.includes("华泰证券") && name.includes("深圳益田路"))
  ) {
    return {
      style: "hot_money",
      label: "游资常用席位",
      habit: "擅长情绪龙头和强势股接力，关注次日竞价与板块延续",
      followBias: 76
    };
  }
  if (
    name.includes("摩根大通") ||
    name.includes("瑞银证券") ||
    name.includes("高盛")
  ) {
    return {
      style: "northbound",
      label: "外资/机构通道",
      habit: "偏组合与中期定价，短线情绪接力属性较弱",
      followBias: 55
    };
  }
  return {
    style: "general",
    label: "普通营业部",
    habit: "最终账户身份无法确认，需要结合金额、连续性和盘面判断",
    followBias: 48
  };
}

function mapSeat(
  item: Record<string, unknown>,
  side: "buy" | "sell"
): SeatRecord {
  const name = String(item.OPERATEDEPT_NAME ?? "未知席位");
  const buyAmount = numberOrZero(item.BUY);
  const sellAmount = numberOrZero(item.SELL);
  return {
    name,
    side,
    buyAmount,
    sellAmount,
    netAmount: numberOrZero(item.NET),
    activity3d: numberOrZero(item.TOTAL_BUYER_SALESTIMES_3DAY),
    riseProbability3d: nullableNumber(item.RISE_PROBABILITY_3DAY),
    amountRatio:
      side === "buy"
        ? nullableNumber(item.TOTAL_BUYRIO)
        : nullableNumber(item.TOTAL_SELLRIO),
    profile: seatProfile(name)
  };
}

export async function fetchDragonTigerSeats(
  code: string,
  date: string,
  changeType: string
): Promise<DragonTigerSeatAnalysis> {
  const common = {
    columns: "ALL",
    filter: `(SECURITY_CODE="${code}")(TRADE_DATE='${date}')(CHANGE_TYPE="${changeType}")`,
    pageNumber: "1",
    pageSize: "20",
    source: "WEB",
    client: "WEB"
  };
  const buildUrl = (reportName: string, sortColumn: string) =>
    `https://datacenter-web.eastmoney.com/api/data/v1/get?${new URLSearchParams({
      ...common,
      reportName,
      sortColumns: sortColumn,
      sortTypes: "-1"
    })}`;
  const [buyResponse, sellResponse] = await Promise.all([
    fetch(buildUrl("RPT_BILLBOARD_DAILYDETAILSBUY", "BUY"), {
      cache: "no-store"
    }),
    fetch(buildUrl("RPT_BILLBOARD_DAILYDETAILSSELL", "SELL"), {
      cache: "no-store"
    })
  ]);
  if (!buyResponse.ok || !sellResponse.ok) {
    throw new Error("龙虎榜买卖席位加载失败");
  }
  const [buyPayload, sellPayload] = (await Promise.all([
    buyResponse.json(),
    sellResponse.json()
  ])) as Array<{
    result?: { data?: Array<Record<string, unknown>> } | null;
  }>;
  const buyers = (buyPayload.result?.data ?? []).slice(0, 5).map((item) => mapSeat(item, "buy"));
  const sellers = (sellPayload.result?.data ?? []).slice(0, 5).map((item) => mapSeat(item, "sell"));
  const buyTotal = buyers.reduce((sum, item) => sum + item.buyAmount, 0);
  const sellTotal = sellers.reduce((sum, item) => sum + item.sellAmount, 0);
  const netAmount = buyTotal - sellTotal;
  const dayAmount = numberOrZero(
    buyPayload.result?.data?.[0]?.ACCUM_AMOUNT ??
      sellPayload.result?.data?.[0]?.ACCUM_AMOUNT
  );
  const netRatio = dayAmount ? netAmount / dayAmount : 0;
  const buyConcentration = buyTotal
    ? Math.max(...buyers.map((item) => item.buyAmount), 0) / buyTotal
    : 0;
  const buyerQuality = buyers.length
    ? buyers.reduce((sum, item) => sum + item.profile.followBias, 0) / buyers.length
    : 0;
  const sellerPressure = sellers.length
    ? sellers.reduce((sum, item) => sum + item.profile.followBias, 0) / sellers.length
    : 0;
  const seatScore = Math.max(
    0,
    Math.min(
      100,
      50 +
        netRatio * 180 +
        (buyerQuality - 50) * 0.45 -
        (sellerPressure - 50) * 0.25 +
        (buyConcentration - 0.25) * 20
    )
  );
  const strongBuyers = buyers.filter(
    (item) => item.profile.style === "hot_money" || item.profile.style === "institution"
  ).length;
  const strongSellers = sellers.filter(
    (item) => item.profile.style === "hot_money" || item.profile.style === "institution"
  ).length;

  let verdict: DragonTigerSeatAnalysis["verdict"] = "观察";
  if (seatScore >= 68 && netAmount > 0 && strongBuyers >= 2) verdict = "跟随";
  else if (seatScore >= 56 && netAmount > 0) verdict = "谨慎跟随";
  else if (netAmount < 0 || strongSellers >= 3) verdict = "回避";

  const reasons = [
    netAmount >= 0
      ? `前五买方净流入${moneyText(netAmount)}`
      : `前五买卖合计净流出${moneyText(Math.abs(netAmount))}`,
    `买入集中度${(buyConcentration * 100).toFixed(1)}%`,
    `买方强席位${strongBuyers}家，卖方强席位${strongSellers}家`
  ];
  const risks = [
    "营业部是交易单元，无法确认最终操盘账户",
    ...(strongSellers >= 2 ? ["卖方存在较强同位资金，次日抛压需要观察"] : []),
    ...(netRatio > 0.12 ? ["席位净买入占成交额偏高，也要防止拥挤兑现"] : [])
  ];
  const nextDayAction =
    verdict === "跟随"
      ? "空仓不追高：竞价温和高开且9:35不破开盘时再考虑；已有仓位跌破开盘价或均价线则减仓"
      : verdict === "谨慎跟随"
        ? "空仓仅看回踩承接：弱开或冲高回落不买；已有仓位冲高不封板时减仓"
        : verdict === "回避"
          ? "次日优先减仓或不参与；低开并跌破分时均价时退出"
          : "等待次日竞价确认，不在榜单公布后盲目追入";

  return {
    date,
    buyTotal,
    sellTotal,
    netAmount,
    netRatio,
    buyConcentration,
    seatScore,
    verdict,
    nextDayAction,
    reasons,
    risks,
    buyers,
    sellers
  };
}

function moneyText(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(0)}万`;
  return value.toFixed(0);
}

export async function fetchStockDetail(
  candidate: Candidate
): Promise<StockDetailData> {
  const [quote, analysisKline, dragonTiger] = await Promise.all([
    fetchTencentQuote(candidate.symbol),
    fetchTencentKline(candidate.symbol, false),
    fetchDragonTiger(candidate.code)
  ]);
  return {
    quote,
    kline: analysisKline.slice(-30),
    analysisKline,
    dragonTiger
  };
}
