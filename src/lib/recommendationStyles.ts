import type { Candidate, ReviewMaps } from "../types";
import { isMainBoardCode } from "./universe";

export type RecommendationStyle = "trend" | "board";

export interface BoardPick {
  candidate: Candidate;
  role: "breakout_relay" | "strongest_seal";
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

function mergeLimitCandidate(
  seed: NonNullable<ReviewMaps["limitUps"]>[number],
  candidates: Candidate[],
  maps?: ReviewMaps | null
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
      boardScore: existing.boardScore ?? seed.boardScore
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
    history: [],
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
  maps?: ReviewMaps | null
): BoardPick[] {
  const marketLimitCandidates = (maps?.limitUps ?? [])
    .filter((seed) => isMainBoardCode(seed.code))
    .map((seed) => mergeLimitCandidate(seed, candidates, maps));
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
  const rotationCandidates = pool
    .filter((candidate) => candidate.limitStreak <= 2)
    .map((candidate) => {
      const seal = candidate.auctionSeal?.score ?? candidate.boardScore ?? 0;
      const funds = candidateFunds(candidate);
      const sector = sectorScore(candidate, maps);
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
      const score = clamp(
        lowPosition +
          seal * 0.33 +
          sector * 0.2 +
          funds * 0.18 +
          riskQuality(candidate) * 0.08 +
          (isBrokenSector ? 18 : isRelated ? 10 : 0)
      );
      return {
        candidate,
        role: "breakout_relay" as const,
        roleLabel:
          candidate.limitStreak === 1 ? "高低切首板" : "一进二接力",
        score,
        reasons: [
          isBrokenSector
            ? `高位股断板后同板块高低切，${candidate.industry}形成低位承接`
            : isRelated
              ? `与最高标/强势板块存在情绪关联，${candidate.industry}获资金关注`
              : `高位股断板后，低位${candidate.limitStreak}板中封板与资金综合最强`,
          candidate.auctionSeal?.label ?? "封板质量待盘口确认",
          `资金${funds >= 65 ? "承接较强" : "承接一般"}，板块强度${Math.round(sector)}`
        ]
      };
    })
    .sort((a, b) => b.score - a.score);

  const strongest = [...pool]
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
        `板块强度${Math.round(sectorScore(candidate, maps))}，${
          candidate.limitStreak >= 3 ? "高标情绪仍在延续" : "低位高度仍可拓展"
        }`,
        `模型精选分${candidate.recommendationScore?.toFixed(0) ?? "—"}`
      ]
    }));

  const first = rotationCandidates[0] ?? strongest[0] ?? null;
  const second =
    strongest.find((item) => item.candidate.code !== first?.candidate.code) ??
    rotationCandidates.find(
      (item) => item.candidate.code !== first?.candidate.code
    ) ??
    null;
  return [first, second].filter((item): item is BoardPick => Boolean(item));
}
