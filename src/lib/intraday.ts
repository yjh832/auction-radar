import type {
  Candidate,
  IntradayFlowStock,
  IntradayMarketRadar,
  IntradaySectorPulse,
  StockQuoteDetail,
  StrategyDashboard
} from "../types";
import { filterMainBoard } from "./universe";
import { analyzeRecentPosition } from "./recentPosition";

interface EastmoneyListPayload {
  data?: {
    diff?: Array<Record<string, number | string>>;
  };
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stockSymbol(code: string) {
  return `${code.startsWith("6") ? "sh" : "sz"}${code}`;
}

function normalizedSector(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/[ⅡⅢ]/g, "")
    .replace(/行业|板块/g, "")
    .replace(/零部件/g, "零部");
}

function matchSector(
  industry: string,
  sectors: IntradaySectorPulse[]
) {
  const target = normalizedSector(industry);
  if (!target) return null;
  return (
    sectors.find((sector) => normalizedSector(sector.name) === target) ??
    sectors.find((sector) => {
      const name = normalizedSector(sector.name);
      return name.includes(target) || target.includes(name);
    }) ??
    null
  );
}

async function fetchEastmoneyRows(url: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`盘中资金数据请求失败：${response.status}`);
      }
      const payload = (await response.json()) as EastmoneyListPayload;
      const rows = payload.data?.diff ?? [];
      if (rows.length) return rows;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) {
      await new Promise((resolve) =>
        setTimeout(resolve, 350 * (attempt + 1))
      );
    }
  }
  throw lastError ?? new Error("盘中资金数据为空");
}

export async function fetchIntradayMarketRadar(): Promise<IntradayMarketRadar> {
  const sectorParams = new URLSearchParams({
    pn: "1",
    pz: "60",
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fid: "f62",
    fs: "m:90+t:2",
    fields: "f12,f14,f2,f3,f62,f184"
  });
  const stockParams = new URLSearchParams({
    pn: "1",
    pz: "100",
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fid: "f62",
    fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
    fields: "f12,f14,f2,f3,f6,f8,f10,f62,f184,f100"
  });
  const [sectorResult, stockResult] = await Promise.allSettled([
    fetchEastmoneyRows(
      `https://push2.eastmoney.com/api/qt/clist/get?${sectorParams}`
    ),
    fetchEastmoneyRows(
      `https://push2.eastmoney.com/api/qt/clist/get?${stockParams}`
    )
  ]);
  let sectors = (
    sectorResult.status === "fulfilled" ? sectorResult.value : []
  )
    .map((row, index): IntradaySectorPulse | null => {
      const name = String(row.f14 ?? "").trim();
      const changePct = numeric(row.f3);
      const mainNetInflow = numeric(row.f62);
      const mainNetRatio = numeric(row.f184);
      if (!name) return null;
      const rank = index + 1;
      const score = clamp(
        48 +
          clamp(changePct, -5, 8) * 4.2 +
          clamp(mainNetRatio, -10, 20) * 1.45 +
          Math.max(0, 12 - rank) * 0.7
      );
      return {
        code: String(row.f12 ?? ""),
        name,
        changePct,
        mainNetInflow,
        mainNetRatio,
        rank,
        score,
        reason:
          `${name}${changePct >= 0 ? "上涨" : "下跌"}${Math.abs(changePct).toFixed(2)}%，` +
          `主力净流入${(mainNetInflow / 100_000_000).toFixed(2)}亿，` +
          `净流入占成交${mainNetRatio.toFixed(1)}%。`
      };
    })
    .filter((item): item is IntradaySectorPulse => Boolean(item))
    .sort((a, b) => b.score - a.score);

  const stocks = (
    stockResult.status === "fulfilled" ? stockResult.value : []
  )
    .map((row, index): IntradayFlowStock | null => {
      const code = String(row.f12 ?? "");
      const name = String(row.f14 ?? "").trim();
      if (!code || !name || /ST/i.test(name)) return null;
      return {
        code,
        name,
        industry: String(row.f100 ?? "盘中异动"),
        price: numeric(row.f2),
        changePct: numeric(row.f3),
        amount: numeric(row.f6),
        turnoverRate: numeric(row.f8),
        volumeRatio: numeric(row.f10),
        mainNetInflow: numeric(row.f62),
        mainNetRatio: numeric(row.f184),
        rank: index + 1
      };
    })
    .filter((item): item is IntradayFlowStock => Boolean(item));
  if (!sectors.length && stocks.length) {
    const groups = new Map<string, IntradayFlowStock[]>();
    for (const stock of stocks) {
      const group = groups.get(stock.industry) ?? [];
      group.push(stock);
      groups.set(stock.industry, group);
    }
    sectors = [...groups.entries()]
      .map(([name, group], index): IntradaySectorPulse => {
        const totalAmount = group.reduce((sum, item) => sum + item.amount, 0);
        const mainNetInflow = group.reduce(
          (sum, item) => sum + item.mainNetInflow,
          0
        );
        const weightedChange =
          group.reduce(
            (sum, item) => sum + item.changePct * Math.max(item.amount, 1),
            0
          ) / Math.max(totalAmount, 1);
        const mainNetRatio =
          totalAmount > 0 ? (mainNetInflow / totalAmount) * 100 : 0;
        const rank = index + 1;
        const score = clamp(
          48 +
            clamp(weightedChange, -5, 8) * 4.2 +
            clamp(mainNetRatio, -10, 20) * 1.45 +
            Math.max(0, 12 - rank) * 0.7
        );
        return {
          code: `FLOW-${index + 1}`,
          name,
          changePct: weightedChange,
          mainNetInflow,
          mainNetRatio,
          rank,
          score,
          reason:
            `${name}由个股资金榜聚合，个股资金加权涨幅${weightedChange.toFixed(2)}%，` +
            `合计主力净流入${(mainNetInflow / 100_000_000).toFixed(2)}亿。`
        };
      })
      .sort((a, b) => b.score - a.score)
      .map((sector, index) => ({ ...sector, rank: index + 1 }));
  }
  const leadingSector = sectors[0] ?? null;
  return {
    fetchedAt: new Date().toISOString(),
    sectors,
    stocks,
    leadingSector,
    summary: leadingSector
      ? `${leadingSector.name}为当前资金与涨幅共振最强板块，主力净流入${(leadingSector.mainNetInflow / 100_000_000).toFixed(2)}亿。`
      : "板块与个股资金榜暂不可用，已切换为分时均价、成交额节奏和板块红盘率的量价代理。"
  };
}

export function ensureIntradaySectors(
  candidates: Candidate[],
  quotes: Map<string, StockQuoteDetail>,
  radar: IntradayMarketRadar
) {
  if (radar.sectors.length) return radar;
  const groups = new Map<
    string,
    Array<{ candidate: Candidate; quote: StockQuoteDetail }>
  >();
  for (const candidate of candidates) {
    const quote = quotes.get(candidate.symbol);
    if (!quote?.preClose || quote.price <= 0) continue;
    const group = groups.get(candidate.industry) ?? [];
    group.push({ candidate, quote });
    groups.set(candidate.industry, group);
  }
  const sectors = [...groups.entries()]
    .map(([name, group], index): IntradaySectorPulse => {
      const totalAmount = group.reduce(
        (sum, item) => sum + item.quote.amount,
        0
      );
      const changePct =
        group.reduce(
          (sum, item) =>
            sum +
            (item.quote.price / item.quote.preClose - 1) *
              100 *
              Math.max(item.quote.amount, 1),
          0
        ) / Math.max(totalAmount, 1);
      const positiveRate =
        group.filter((item) => item.quote.price > item.quote.preClose).length /
        group.length;
      const score = clamp(
        42 +
          clamp(changePct, -5, 8) * 4.5 +
          positiveRate * 24 +
          Math.max(0, 10 - index) * 0.6
      );
      return {
        code: `LOCAL-${index + 1}`,
        name,
        changePct,
        mainNetInflow: 0,
        mainNetRatio: 0,
        rank: index + 1,
        score,
        reason:
          `${name}使用实时量价代理：成交额加权涨幅${changePct.toFixed(2)}%，` +
          `板块红盘率${(positiveRate * 100).toFixed(0)}%。`
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((sector, index) => ({ ...sector, rank: index + 1 }));
  return {
    ...radar,
    sectors,
    leadingSector: sectors[0] ?? null,
    summary: sectors.length
      ? `${sectors[0].name}为实时量价代理最强板块；资金榜暂不可用，未使用虚构主力净流入。`
      : radar.summary
  };
}

function newIntradayCandidate(
  stock: IntradayFlowStock,
  quote: StockQuoteDetail
): Candidate {
  const closePosition =
    quote.high > quote.low
      ? (quote.price - quote.low) / (quote.high - quote.low)
      : 0.5;
  const estimatedAverageAmount =
    quote.amount / Math.max(stock.volumeRatio || 1, 0.5);
  return {
    rank: 999,
    modelRank: 999,
    code: stock.code,
    symbol: quote.symbol,
    name: stock.name,
    industry: stock.industry,
    modelScore: 0.55,
    compositeScore: 0.55,
    close: quote.price,
    dayRet: quote.preClose > 0 ? quote.price / quote.preClose - 1 : 0,
    gap: quote.preClose > 0 ? quote.open / quote.preClose - 1 : 0,
    limit: 0.1,
    limitToday: false,
    limit20: 0,
    limit60: 0,
    limitStreak: 0,
    volRatio: stock.volumeRatio,
    ret5: 0,
    ret10: 0,
    closePos: closePosition,
    nearHigh20: 0,
    turnoverEst: stock.turnoverRate || quote.turnoverRate,
    amountEst: quote.amount,
    avg5Amount: estimatedAverageAmount,
    sectorN: 0,
    sectorLimitCount: 0,
    sectorStrongCount: 0,
    floatCap: quote.floatCap,
    riskLevel: "medium",
    riskPenalty: 0.04,
    riskNotes: ["盘中实时资金挖掘标的，需等待量价持续确认"],
    history: [],
    lastAuction: {
      price: quote.open,
      amount: 0,
      ratio: 0,
      first5Ret: 0
    }
  };
}

export function buildIntradayUniverse(
  strategy: StrategyDashboard,
  radar: IntradayMarketRadar,
  quotes: Map<string, StockQuoteDetail>
) {
  const byCode = new Map<string, Candidate>();
  const base = filterMainBoard([
    ...(strategy.reviewUniverse ?? []),
    ...strategy.candidates
  ]);
  for (const candidate of base) byCode.set(candidate.code, candidate);

  const discovered = filterMainBoard(
    radar.stocks
      .filter(
        (stock) =>
          stock.price >= 2 &&
          stock.amount >= 100_000_000 &&
          stock.mainNetInflow > 0
      )
      .slice(0, 50)
      .map((stock) => ({ code: stock.code }))
  );
  for (const stock of radar.stocks) {
    if (!discovered.some((item) => item.code === stock.code)) continue;
    if (byCode.has(stock.code)) continue;
    const quote = quotes.get(stockSymbol(stock.code));
    if (!quote?.preClose || quote.price <= 0) continue;
    byCode.set(stock.code, newIntradayCandidate(stock, quote));
  }
  return [...byCode.values()]
    .filter((candidate) => quotes.has(candidate.symbol))
    .slice(0, 90);
}

export function requestedIntradaySymbols(
  strategy: StrategyDashboard,
  radar: IntradayMarketRadar
) {
  const symbols = new Set<string>();
  for (const candidate of filterMainBoard([
    ...(strategy.reviewUniverse ?? []),
    ...strategy.candidates
  ])) {
    if (candidate.symbol) symbols.add(candidate.symbol);
  }
  for (const stock of filterMainBoard(
    radar.stocks
      .filter(
        (item) =>
          item.price >= 2 &&
          item.amount >= 100_000_000 &&
          item.mainNetInflow > 0
      )
      .slice(0, 50)
  )) {
    symbols.add(stockSymbol(stock.code));
  }
  return [...symbols];
}

function chinaSessionMinutes(now: Date) {
  const part = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    })
      .formatToParts(now)
      .filter((item) => item.type !== "literal")
      .map((item) => [item.type, item.value])
  );
  return Number(part.hour) * 60 + Number(part.minute);
}

function sessionFraction(now: Date) {
  const minutes = chinaSessionMinutes(now);
  if (minutes >= 11 * 60 + 30) {
    if (minutes < 13 * 60) return 0.5;
    return clamp(0.5 + (minutes - 13 * 60) / 240, 0.5, 1);
  }
  return clamp((minutes - 9 * 60 - 30) / 240, 0.04, 0.5);
}

export function scoreIntradayCandidates(
  candidates: Candidate[],
  radar: IntradayMarketRadar,
  quotes: Map<string, StockQuoteDetail>,
  now = new Date()
) {
  const flowByCode = new Map(radar.stocks.map((stock) => [stock.code, stock]));
  const fraction = sessionFraction(now);
  const openingConfirmed = chinaSessionMinutes(now) >= 9 * 60 + 35;
  return candidates
    .flatMap((candidate) => {
      const quote = quotes.get(candidate.symbol);
      if (!quote || quote.preClose <= 0 || quote.price <= 0) return [];
      const flow = flowByCode.get(candidate.code);
      const sector = matchSector(candidate.industry, radar.sectors);
      const dayReturn = quote.price / quote.preClose - 1;
      const closePosition =
        quote.high > quote.low
          ? (quote.price - quote.low) / (quote.high - quote.low)
          : 0.5;
      const vwap =
        quote.volumeLots > 0
          ? quote.amount / (quote.volumeLots * 100)
          : quote.open || quote.price;
      const priceVsVwap = vwap > 0 ? quote.price / vwap - 1 : 0;
      const volumeRatio = flow?.volumeRatio || quote.volumeRatio;
      const turnover = flow?.turnoverRate || quote.turnoverRate;
      const averageAmount =
        candidate.avg5Amount ||
        quote.amount / Math.max(volumeRatio || 1, 0.5);
      const amountPace =
        averageAmount > 0
          ? quote.amount / averageAmount / Math.max(fraction, 0.04)
          : 1;
      const sectorScore = sector?.score ?? 45;
      const capitalProxy = clamp(
        45 +
          clamp(priceVsVwap / 0.012, -1, 1) * 18 +
          clamp(amountPace - 1, -1, 2) * 12 +
          clamp(dayReturn / 0.05, -1, 1) * 10
      );
      const capitalScore = flow
        ? clamp(
            45 +
              clamp(flow.mainNetRatio, -10, 25) * 2.2 +
              Math.max(0, 12 - flow.rank) * 0.9
          )
        : capitalProxy;
      const volumeScore = clamp(
        clamp(volumeRatio / 2.5, 0, 1) * 52 +
          clamp(amountPace / 1.8, 0, 1) * 30 +
          (1 - Math.min(1, Math.abs(turnover - 10) / 20)) * 18
      );
      const priceVolumeScore = clamp(
        50 +
          clamp(dayReturn / 0.06, -1, 1) * 19 +
          clamp(priceVsVwap / 0.012, -1, 1) * 16 +
          (closePosition - 0.5) * 24
      );
      const modelScore = clamp(candidate.modelScore * 100);
      let penalty = 0;
      if (candidate.riskLevel === "high") penalty += 18;
      if (candidate.anomaly?.regulatoryStatus === "abnormal") penalty += 26;
      else if (candidate.anomaly?.regulatoryStatus === "watch") penalty += 8;
      if (candidate.recentPosition?.status === "high") penalty += 7;
      if (dayReturn > 0.08) penalty += 16;
      if (dayReturn < 0) penalty += 10;
      const score = clamp(
        sectorScore * 0.25 +
          capitalScore * 0.25 +
          volumeScore * 0.2 +
          priceVolumeScore * 0.2 +
          modelScore * 0.1 -
          penalty
      );
      const nearLimit = dayReturn >= candidate.limit * 0.88;
      const eligible =
        openingConfirmed &&
        score >= 65 &&
        dayReturn > 0 &&
        !nearLimit &&
        priceVsVwap >= -0.002 &&
        closePosition >= 0.54 &&
        volumeRatio >= 1.05 &&
        sectorScore >= 50 &&
        capitalScore >= 52 &&
        candidate.riskLevel !== "high" &&
        candidate.anomaly?.regulatoryStatus !== "abnormal";
      const action =
        eligible && score >= 76 && priceVsVwap >= 0.003
          ? "watch_buy"
          : eligible
            ? "light_position"
            : "wait";
      const actionLabel =
        !openingConfirmed
          ? "9:35前只观察，不执行"
          : action === "watch_buy"
          ? "回踩分时均价不破可关注"
          : action === "light_position"
            ? "轻仓观察，等待二次放量"
            : "暂不追，等待板块与量价共振";
      const reasons = [
        sector?.reason ?? "板块资金脉冲待确认",
        flow
          ? `个股主力净流入${(flow.mainNetInflow / 100_000_000).toFixed(2)}亿，占成交${flow.mainNetRatio.toFixed(1)}%`
          : "主力资金榜暂缺，使用分时均价与成交额节奏代理资金强度",
        `量比${volumeRatio.toFixed(2)}，成交额节奏${amountPace.toFixed(2)}倍`,
        `现价${priceVsVwap >= 0 ? "高于" : "低于"}分时均价${Math.abs(priceVsVwap * 100).toFixed(2)}%`
      ];
      const risks = [
        nearLimit ? "已接近涨停，盘中可执行空间有限" : null,
        dayReturn > 0.07 ? "短线涨幅偏大，谨防冲高回落" : null,
        closePosition < 0.55 ? "价格位于日内区间下半区，承接不足" : null,
        candidate.anomaly?.regulatoryStatus === "watch"
          ? "接近公开异动观察阈值"
          : null
      ].filter((item): item is string => Boolean(item));
      const intraday = {
        score,
        sectorScore,
        capitalScore,
        volumeScore,
        priceVolumeScore,
        modelScore,
        mainNetInflow: flow?.mainNetInflow ?? 0,
        mainNetRatio: flow?.mainNetRatio ?? 0,
        flowRank: flow?.rank ?? null,
        sectorName: sector?.name ?? candidate.industry,
        sectorChangePct: sector?.changePct ?? 0,
        sectorRank: sector?.rank ?? null,
        vwap,
        amountPace,
        volumeRatio,
        dayReturn,
        closePosition,
        priceVsVwap,
        action: action as "watch_buy" | "light_position" | "wait",
        actionLabel,
        eligible,
        reasons,
        risks
      };
      const tags = [
        flow ? "盘中主力净流入" : "量价代理资金",
        sector?.rank != null && sector.rank <= 10 ? "板块异动" : null,
        priceVsVwap >= 0 ? "站上分时均价" : null,
        volumeRatio >= 1.4 ? "量能放大" : null
      ].filter((item): item is string => Boolean(item));
      const enriched: Candidate = {
        ...candidate,
        close: quote.price,
        dayRet: dayReturn,
        gap: quote.open > 0 ? quote.open / quote.preClose - 1 : candidate.gap,
        closePos: closePosition,
        volRatio: volumeRatio,
        turnoverEst: turnover,
        amountEst: quote.amount,
        avg5Amount: averageAmount,
        floatCap: quote.floatCap || candidate.floatCap,
        reviewTags: [
          ...new Set([...tags, ...(candidate.reviewTags ?? [])])
        ].slice(0, 6),
        reviewMetrics: {
          dayReturn,
          closePosition,
          amountRatio: quote.amount / Math.max(averageAmount, 1),
          turnover,
          current: quote.price,
          amount: quote.amount
        },
        liveEligible: eligible,
        liveReason: actionLabel,
        live: {
          open: quote.open,
          preClose: quote.preClose,
          current: quote.price,
          gap: quote.open > 0 ? quote.open / quote.preClose - 1 : 0,
          gapStrength: dayReturn / candidate.limit,
          auctionAmount: quote.amount,
          auctionRatio: amountPace,
          liveScore: score / 100
        },
        intraday,
        intradayScore: score,
        recommendationScore: score,
        qualityScore: clamp(sectorScore * 0.3 + capitalScore * 0.35 + modelScore * 0.35),
        executionScore: clamp(volumeScore * 0.45 + priceVolumeScore * 0.55),
        actionabilityScore: eligible ? score : Math.max(0, score - 20),
        actionabilityLabel: actionLabel,
        recentPosition: analyzeRecentPosition(
          candidate.history,
          candidate.limitStreak
        ),
        scoreBreakdown: {
          model: modelScore,
          review: candidate.reviewScore == null
            ? candidate.compositeScore * 100
            : candidate.reviewScore <= 1
              ? candidate.reviewScore * 100
              : candidate.reviewScore,
          auction: capitalScore,
          seal: 0,
          sector: sectorScore,
          liquidity: volumeScore,
          momentum: priceVolumeScore,
          risk: clamp(100 - penalty),
          lhb: capitalScore
        },
        scoreCoverage:
          [flow, sector, quote.volumeRatio > 0, candidate.history.length >= 11]
            .filter(Boolean).length / 4
      };
      return [enriched];
    })
    .sort(
      (a, b) =>
        Number(b.liveEligible) - Number(a.liveEligible) ||
        (b.intradayScore ?? 0) - (a.intradayScore ?? 0)
    );
}
