import type {
  Candidate,
  LimitLadderEntry,
  LimitUpSeed,
  LhbPulseStock,
  ReviewMaps,
  SectorPulse
} from "../types";
import type { SinaStock } from "./market";

interface RawLimitItem {
  c?: string;
  n?: string;
  p?: number;
  lbc?: number;
  hybk?: string;
  amount?: number;
}

interface RawLimitPool {
  data?: {
    tc?: number;
    qdate?: number;
    pool?: RawLimitItem[];
  } | null;
}

export interface LimitPoolSnapshot {
  date: string;
  limitUpCount: number;
  failedBoardCount: number;
  limitDownCount: number;
  items: LimitUpSeed[];
}

const EASTMONEY_UT = "7eea3edcaed734bea9cbfc24409ed989";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function pctText(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function priceFromPool(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Number(value) / 1000;
}

function compactDate(value: string) {
  return value.replaceAll("-", "");
}

async function fetchTopicPool(
  topic: "ZTPool" | "ZBPool" | "DTPool",
  date: string
): Promise<RawLimitPool | null> {
  const params = new URLSearchParams({
    ut: EASTMONEY_UT,
    dpt: "wz.ztzt",
    Pageindex: "0",
    pagesize: "1000",
    sort: topic === "DTPool" ? "fund:asc" : "fbt:asc",
    date: compactDate(date),
    _: String(Date.now())
  });
  try {
    const response = await fetch(
      `https://push2ex.eastmoney.com/getTopic${topic}?${params}`,
      { cache: "no-store" }
    );
    if (!response.ok) return null;
    return (await response.json()) as RawLimitPool;
  } catch {
    return null;
  }
}

export async function fetchLimitPools(date: string): Promise<LimitPoolSnapshot | null> {
  const [limitUp, failed, limitDown] = await Promise.all([
    fetchTopicPool("ZTPool", date),
    fetchTopicPool("ZBPool", date),
    fetchTopicPool("DTPool", date)
  ]);
  if (!limitUp?.data) return null;
  return {
    date:
      limitUp.data.qdate && String(limitUp.data.qdate).length === 8
        ? `${String(limitUp.data.qdate).slice(0, 4)}-${String(
            limitUp.data.qdate
          ).slice(4, 6)}-${String(limitUp.data.qdate).slice(6, 8)}`
        : date,
    limitUpCount: Number(limitUp.data.tc ?? limitUp.data.pool?.length ?? 0),
    failedBoardCount: Number(failed?.data?.tc ?? failed?.data?.pool?.length ?? 0),
    limitDownCount: Number(limitDown?.data?.tc ?? limitDown?.data?.pool?.length ?? 0),
    items: (limitUp.data.pool ?? [])
      .map((item) => ({
        code: String(item.c ?? ""),
        name: String(item.n ?? ""),
        sector: String(item.hybk ?? "未分类"),
        streak: Math.max(1, Number(item.lbc ?? 1)),
        close: priceFromPool(item.p)
      }))
      .filter((item) => item.code)
  };
}

export async function fetchLhbStocks(date: string): Promise<LhbPulseStock[]> {
  const params = new URLSearchParams({
    reportName: "RPT_DAILYBILLBOARD_DETAILSNEW",
    columns: "SECURITY_CODE,SECURITY_NAME_ABBR,BILLBOARD_NET_AMT,TRADE_DATE",
    filter: `(TRADE_DATE='${date}')`,
    pageNumber: "1",
    pageSize: "500",
    sortColumns: "BILLBOARD_NET_AMT",
    sortTypes: "-1",
    source: "WEB",
    client: "WEB"
  });
  try {
    const response = await fetch(
      `https://datacenter-web.eastmoney.com/api/data/v1/get?${params}`,
      { cache: "no-store" }
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      result?: { data?: Array<Record<string, unknown>> } | null;
    };
    const byCode = new Map<string, LhbPulseStock>();
    for (const item of payload.result?.data ?? []) {
      const code = String(item.SECURITY_CODE ?? "");
      if (!code) continue;
      const stock = {
        code,
        name: String(item.SECURITY_NAME_ABBR ?? ""),
        netAmount: Number(item.BILLBOARD_NET_AMT ?? 0)
      };
      const existing = byCode.get(code);
      if (!existing || Math.abs(stock.netAmount) > Math.abs(existing.netAmount)) {
        byCode.set(code, stock);
      }
    }
    return [...byCode.values()];
  } catch {
    return [];
  }
}

function inferredLimitUps(snapshot: SinaStock[]) {
  return snapshot
    .filter((stock) => {
      if (!stock.preClose) return false;
      const limit =
        stock.code.startsWith("30") || stock.code.startsWith("68") ? 0.195 : 0.095;
      return stock.current >= stock.preClose * (1 + limit);
    })
    .map((stock) => ({
      code: stock.code,
      name: stock.name,
      sector: "未分类",
      streak: 1,
      close: stock.current
    }));
}

function ladderFrom(items: LimitUpSeed[]) {
  const counts = new Map<number, number>();
  for (const item of items) {
    counts.set(item.streak, (counts.get(item.streak) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([streak, count]) => ({ streak, count }))
    .sort((a, b) => a.streak - b.streak);
}

function sectorPulses(
  items: LimitUpSeed[],
  previousLimitUps: LimitUpSeed[]
): SectorPulse[] {
  const currentCodes = new Set(items.map((item) => item.code));
  const groups = new Map<string, LimitUpSeed[]>();
  for (const item of items) {
    const group = groups.get(item.sector) ?? [];
    group.push(item);
    groups.set(item.sector, group);
  }
  return [...groups.entries()]
    .map(([name, group]) => {
      const previousGroup = previousLimitUps.filter((item) => item.sector === name);
      const promotedCount = previousGroup.filter((item) =>
        currentCodes.has(item.code)
      ).length;
      return {
        name,
        limitUpCount: group.length,
        maxStreak: Math.max(...group.map((item) => item.streak)),
        previousCount: previousGroup.length,
        promotedCount,
        promotionRate: previousGroup.length
          ? promotedCount / previousGroup.length
          : 0
      };
    })
    .filter((item) => item.limitUpCount >= 3)
    .sort(
      (a, b) =>
        b.limitUpCount - a.limitUpCount ||
        b.maxStreak - a.maxStreak ||
        b.promotionRate - a.promotionRate
    )
    .slice(0, 5);
}

function sectorRankScore(sector: SectorPulse) {
  return (
    clamp(sector.limitUpCount / 5, 0, 1) * 0.35 +
    clamp(sector.maxStreak / 5, 0, 1) * 0.25 +
    sector.promotionRate *
      clamp(sector.previousCount / 3, 0, 1) *
      0.4
  );
}

export function buildReviewMaps({
  snapshot,
  pools,
  lhbStocks,
  previousLimitUps,
  previousDate,
  date
}: {
  snapshot: SinaStock[];
  pools: LimitPoolSnapshot | null;
  lhbStocks: LhbPulseStock[];
  previousLimitUps: LimitUpSeed[];
  previousDate: string;
  date: string;
}): ReviewMaps {
  const quoteMap = new Map(snapshot.map((stock) => [stock.code, stock]));
  const limitUps = pools?.items.length ? pools.items : inferredLimitUps(snapshot);
  const currentCodes = new Set(limitUps.map((item) => item.code));
  const previousCodes = new Set(previousLimitUps.map((item) => item.code));
  const previousReturns = previousLimitUps.flatMap((item) => {
    const quote = quoteMap.get(item.code);
    if (!quote || !quote.preClose) return [];
    return [
      {
        quote,
        ret: quote.current / quote.preClose - 1,
        fade: quote.open > quote.preClose * 1.02 && quote.open > 0
          ? quote.current / quote.open - 1
          : 0
      }
    ];
  });
  const yesterdayLimitCount = previousLimitUps.length;
  const yesterdayPremium = previousReturns.length
    ? previousReturns.reduce((sum, item) => sum + item.ret, 0) /
      previousReturns.length
    : 0;
  const yesterdayWinRate = previousReturns.length
    ? previousReturns.filter((item) => item.ret > 0).length /
      previousReturns.length
    : 0;
  const limitUpCount = pools?.limitUpCount ?? limitUps.length;
  const failedBoardCount = pools?.failedBoardCount ?? 0;
  const touchedLimitCount = limitUpCount + failedBoardCount;
  const failedBoardRate = touchedLimitCount
    ? failedBoardCount / touchedLimitCount
    : 0;
  const limitDownCount = pools?.limitDownCount ?? snapshot.filter((stock) => {
    if (!stock.preClose) return false;
    const limit = stock.code.startsWith("30") || stock.code.startsWith("68")
      ? 0.195
      : 0.095;
    return stock.current <= stock.preClose * (1 - limit);
  }).length;
  const ladder = ladderFrom(limitUps);
  const maxStreak = Math.max(1, ...limitUps.map((item) => item.streak));
  const presentStreaks = new Set(ladder.map((item) => item.streak));
  const ladderGapCount = Array.from(
    { length: Math.max(0, maxStreak - 1) },
    (_, index) => index + 2
  ).filter((streak) => !presentStreaks.has(streak)).length;
  const ladderComplete = maxStreak >= 3 && ladderGapCount === 0;
  const strongSectors = sectorPulses(limitUps, previousLimitUps);
  const rankedSectors = [...strongSectors].sort(
    (a, b) => sectorRankScore(b) - sectorRankScore(a)
  );
  const topSector = rankedSectors[0] ?? null;
  const strongestSector = topSector
    ? {
        name: topSector.name,
        score: round(sectorRankScore(topSector)),
        limitUpCount: topSector.limitUpCount,
        maxStreak: topSector.maxStreak,
        previousCount: topSector.previousCount,
        promotedCount: topSector.promotedCount,
        promotionRate: topSector.promotionRate,
        reason: `${topSector.name}有${topSector.limitUpCount}只涨停，最高${topSector.maxStreak}板；昨日同板块${topSector.previousCount}只涨停，晋级${topSector.promotedCount}只。${topSector.previousCount < 3 ? "晋级样本较少，需防强势个股孤例。" : ""}`,
        auctionWatch:
          "次日9:25重点看该板块候选的平均高开、竞价成交额、竞价量额比和红盘比例；若集体转弱，板块结论同步降级。"
      }
    : null;
  const promotedCount = [...previousCodes].filter((code) =>
    currentCodes.has(code)
  ).length;
  const promotionRate = previousCodes.size ? promotedCount / previousCodes.size : 0;
  const sectorPromotionValues = strongSectors
    .map((sector) => sector.promotionRate)
    .filter((value) => value > 0);
  const strongSectorPromotion = sectorPromotionValues.length
    ? Math.max(...sectorPromotionValues)
    : 0;

  const top20 = [...snapshot]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 20);
  const top20Returns = top20.flatMap((stock) =>
    stock.preClose ? [stock.current / stock.preClose - 1] : []
  );
  const top20AvgReturn = top20Returns.length
    ? top20Returns.reduce((sum, value) => sum + value, 0) / top20Returns.length
    : 0;
  const top20UpRate = top20Returns.length
    ? top20Returns.filter((value) => value > 0).length / top20Returns.length
    : 0;
  const largeCapStrength = clamp((top20AvgReturn + 0.025) / 0.05, 0, 1);
  const lhbNetBuyCount = lhbStocks.filter((item) => item.netAmount > 0).length;
  const lhbNetSellCount = lhbStocks.filter((item) => item.netAmount < 0).length;
  const lhbNetAmount = lhbStocks.reduce(
    (sum, item) => sum + item.netAmount,
    0
  );
  const lhbBalance =
    lhbNetBuyCount + lhbNetSellCount > 0
      ? lhbNetBuyCount / (lhbNetBuyCount + lhbNetSellCount)
      : 0.5;
  const bigLossCount = previousReturns.filter(
    (item) =>
      item.ret <= -0.05 ||
      (item.quote.high > 0 && item.quote.current / item.quote.high - 1 <= -0.08)
  ).length;
  const highOpenFadeCount = previousReturns.filter(
    (item) => item.fade <= -0.05
  ).length;
  const yesterdayLimitDownCount = previousReturns.filter(
    (item) => item.ret <= -0.095
  ).length;
  const crowdedCount = previousReturns.filter(
    (item) => item.quote.turnover >= 30
  ).length;

  const premiumScore = clamp((yesterdayPremium + 0.045) / 0.09, 0, 1);
  const boardQuality = 1 - clamp(failedBoardRate, 0, 1);
  const ladderQuality =
    maxStreak < 2
      ? 0.35
      : clamp(0.72 + Math.min(maxStreak, 6) * 0.05 - ladderGapCount * 0.22, 0, 1);
  const sectorQuality = strongSectors.length
    ? clamp(
        strongSectors.reduce((sum, sector) => sum + sector.limitUpCount, 0) / 18 +
          strongSectors[0].maxStreak / 8,
        0,
        1
      )
    : 0.15;
  const emotionScore = round(
    premiumScore * 0.28 +
      yesterdayWinRate * 0.18 +
      boardQuality * 0.2 +
      ladderQuality * 0.16 +
      sectorQuality * 0.18
  );
  const capitalScore = round(
    largeCapStrength * 0.28 +
      top20UpRate * 0.18 +
      clamp(promotionRate / 0.45, 0, 1) * 0.22 +
      clamp(strongSectorPromotion / 0.5, 0, 1) * 0.14 +
      lhbBalance * 0.1 +
      clamp((lhbNetAmount + 2_000_000_000) / 4_000_000_000, 0, 1) * 0.08
  );
  const riskLoad = clamp(
    failedBoardRate * 0.15 +
      (yesterdayLimitCount ? bigLossCount / yesterdayLimitCount : 0) * 0.45 +
      clamp(limitDownCount / 30, 0, 1) * 0.25 +
      (yesterdayLimitCount ? crowdedCount / yesterdayLimitCount : 0) * 0.1 +
      clamp(ladderGapCount / 3, 0, 1) * 0.05,
    0,
    1
  );
  const riskScore = round(1 - riskLoad);
  const riskLevel = riskScore >= 0.78 ? "low" : riskScore >= 0.55 ? "medium" : "high";
  const emotionConclusion =
    emotionScore >= 0.68 && yesterdayPremium > 0
      ? {
          stance: "support" as const,
          title: "情绪偏暖，可做前排确认",
          action: "优先观察高辨识度核心股，后排跟风只做竞价和承接双重确认。"
        }
      : emotionScore >= 0.5
        ? {
            stance: "neutral" as const,
            title: "情绪中性，等待接力确认",
            action: "不因单只涨停直接追高；重点看昨日涨停溢价能否转正、炸板率能否下降。"
          }
        : {
            stance: "defensive" as const,
            title: "情绪偏冷，减少接力试错",
            action: "弱开、冲高回落和后排补涨均放弃，只保留最强核心的条件式机会。"
          };
  const capitalConclusion =
    capitalScore >= 0.58 &&
    top20AvgReturn > -0.01 &&
    lhbNetBuyCount >= lhbNetSellCount
      ? {
          stance: "support" as const,
          title: "资金愿意接力，可提高关注",
          action: "优先成交额占优、龙虎榜净买且有板块晋级支撑的标的。"
        }
      : capitalScore >= 0.38
        ? {
            stance: "neutral" as const,
            title: "资金分化，只做局部接力",
            action: "避开无龙虎榜净买和板块孤立的个股，等待竞价量能确认。"
          }
        : {
            stance: "defensive" as const,
            title: "资金偏弱，避免后排跟风",
            action: "缩量或平量高开不追，只跟踪龙虎榜净买、板块晋级和大单承接同时成立的个股。"
          };
  const riskConclusion =
    riskLevel === "low"
      ? {
          stance: "support" as const,
          title: "风险可控，可按纪律参与",
          action: "仍需设置竞价不追高和跌破分时均价减仓条件。"
        }
      : riskLevel === "medium"
        ? {
            stance: "neutral" as const,
            title: "风险中等，控制仓位",
            action: "首选不超过六只中确认度最高的一只，失败信号出现后不补仓。"
          }
        : {
            stance: "defensive" as const,
            title: "风险偏高，优先防守",
            action: "减少出手频率，已有仓位优先看减仓条件，不做逆势接力。"
          };
  const combinedScore = round(
    emotionScore * 0.34 + capitalScore * 0.36 + riskScore * 0.3
  );
  const overallConclusion =
    riskLevel === "high" || combinedScore < 0.45
      ? {
          stance: "defend" as const,
          title: "防守优先：退潮风险高于接力收益",
          action: "降低出手频率，只保留最强核心的观察机会；弱开、断板和跌破均价均不参与。"
        }
      : emotionScore >= 0.62 && capitalScore >= 0.55 && riskScore >= 0.65
        ? {
            stance: "attack" as const,
            title: "进攻窗口：情绪与资金形成共振",
            action: "可关注前排核心，但仍需通过竞价量价和9:35承接两关确认。"
          }
        : {
            stance: "watch" as const,
            title: "观察接力：情绪尚可，但资金不支持全面进攻",
            action: "只做龙虎榜净买、板块晋级、竞价量价和9:35承接同时成立的个股，不做后排扩散。"
          };
  const strongSectorText = strongSectors.length
    ? strongSectors
        .slice(0, 3)
        .map((sector) => `${sector.name}${sector.limitUpCount}只`)
        .join("、")
    : "暂无三只以上涨停板块";

  return {
    date,
    previousDate,
    generatedAt: new Date().toISOString(),
    emotion: {
      score: emotionScore,
      limitUpCount,
      limitDownCount,
      touchedLimitCount,
      failedBoardCount,
      failedBoardRate: round(failedBoardRate),
      yesterdayLimitCount,
      yesterdayPremium: round(yesterdayPremium),
      yesterdayWinRate: round(yesterdayWinRate),
      yesterdayLimitDownCount,
      maxStreak,
      ladder,
      ladderGapCount,
      ladderComplete,
      strongSectors,
      summary: `昨日涨停溢价 ${pctText(yesterdayPremium)}，红盘率 ${(yesterdayWinRate * 100).toFixed(1)}%；炸板率 ${(failedBoardRate * 100).toFixed(1)}%，最高 ${maxStreak} 板，${ladderComplete ? "梯队完整" : `梯队缺 ${ladderGapCount} 档`}；强势板块 ${strongSectorText}。`,
      conclusion: emotionConclusion
    },
    capital: {
      score: capitalScore,
      top20AvgReturn: round(top20AvgReturn),
      top20UpRate: round(top20UpRate),
      largeCapStrength: round(largeCapStrength),
      lhbNetBuyCount,
      lhbNetSellCount,
      lhbNetAmount,
      promotionRate: round(promotionRate),
      promotedCount,
      strongSectorPromotion: round(strongSectorPromotion),
      summary: `成交额前20平均 ${pctText(top20AvgReturn)}，上涨占比 ${(top20UpRate * 100).toFixed(0)}%；龙虎榜净买 ${lhbNetBuyCount} 家、净卖 ${lhbNetSellCount} 家；昨日涨停晋级 ${promotedCount} 只，晋级率 ${(promotionRate * 100).toFixed(1)}%。`,
      conclusion: capitalConclusion
    },
    risk: {
      score: riskScore,
      level: riskLevel,
      bigLossCount,
      highOpenFadeCount,
      limitDownCount,
      failedBoardRate: round(failedBoardRate),
      crowdedCount,
      summary: `跌停 ${limitDownCount} 只，昨日涨停中大面 ${bigLossCount} 只、高开低走 ${highOpenFadeCount} 只，拥挤换手 ${crowdedCount} 只；${riskLevel === "low" ? "风险可控" : riskLevel === "medium" ? "需控制仓位" : "优先防守"}。`,
      conclusion: riskConclusion
    },
    limitUps,
    previousLimitUps,
    lhbStocks,
    conclusion: {
      stance: overallConclusion.stance,
      score: combinedScore,
      title: overallConclusion.title,
      action: overallConclusion.action,
      reasons: [
        `情绪：${emotionConclusion.title}`,
        `资金：${capitalConclusion.title}`,
        `风险：${riskConclusion.title}`
      ]
    },
    strongestSector
  };
}

export function scoreCandidateWithMaps(
  candidate: Candidate,
  quote: SinaStock,
  maps: ReviewMaps,
  baseSignal: number
) {
  const sector = maps.emotion.strongSectors.find(
    (item) => item.name === candidate.industry
  );
  const amountRatio = quote.amount / Math.max(candidate.avg5Amount || 1, 1);
  const lhbStock = maps.lhbStocks.find((item) => item.code === candidate.code);
  const lhbRatio = lhbStock
    ? lhbStock.netAmount / Math.max(quote.amount, 1)
    : null;
  const closePosition =
    quote.high > quote.low
      ? (quote.current - quote.low) / (quote.high - quote.low)
      : 0.5;
  const stockEmotion = clamp(
    (candidate.limitToday ? 0.62 : 0.3) +
      Math.min(candidate.limitStreak, 5) * 0.055 +
      clamp(candidate.sectorLimitCount / 5, 0, 1) * 0.16 +
      (sector ? 0.12 : 0),
    0,
    1
  );
  const emotion = maps.emotion.score * 0.62 + stockEmotion * 0.38;
  const capital =
    maps.capital.score * 0.45 +
    clamp(amountRatio / 0.2, 0, 1) * 0.19 +
    (sector?.promotionRate ?? maps.capital.strongSectorPromotion) * 0.12 +
    closePosition * 0.1 +
    clamp(((lhbRatio ?? 0) + 0.05) / 0.15, 0, 1) * 0.14;
  const overextended = clamp(
    (Math.max(candidate.ret5 - 0.25, 0) +
      Math.max(candidate.ret10 - 0.35, 0)) /
      0.5,
    0,
    1
  );
  const turnoverRisk = clamp(
    (quote.turnover - 20) / Math.max(18, candidate.turnoverEst || 18),
    0,
    1
  );
  const risk =
    maps.risk.score * 0.55 +
    (1 - overextended) * 0.14 +
    (1 - turnoverRisk) * 0.1 +
    closePosition * 0.11 +
    (sector || candidate.sectorLimitCount > 0 ? 1 : 0.5) * 0.1 -
    candidate.riskPenalty * 1.4;
  const mapEmotion = clamp(emotion, 0, 1);
  const mapCapital = clamp(capital, 0, 1);
  const mapRisk = clamp(risk, 0, 1);
  const total = clamp(
    mapEmotion * 0.32 + mapCapital * 0.33 + mapRisk * 0.35,
    0,
    1
  );
  const reviewScore = clamp(
    baseSignal * 0.38 + total * 0.62 - candidate.riskPenalty * 0.18,
    0,
    1
  );
  const reviewTags = [
    ...(mapEmotion >= 0.62 ? ["情绪顺风"] : []),
    ...(mapCapital >= 0.62 ? ["资金占优"] : []),
    ...((sector?.promotionRate ?? 0) >= 0.35 ? ["板块晋级"] : []),
    ...((lhbStock?.netAmount ?? 0) > 0 ? ["龙虎榜净买"] : []),
    ...((lhbStock?.netAmount ?? 0) < 0 ? ["龙虎榜净卖"] : []),
    ...(mapRisk >= 0.62 ? ["风险可控"] : ["风险偏高"]),
    ...(maps.emotion.ladderGapCount > 0 ? ["梯队断层"] : []),
    ...(maps.risk.bigLossCount > 0 ? ["提防大面"] : [])
  ].slice(0, 5);
  return {
    mapScores: {
      emotion: round(mapEmotion),
      capital: round(mapCapital),
      risk: round(mapRisk),
      total: round(total)
    },
    reviewScore: round(reviewScore),
    reviewTags
  };
}

