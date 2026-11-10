import type {
  AuctionSealLevel,
  AuctionSealStrength,
  StockQuoteDetail
} from "../types";

export interface AuctionSealCandidate {
  limit: number;
  floatCap: number;
  modelScore?: number;
  sectorLimitCount?: number;
  sectorStrongCount?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function levelFor(score: number, sealed: boolean): AuctionSealLevel {
  if (!sealed) return score >= 20 ? "watch" : "none";
  if (score >= 82) return "extreme";
  if (score >= 66) return "strong";
  if (score >= 48) return "sealed";
  return "watch";
}

function labelFor(
  level: AuctionSealLevel,
  sealed: boolean,
  floatCapRatio: number
) {
  const ratio = `${(floatCapRatio * 100).toFixed(2)}%流通市值`;
  if (level === "extreme") return `极强封单 · ${ratio}`;
  if (level === "strong") return `强封单 · ${ratio}`;
  if (level === "sealed") return `封板 · ${ratio}`;
  if (level === "watch") return sealed ? `封单观察 · ${ratio}` : "接近封板";
  return "未封板";
}

export function evaluateAuctionSeal(
  candidate: AuctionSealCandidate,
  quote: StockQuoteDetail
): AuctionSealStrength {
  const preClose = quote.preClose > 0 ? quote.preClose : 0;
  const limitPrice =
    preClose > 0
      ? Math.round(preClose * (1 + candidate.limit) * 100 + 0.00001) / 100
      : 0;
  const current = quote.price || quote.open || 0;
  const bid1Price = quote.bid1Price ?? 0;
  const bid1Lots = quote.bid1Lots ?? 0;
  const atLimit =
    limitPrice > 0 &&
    current >= limitPrice - 0.005 &&
    bid1Price >= limitPrice - 0.005 &&
    bid1Lots > 0;
  const sealAmount = atLimit ? bid1Lots * 100 * bid1Price : 0;
  const currentFloatCap =
    quote.floatCap > 0 ? quote.floatCap : candidate.floatCap;
  const floatCapRatio =
    currentFloatCap > 0 ? sealAmount / currentFloatCap : 0;
  const gapPct =
    preClose > 0 && quote.open > 0 ? quote.open / preClose - 1 : 0;
  const sectorStrength =
    clamp((candidate.sectorStrongCount ?? 0) / 4, 0, 1) * 0.55 +
    clamp((candidate.sectorLimitCount ?? 0) / 3, 0, 1) * 0.45;
  const score = atLimit
    ? clamp(
        10 +
          clamp(floatCapRatio / 0.05, 0, 1) * 32 +
          clamp(sealAmount / 200_000_000, 0, 1) * 26 +
          clamp(gapPct / 0.08, 0, 1) * 14 +
          clamp(quote.turnoverRate / 15, 0, 1) * 10 +
          sectorStrength * 8,
        0,
        100
      )
    : clamp(clamp(gapPct / 0.1, 0, 1) * 18, 0, 18);
  const level = levelFor(score, atLimit);
  return {
    sealed: atLimit,
    level,
    score,
    label: labelFor(level, atLimit, floatCapRatio),
    limitPrice,
    gapPct,
    bid1Price,
    bid1Lots,
    sealAmount,
    floatCapRatio,
    turnoverRate: quote.turnoverRate,
    observedAt: quote.updatedAt
  };
}

export function calculateBoardScore(
  candidate: AuctionSealCandidate,
  quote: StockQuoteDetail,
  seal: AuctionSealStrength,
  liveScore: number
) {
  const gapStrength =
    quote.preClose > 0 && candidate.limit > 0
      ? (quote.open / quote.preClose - 1) / candidate.limit
      : 0;
  const gapQuality = clamp(gapStrength, 0, 1) * 100;
  const sectorStrength =
    clamp((candidate.sectorStrongCount ?? 0) / 4, 0, 1) * 0.55 +
    clamp((candidate.sectorLimitCount ?? 0) / 3, 0, 1) * 0.45;
  const modelStrength = clamp((candidate.modelScore ?? 0) * 100, 0, 100);
  return clamp(
    seal.score * 0.62 +
      clamp(liveScore * 100, 0, 100) * 0.24 +
      modelStrength * 0.08 +
      gapQuality * 0.03 +
      sectorStrength * 100 * 0.03,
    0,
    100
  );
}
