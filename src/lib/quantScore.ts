import type { Candidate } from "../types";

export interface CandidateQuantScore {
  recommendationScore: number;
  qualityScore: number;
  executionScore: number;
  scoreCoverage: number;
  scoreBreakdown: NonNullable<Candidate["scoreBreakdown"]>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalized(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 0;
  return clamp(value <= 1 ? value * 100 : value, 0, 100);
}

function riskScore(candidate: Candidate) {
  let score =
    candidate.riskLevel === "low"
      ? 86
      : candidate.riskLevel === "medium"
        ? 62
        : 28;
  if (candidate.anomaly?.regulatoryStatus === "abnormal") score -= 24;
  else if (candidate.anomaly?.regulatoryStatus === "watch") score -= 9;
  const distance = candidate.anomaly?.distanceToThreshold;
  if (distance != null && distance < 0.03) score -= 12;
  else if (distance != null && distance < 0.08) score -= 5;
  if ((candidate.ret10 ?? 0) > 0.35) score -= 10;
  return clamp(score, 0, 100);
}

export function calculateCandidateQuantScore(
  candidate: Candidate
): CandidateQuantScore {
  const model = normalized(candidate.modelScore);
  const review = normalized(
    candidate.reviewScore ??
      candidate.mapScores?.total ??
      candidate.compositeScore
  );
  const auction = candidate.live
    ? normalized(candidate.live.liveScore)
    : 50;
  const seal = candidate.auctionSeal?.score ?? 0;
  const sector =
    clamp(candidate.sectorLimitCount / 3, 0, 1) * 55 +
    clamp(candidate.sectorStrongCount / 5, 0, 1) * 45;
  const amountRatio =
    candidate.amountEst / Math.max(candidate.avg5Amount || 1, 1);
  const liquidity =
    clamp(amountRatio / 1.5, 0, 1) * 55 +
    clamp(candidate.volRatio / 3, 0, 1) * 45;
  const momentum = clamp(
    50 +
      clamp((candidate.ret5 ?? 0) * 150, -20, 20) +
      clamp((candidate.ret10 ?? 0) * 80, -15, 15) -
      clamp(((candidate.ret10 ?? 0) - 0.25) * 100, 0, 18),
    0,
    100
  );
  const risk = riskScore(candidate);
  const lhb = candidate.reviewTags?.some((tag) => tag.includes("龙虎榜净买"))
    ? 82
    : candidate.reviewTags?.some((tag) => tag.includes("龙虎榜净卖"))
      ? 34
      : 50;

  const qualityScore = clamp(
    model * 0.28 +
      review * 0.22 +
      sector * 0.13 +
      liquidity * 0.12 +
      momentum * 0.1 +
      risk * 0.1 +
      lhb * 0.05,
    0,
    100
  );
  const gapStrength = candidate.live?.gapStrength;
  const gapFit =
    gapStrength == null
      ? 50
      : (1 - clamp(Math.abs(gapStrength - 0.38) / 0.38, 0, 1)) * 100;
  const executionScore = clamp(
    auction * 0.45 + seal * 0.35 + gapFit * 0.1 + risk * 0.1,
    0,
    100
  );
  const hasExecutionData = Boolean(candidate.live || candidate.auctionSeal);
  const recommendationScore = hasExecutionData
    ? clamp(qualityScore * 0.62 + executionScore * 0.38, 0, 100)
    : qualityScore;
  const available = [
    model > 0,
    review > 0,
    Boolean(candidate.live),
    Boolean(candidate.auctionSeal),
    candidate.sectorN > 0,
    candidate.avg5Amount > 0,
    candidate.history.length > 3,
    true
  ].filter(Boolean).length;

  return {
    recommendationScore,
    qualityScore,
    executionScore,
    scoreCoverage: available / 8,
    scoreBreakdown: {
      model,
      review,
      auction,
      seal,
      sector,
      liquidity,
      momentum,
      risk,
      lhb
    }
  };
}
