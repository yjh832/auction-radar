import type { Candidate, HistoryPoint, ReviewMaps } from "../types";
import { isMainBoardCode } from "./universe";
import { analyzeRecentPosition } from "./recentPosition";
import {
  analyzeCapitalStyle,
  assessLeaderRelation
} from "./capitalStyle";

export type RecommendationStyle = "trend" | "intraday" | "board";

export interface BoardPick {
  candidate: Candidate;
  role:
    | "breakout_relay"
    | "one_to_two"
    | "strongest_seal"
    | "board_alternative";
  roleLabel: string;
  score: number;
  reasons: string[];
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function sectorScore(candidate: Candidate, maps?: ReviewMaps | null) {
  const strongest = maps?.strongestSector?.name;
  const isStrongest = strongest && candidate.industry.includes(strongest);
  return clamp(
    clamp(candidate.sectorLimitCount / 3, 0, 1) * 55 +
      clamp(candidate.sectorStrongCount / 5, 0, 1) * 35 +
      (isStrongest ? 10 : 0)
  );
}

function riskQuality(candidate: Candidate) {
  let score =
    candidate.riskLevel === "low"
      ? 88
      : candidate.riskLevel === "medium"
        ? 62
        : 28;
  if (candidate.anomaly?.regulatoryStatus === "abnormal") score -= 24;
  else if (candidate.anomaly?.regulatoryStatus === "watch") score -= 8;
  return clamp(score);
}

function candidateFunds(candidate: Candidate) {
  const amountRatio =
    candidate.amountEst / Math.max(candidate.avg5Amount || 1, 1);
  const flowStrength =
    candidate.avg5Amount > 0
      ? clamp(amountRatio / 1.5, 0, 1)
      : clamp(candidate.amountEst / 300_000_000, 0, 1);
  return clamp(
    flowStrength * 52 +
      clamp(candidate.volRatio / 3, 0, 1) * 30 +
      (candidate.reviewTags?.some((tag) => tag.includes("龙虎榜净买"))
        ? 18
        : candidate.reviewTags?.some((tag) => tag.includes("龙虎榜净卖"))
          ? 2
          : 10)
  );
}

function limitUpHistoryStats(candidate: Candidate) {
  const bars = uniqueHistory(candidate.history);
  let geneCount60 = 0;
  let failedBoardCount20 = 0;
  for (let index = 1; index < bars.length; index += 1) {
    const previous = Number(bars[index - 1].close);
    const current = bars[index];
    if (previous <= 0 || current.close <= 0) continue;
    const limitPrice =
      Math.round(previous * (1 + candidate.limit) * 100 + 0.00001) / 100;
    const touched = Number(current.high ?? current.close) >= limitPrice - 0.011;
    const sealed = current.close >= limitPrice - 0.011;
    const daysFromEnd = bars.length - 1 - index;
    if (sealed && daysFromEnd < 60) geneCount60 += 1;
    if (touched && !sealed && daysFromEnd < 20) failedBoardCount20 += 1;
  }
  return { geneCount60, failedBoardCount20 };
}

function evaluateOneToTwo(
  candidate: Candidate,
  maps?: ReviewMaps | null
) {
  const stats = limitUpHistoryStats(candidate);
  const geneCount60 = Math.max(
    stats.geneCount60,
    candidate.limit60,
    candidate.limitStreak
  );
  const failedBoardCount20 = stats.failedBoardCount20;
  const oneWord = candidate.gap >= candidate.limit * 0.95;
  const capPass =
    candidate.floatCap <= 0 || candidate.floatCap <= 10_000_000_000;
  const pricePass = candidate.close > 0 && candidate.close <= 20;
  const sealScore =
    candidate.auctionSeal?.score ?? candidate.boardScore ?? 0;
  const sealPass =
    candidate.auctionSeal == null ? true : sealScore >= 42;
  const failedPass = failedBoardCount20 < 2;
  const marketFriendly =
    maps?.risk.level !== "high" &&
    (maps?.emotion.failedBoardRate ?? 0) < 0.4;
  const auctionTurnoverRate =
    candidate.live && candidate.auctionSeal
      ? candidate.auctionSeal.turnoverRate
      : null;
  const auctionTurnoverRequired =
    candidate.turnoverEst > 0
      ? Math.max(0.5, candidate.turnoverEst * 0.05)
      : 0.5;
  const auctionConfirmed =
    auctionTurnoverRate == null
      ? null
      : auctionTurnoverRate >= auctionTurnoverRequired;
  const geneScore = clamp(geneCount60 / 4, 0, 1) * 100;
  const sealQuality = clamp(sealScore);
  const sector = sectorScore(candidate, maps);
  const funds = candidateFunds(candidate);
  const sizeScore =
    candidate.floatCap > 0
      ? clamp((1 - candidate.floatCap / 10_000_000_000) * 72)
      : 40;
  const priceScore = clamp((1 - candidate.close / 20) * 100);
  const positionScore =
    candidate.recentPosition?.status === "low"
      ? 88
      : candidate.recentPosition?.status === "middle"
        ? 68
        : candidate.recentPosition?.status === "high"
          ? 28
          : 50;
  const auctionAdjustment =
    auctionConfirmed === true ? 5 : auctionConfirmed === false ? -12 : 0;
  const marketAdjustment = marketFriendly ? 0 : -14;
  const oldLeaderRisk =
    (candidate.ret30 ?? 0) >= 1.8 ||
    ((candidate.ret10 ?? 0) >= 0.7 &&
      candidate.recentPosition?.status === "high");
  const score = clamp(
    sealQuality * 0.24 +
      geneScore * 0.18 +
      sector * 0.2 +
      funds * 0.1 +
      sizeScore * 0.08 +
      priceScore * 0.07 +
      positionScore * 0.08 +
      clamp(candidate.volRatio / 3, 0, 1) * 5 +
      auctionAdjustment +
      marketAdjustment -
      (oldLeaderRisk ? 12 : 0)
  );
  const eligible =
    candidate.limitStreak === 1 &&
    geneCount60 >= 2 &&
    !oneWord &&
    capPass &&
    pricePass &&
    sealPass &&
    failedPass &&
    marketFriendly &&
    auctionConfirmed !== false &&
    !oldLeaderRisk;
  const reasons = [
    `60日涨停${geneCount60}次`,
    oneWord ? "首板接近一字，执行性差" : "首板非一字，具备换手",
    candidate.floatCap > 0
      ? `流通市值${(candidate.floatCap / 100_000_000).toFixed(1)}亿`
      : "流通市值待补全",
    `封单质量${Math.round(sealScore)}${candidate.auctionSeal?.label ? ` · ${candidate.auctionSeal.label}` : " · 分时封板细节待补全"}`,
    `板块强度${Math.round(sector)}，${maps?.strongestSector?.name ?? candidate.industry}为情绪参考`
  ];
  const risks = [
    failedBoardCount20 >= 2
      ? `近20日有${failedBoardCount20}次触板未封，按反复炸板排除`
      : null,
    oneWord ? "首板为一字结构，买点不可执行" : null,
    candidate.floatCap > 10_000_000_000
      ? "流通市值超过100亿，游资接力难度较高"
      : null,
    candidate.close > 20 ? "股价超过20元，跟风资金承接要求较高" : null,
    !marketFriendly ? "市场炸板率偏高或风险等级高，当前不宜重仓打板" : null,
    oldLeaderRisk ? "近30日涨幅过大或处于高位，需防老龙头二波空间不足" : null,
    candidate.history.length < 20
      ? "历史K线不足，60日涨停基因与炸板次数使用可得数据估算"
      : null
  ].filter((item): item is string => Boolean(item));
  return {
    score,
    eligible,
    geneCount60,
    failedBoardCount20,
    oneWord,
    capPass,
    pricePass,
    sealPass,
    auctionTurnoverRate,
    auctionTurnoverRequired,
    auctionConfirmed,
    marketFriendly,
    positionAdvice:
      "单票不超过四成仓；次日竞价换手达标后，涨至8%以上再按涨停价排队，未回封当日退出。",
    reasons,
    risks
  };
}

interface LaunchPattern {
  prePositionPct: number | null;
  pre5Return: number | null;
  volumeExpansion: number | null;
  amountExpansion: number | null;
  firstBoardGap: number | null;
}

function uniqueHistory(history: HistoryPoint[]) {
  const byDate = new Map<string, HistoryPoint>();
  for (const item of history) {
    if (!item.date || Number(item.close) <= 0) continue;
    byDate.set(item.date, item);
  }
  return [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

function launchPattern(
  history: HistoryPoint[],
  streak: number,
  limit: number,
  includeCurrent = true
): LaunchPattern | null {
  const bars = uniqueHistory(history);
  const sequence = includeCurrent ? bars : bars.slice(0, -1);
  if (sequence.length < 9 || streak <= 0) return null;
  const start = Math.max(1, sequence.length - streak);
  const prior = sequence.slice(Math.max(0, start - 10), start);
  if (prior.length < 5) return null;
  const base = prior.at(-1)!;
  const low = Math.min(...prior.map((item) => Number(item.close)));
  const high = Math.max(...prior.map((item) => Number(item.close)));
  const prePositionPct =
    ((base.close - low) / Math.max(high - low, 0.0001)) * 100;
  const fiveDaysAgo = sequence[Math.max(0, start - 5)];
  const pre5Return =
    fiveDaysAgo.close > 0 ? base.close / fiveDaysAgo.close - 1 : null;
  const priorVolumes = prior
    .slice(-5)
    .map((item) => Number(item.volume ?? 0))
    .filter((value) => value > 0);
  const launchBars = sequence.slice(start, Math.min(sequence.length, start + 2));
  const launchVolumes = launchBars
    .map((item) => Number(item.volume ?? 0))
    .filter((value) => value > 0);
  const average = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  const priorVolume = average(priorVolumes);
  const launchVolume = average(launchVolumes);
  const priorAmounts = prior
    .slice(-5)
    .map((item) => Number(item.close) * Number(item.volume ?? 0))
    .filter((value) => value > 0);
  const launchAmounts = launchBars
    .map((item) => Number(item.close) * Number(item.volume ?? 0))
    .filter((value) => value > 0);
  const firstBoard = sequence[start];
  const firstBoardGap =
    firstBoard?.open && base.close > 0
      ? firstBoard.open / base.close - 1
      : null;
  return {
    prePositionPct,
    pre5Return,
    volumeExpansion:
      priorVolume > 0 && launchVolume > 0
        ? launchVolume / priorVolume
        : null,
    amountExpansion:
      priorAmounts.length > 0 && launchAmounts.length > 0
        ? average(launchAmounts) / average(priorAmounts)
        : null,
    firstBoardGap
  };
}

function patternSimilarity(
  leader: LaunchPattern,
  candidate: LaunchPattern
) {
  let weightedDistance = 0;
  let weight = 0;
  const compare = (
    left: number | null,
    right: number | null,
    scale: number,
    itemWeight: number
  ) => {
    if (left == null || right == null) return;
    weightedDistance +=
      Math.min(1, Math.abs(left - right) / scale) * itemWeight;
    weight += itemWeight;
  };
  compare(leader.prePositionPct, candidate.prePositionPct, 100, 24);
  compare(leader.pre5Return, candidate.pre5Return, 0.15, 18);
  compare(
    leader.volumeExpansion == null ? null : Math.log1p(leader.volumeExpansion),
    candidate.volumeExpansion == null
      ? null
      : Math.log1p(candidate.volumeExpansion),
    1.4,
    24
  );
  compare(
    leader.amountExpansion == null ? null : Math.log1p(leader.amountExpansion),
    candidate.amountExpansion == null
      ? null
      : Math.log1p(candidate.amountExpansion),
    1.5,
    18
  );
  compare(leader.firstBoardGap, candidate.firstBoardGap, 0.08, 16);
  if (!weight) return null;
  return clamp(100 - (weightedDistance / weight) * 100, 0, 100);
}

function mergeLimitCandidate(
  seed: NonNullable<ReviewMaps["limitUps"]>[number],
  candidates: Candidate[],
  maps?: ReviewMaps | null,
  historyByCode?: Map<string, HistoryPoint[]>
) {
  const existing = candidates.find((candidate) => candidate.code === seed.code);
  const inferredFloatCap =
    seed.auctionSeal && seed.auctionSeal.floatCapRatio > 0
      ? seed.auctionSeal.sealAmount / seed.auctionSeal.floatCapRatio
      : 0;
  const sector = maps?.emotion.strongSectors.find(
    (item) => item.name === seed.sector
  );
  if (existing) {
    return {
      ...existing,
      industry: existing.industry || seed.sector,
      limitToday: true,
      limitStreak: Math.max(existing.limitStreak, seed.streak),
      close: existing.close || seed.close,
      floatCap: existing.floatCap || inferredFloatCap,
      auctionSeal: existing.auctionSeal ?? seed.auctionSeal ?? null,
      boardScore: existing.boardScore ?? seed.boardScore,
      history:
        historyByCode?.get(seed.code)?.length
          ? historyByCode.get(seed.code)!
          : existing.history
    };
  }
  const limit = seed.code.startsWith("30") || seed.code.startsWith("68")
    ? 0.2
    : 0.1;
  return {
    rank: 999,
    modelRank: 999,
    code: seed.code,
    symbol: `${seed.code.startsWith("6") ? "sh" : "sz"}${seed.code}`,
    name: seed.name,
    industry: seed.sector,
    modelScore: 0.5,
    compositeScore: 0.5,
    close: seed.close,
    dayRet: limit,
    gap: seed.gap ?? 0,
    limit,
    limitToday: true,
    limit20: seed.streak,
    limit60: seed.streak,
    limitStreak: seed.streak,
    volRatio: seed.volumeRatio ?? 0,
    ret5: 0,
    ret10: 0,
    closePos: 1,
    nearHigh20: 1,
    turnoverEst: seed.turnoverRate ?? 0,
    amountEst: seed.amount ?? 0,
    avg5Amount: 0,
    sectorN: sector?.limitUpCount ?? 0,
    sectorLimitCount: sector?.limitUpCount ?? 0,
    sectorStrongCount: sector?.limitUpCount ?? 0,
    floatCap: inferredFloatCap,
    riskLevel: "medium" as const,
    riskPenalty: 0.04,
    riskNotes: ["盘后涨停池补充标的"],
    history: historyByCode?.get(seed.code) ?? [],
    lastAuction: {
      price: seed.open ?? seed.close,
      amount: seed.amount ?? 0,
      ratio: seed.volumeRatio ?? 0,
      first5Ret: 0
    },
    auctionSeal: seed.auctionSeal ?? null,
    boardScore: seed.boardScore
  } satisfies Candidate;
}

export function buildTrendPicks(candidates: Candidate[]) {
  return [...candidates]
    .sort(
      (a, b) =>
        (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0) ||
        (b.actionabilityScore ?? 0) - (a.actionabilityScore ?? 0)
    )
    .slice(0, 2);
}

export function buildBoardPicks(
  candidates: Candidate[],
  maps?: ReviewMaps | null,
  historyByCode?: Map<string, HistoryPoint[]>
): BoardPick[] {
  const marketLimitCandidates = (maps?.limitUps ?? [])
    .filter((seed) => isMainBoardCode(seed.code))
    .map((seed) => mergeLimitCandidate(seed, candidates, maps, historyByCode))
    .map((candidate) => ({
      ...candidate,
      recentPosition: analyzeRecentPosition(
        candidate.history,
        candidate.limitStreak
      )
    }));
  const pool = marketLimitCandidates.length
    ? marketLimitCandidates
    : candidates.filter((candidate) => candidate.limitToday);
  const currentCodes = new Set(pool.map((candidate) => candidate.code));
  const brokenHighStocks = (maps?.previousLimitUps ?? []).filter(
    (stock) =>
      isMainBoardCode(stock.code) &&
      stock.streak >= 3 &&
      !currentCodes.has(stock.code)
  );
  const leadBroken =
    [...brokenHighStocks].sort((a, b) => b.streak - a.streak)[0] ?? null;
  const leadBrokenHistory = leadBroken
    ? historyByCode?.get(leadBroken.code) ?? []
    : [];
  const leadPattern =
    leadBroken && leadBrokenHistory.length >= 9
      ? launchPattern(
          leadBrokenHistory,
          leadBroken.streak,
          String(leadBroken.code).startsWith("30") ||
            String(leadBroken.code).startsWith("68")
            ? 0.2
            : 0.1,
          false
        )
      : null;
  const patternPool = pool.map((candidate) => {
    const candidatePattern = leadPattern
      ? launchPattern(
          candidate.history,
          candidate.limitStreak,
          candidate.limit
        )
      : null;
    const similarity =
      leadPattern && candidatePattern
        ? patternSimilarity(leadPattern, candidatePattern)
        : null;
    const relation = leadBroken
      ? assessLeaderRelation(
          { name: leadBroken.name, industry: leadBroken.sector },
          { name: candidate.name, industry: candidate.industry }
        )
      : {
          qualified: true,
          type: "none" as const,
          label: "当前无断板龙头模板",
          score: 0,
          reasons: []
        };
    const capitalStyle = analyzeCapitalStyle(candidate);
    const oneToTwo = evaluateOneToTwo(candidate, maps);
    const rotationEligible =
      relation.qualified &&
      candidate.limitStreak <= 2 &&
      candidate.recentPosition?.status !== "high" &&
      capitalStyle.rotationFriendly;
    return {
      ...candidate,
      leaderSimilarity: similarity ?? undefined,
      matchedLeader: leadBroken?.name,
      matchedLeaderIndustry: leadBroken?.sector,
      leaderRelationType: relation.type,
      leaderRelationLabel: relation.label,
      leaderRelationScore: relation.score,
      leaderRelationQualified: relation.qualified,
      leaderRotationEligible: rotationEligible,
      leaderRelationReasons: relation.reasons,
      oneToTwo,
      oneToTwoScore: oneToTwo.score,
      leaderPatternTags: [
        ...(similarity != null
          ? [`${leadBroken?.name ?? "最高标"}模板${similarity.toFixed(0)}%`]
          : []),
        ...(candidate.recentPosition?.status === "low"
          ? ["10日低位启动"]
          : candidate.recentPosition?.status === "high"
            ? ["10日高位加速"]
            : [])
      ]
    };
  });
  const rotationCandidates = patternPool
    .filter((candidate) => candidate.oneToTwo?.eligible)
    .map((candidate) => ({
      candidate,
      role: "one_to_two" as const,
      roleLabel: "一进二候选",
      score: candidate.oneToTwoScore ?? 0,
      reasons: [
        ...(candidate.oneToTwo?.reasons ?? []),
        candidate.oneToTwo?.auctionConfirmed == null
          ? `待9:25竞价换手确认，参考阈值${(candidate.oneToTwo?.auctionTurnoverRequired ?? 0.5).toFixed(2)}%`
          : `竞价换手${candidate.oneToTwo.auctionTurnoverRate?.toFixed(2)}%，阈值${candidate.oneToTwo.auctionTurnoverRequired?.toFixed(2)}%`,
        candidate.oneToTwo?.positionAdvice ?? "单票不超过四成仓"
      ]
    }))
    .sort((a, b) => b.score - a.score);

  const strongest = [...patternPool]
    .sort((a, b) => {
      const score = (candidate: Candidate) =>
        clamp(
          (candidate.boardScore ?? candidate.auctionSeal?.score ?? 0) * 0.58 +
            (candidate.auctionSeal?.score ?? 0) * 0.17 +
            sectorScore(candidate, maps) * 0.15 +
            riskQuality(candidate) * 0.1
        );
      return score(b) - score(a);
    })
    .map((candidate) => ({
      candidate,
      role: "strongest_seal" as const,
      roleLabel: "最强封板",
      score: clamp(
        (candidate.boardScore ?? candidate.auctionSeal?.score ?? 0) * 0.58 +
          (candidate.auctionSeal?.score ?? 0) * 0.17 +
          sectorScore(candidate, maps) * 0.15 +
          riskQuality(candidate) * 0.1
      ),
      reasons: [
        candidate.auctionSeal?.label ?? "封板质量待盘口确认",
        `${analyzeCapitalStyle(candidate).label}，短线接力更看游资承接`,
        ...(candidate.leaderRotationEligible
          ? [candidate.leaderRelationLabel ?? "补涨属性通过"]
          : ["当前无同属性低位1板/2板补涨"]),
        `板块强度${Math.round(sectorScore(candidate, maps))}，${
          candidate.limitStreak >= 3 ||
          candidate.recentPosition?.status === "high"
            ? "高位接力风险需单独控制"
            : "低位高度仍有拓展空间"
        }`,
        candidate.recentPosition?.label ?? "10日位置待补全"
      ]
    }));

  const preferredRotation =
    rotationCandidates[0];
  const fallbackStrongest = strongest[0] ?? null;
  const first: BoardPick | null = preferredRotation ??
    (fallbackStrongest
      ? {
          ...fallbackStrongest,
          roleLabel: "无一进二合格 · 最强封板"
        }
      : null);
  const secondBase =
    rotationCandidates.find(
      (item) => item.candidate.code !== first?.candidate.code
    ) ??
    strongest.find((item) => item.candidate.code !== first?.candidate.code) ??
    null;
  const second: BoardPick | null = secondBase
    ? {
        ...secondBase,
        roleLabel:
          secondBase.role === "one_to_two"
            ? "一进二次选"
            : first?.role === "strongest_seal" &&
                secondBase.role === "strongest_seal"
              ? "次强封板"
              : secondBase.roleLabel
      }
    : null;
  const labeledFirst: BoardPick | null =
    first?.role === "one_to_two"
      ? { ...first, roleLabel: "一进二首选" }
      : first;
  const selectedCodes = new Set(
    [labeledFirst, second].flatMap((item) => item ? [item.candidate.code] : [])
  );
  const alternatives = patternPool
    .filter((candidate) => !selectedCodes.has(candidate.code))
    .map((candidate) => {
      const seal = candidate.auctionSeal?.score ?? candidate.boardScore ?? 0;
      const capitalStyle = analyzeCapitalStyle(candidate);
      const profile = candidate.oneToTwo;
      const score = profile
        ? profile.score + (profile.eligible ? 6 : 0)
        : clamp(
            (candidate.boardScore ?? seal) * 0.5 +
              seal * 0.18 +
              sectorScore(candidate, maps) * 0.18 +
              candidateFunds(candidate) * 0.09 +
              riskQuality(candidate) * 0.05 +
              capitalStyle.hotMoneyScore * 0.06
          );
      return {
        candidate,
        role: "board_alternative" as const,
        roleLabel:
          candidate.limitStreak === 1
            ? profile?.eligible
              ? "一进二备选"
              : "一进二观察"
            : "封板强度观察",
        score,
        reasons: [
          ...(profile?.reasons ?? [
            candidate.auctionSeal?.label ?? "封单质量待盘口确认",
            `${capitalStyle.label} · 游资${capitalStyle.hotMoneyScore} / 机构${capitalStyle.institutionScore}`,
            candidate.recentPosition?.label ?? "10日位置待补全"
          ]),
          ...(profile?.risks.slice(0, 2) ?? []),
          `板块强度${Math.round(sectorScore(candidate, maps))}，${candidate.limitStreak}板`,
        ]
      };
    })
    .sort(
      (a, b) =>
        Number(b.candidate.oneToTwo?.eligible) -
          Number(a.candidate.oneToTwo?.eligible) ||
        b.score - a.score
    )
    .slice(0, 6);
  const picks: Array<BoardPick | null> = [
    labeledFirst,
    second,
    ...alternatives
  ];
  return picks.filter(
    (item): item is BoardPick => item !== null
  );
}
