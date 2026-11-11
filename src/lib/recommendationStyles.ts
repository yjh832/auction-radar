import type { Candidate, HistoryPoint, ReviewMaps } from "../types";
import { isMainBoardCode } from "./universe";
import { analyzeRecentPosition } from "./recentPosition";
import {
  analyzeCapitalStyle,
  assessLeaderRelation
} from "./capitalStyle";

export type RecommendationStyle = "trend" | "board";

export interface BoardPick {
  candidate: Candidate;
  role: "breakout_relay" | "strongest_seal" | "board_alternative";
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
    floatCap: 0,
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
  const brokenHighSectors = new Set(
    brokenHighStocks.map((stock) => stock.sector)
  );
  const highestStreak = Math.max(
    1,
    ...(maps?.limitUps ?? []).map((stock) => stock.streak)
  );
  const highestSectors = new Set(
    (maps?.limitUps ?? [])
      .filter((stock) => stock.streak === highestStreak)
      .map((stock) => stock.sector)
  );
  const relatedSectors = new Set([
    ...brokenHighSectors,
    ...highestSectors,
    ...(maps?.strongestSector ? [maps.strongestSector.name] : [])
  ]);
  const rotationCandidates = patternPool
    .filter((candidate) => candidate.leaderRotationEligible)
    .map((candidate) => {
      const seal = candidate.auctionSeal?.score ?? candidate.boardScore ?? 0;
      const funds = candidateFunds(candidate);
      const sector = sectorScore(candidate, maps);
      const capitalStyle = analyzeCapitalStyle(candidate);
      const isBrokenSector = [...brokenHighSectors].some((name) =>
        candidate.industry.includes(name) || name.includes(candidate.industry)
      );
      const isRelated =
        isBrokenSector ||
        [...relatedSectors].some(
          (name) =>
            candidate.industry.includes(name) ||
            name.includes(candidate.industry)
        );
      const lowPosition = candidate.limitStreak === 1 ? 12 : 16;
      const patternBoost =
        candidate.leaderSimilarity == null
          ? 0
          : candidate.leaderSimilarity * 0.22;
      const positionAdjustment =
        candidate.recentPosition?.status === "low"
          ? 20
          : candidate.recentPosition?.status === "middle"
            ? 5
            : candidate.recentPosition?.status === "high"
              ? -12
              : 0;
      const score = clamp(
        lowPosition +
          seal * 0.33 +
          sector * 0.2 +
          funds * 0.18 +
          riskQuality(candidate) * 0.08 +
          (isBrokenSector ? 18 : isRelated ? 10 : 0) +
          positionAdjustment +
          patternBoost +
          (candidate.leaderRelationScore ?? 0) * 0.12 +
          capitalStyle.hotMoneyScore * 0.08
      );
      const boardType = candidate.limitStreak === 1 ? "首板" : "一进二";
      const roleLabel =
        candidate.recentPosition?.status === "low"
          ? candidate.leaderSimilarity != null &&
            candidate.leaderSimilarity >= 70
            ? `游资同属性低位${boardType}`
            : `同属性低位${boardType}`
          : candidate.recentPosition?.status === "middle"
            ? `同属性中位${boardType}`
            : candidate.recentPosition?.status === "high"
              ? "高位补涨接力"
              : `待确认${boardType}`;
      return {
        candidate,
        role: "breakout_relay" as const,
        roleLabel,
        score,
        reasons: [
          isBrokenSector
            ? `高位股断板后同板块高低切，${candidate.industry}形成低位承接`
            : isRelated
              ? `与最高标/强势板块存在情绪关联，${candidate.industry}获资金关注`
              : `${candidate.recentPosition?.label ?? "10日位置待确认"}，${boardType}中封板与资金综合最强`,
          candidate.auctionSeal?.label ?? "封板质量待盘口确认",
          `资金${funds >= 65 ? "承接较强" : "承接一般"}，板块强度${Math.round(sector)}`,
          `${capitalStyle.label} · 游资${capitalStyle.hotMoneyScore} / 机构${capitalStyle.institutionScore}`,
          candidate.leaderRelationLabel ?? "补涨属性待确认",
          candidate.recentPosition?.label ?? "10日位置待补全",
          candidate.leaderSimilarity == null
            ? "龙头启动模板待补全"
            : `与${candidate.matchedLeader ?? "最高标"}启动相似度${candidate.leaderSimilarity.toFixed(0)}%`
        ]
      };
    })
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
    rotationCandidates.find(
      (item) =>
        item.candidate.recentPosition?.status === "low" ||
        item.candidate.recentPosition?.status === "middle"
    ) ?? rotationCandidates[0];
  const fallbackStrongest = strongest[0] ?? null;
  const first: BoardPick | null = preferredRotation ??
    (fallbackStrongest
      ? {
          ...fallbackStrongest,
          roleLabel: "无合格补涨 · 最强封板"
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
          first?.role === "strongest_seal" &&
          secondBase.role === "strongest_seal"
            ? "次强封板"
            : secondBase.roleLabel
      }
    : null;
  const selectedCodes = new Set(
    [first, second].flatMap((item) => item ? [item.candidate.code] : [])
  );
  const alternatives = patternPool
    .filter((candidate) => !selectedCodes.has(candidate.code))
    .map((candidate) => {
      const seal = candidate.auctionSeal?.score ?? candidate.boardScore ?? 0;
      const capitalStyle = analyzeCapitalStyle(candidate);
      const rotationEligible = candidate.leaderRotationEligible === true;
      const score = clamp(
        (candidate.boardScore ?? seal) * 0.5 +
          seal * 0.18 +
          sectorScore(candidate, maps) * 0.18 +
          candidateFunds(candidate) * 0.09 +
          riskQuality(candidate) * 0.05 +
          (candidate.leaderRelationScore ?? 0) * 0.08 +
          capitalStyle.hotMoneyScore * 0.06 +
          (rotationEligible ? 10 : -24) +
          (capitalStyle.rotationFriendly ? 5 : -5) +
          (candidate.recentPosition?.status === "low"
            ? 8
            : candidate.recentPosition?.status === "high"
              ? -6
              : 0)
      );
      return {
        candidate,
        role: "board_alternative" as const,
        roleLabel: rotationEligible
          ? "同属性补涨备选"
          : candidate.leaderRelationQualified
            ? "同属性高位接力观察"
            : "独立强势观察",
        score,
        reasons: [
          candidate.auctionSeal?.label ?? "封单质量待盘口确认",
          `${capitalStyle.label} · 游资${capitalStyle.hotMoneyScore} / 机构${capitalStyle.institutionScore}`,
          candidate.leaderRelationLabel ?? "补涨属性待确认",
          candidate.recentPosition?.label ?? "10日位置待补全",
          `板块强度${Math.round(sectorScore(candidate, maps))}，${candidate.limitStreak}板`,
          rotationEligible && candidate.leaderSimilarity != null
            ? `${candidate.matchedLeader ?? "最高标"}启动形态${candidate.leaderSimilarity.toFixed(0)}%`
            : candidate.leaderRelationQualified
              ? "属性相关，但当前位置不适合低位补涨"
              : "属性关联不足，仅作独立强势观察"
        ]
      };
    })
    .sort((a, b) => {
      const relationOrder =
        Number(b.candidate.leaderRotationEligible) -
        Number(a.candidate.leaderRotationEligible);
      return relationOrder || b.score - a.score;
    })
    .slice(0, 6);
  const picks: Array<BoardPick | null> = [first, second, ...alternatives];
  return picks.filter(
    (item): item is BoardPick => item !== null
  );
}
