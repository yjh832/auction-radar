function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sealLevel(score, sealed) {
  if (!sealed) return score >= 20 ? "watch" : "none";
  if (score >= 82) return "extreme";
  if (score >= 66) return "strong";
  if (score >= 48) return "sealed";
  return "watch";
}

function sealLabel(level, sealed, floatCapRatio) {
  const ratio = `${(floatCapRatio * 100).toFixed(2)}%流通市值`;
  if (level === "extreme") return `极强封单 · ${ratio}`;
  if (level === "strong") return `强封单 · ${ratio}`;
  if (level === "sealed") return `封板 · ${ratio}`;
  if (level === "watch") return sealed ? `封单观察 · ${ratio}` : "接近封板";
  return "未封板";
}

export function evaluateAuctionSeal(candidate, quote) {
  const preClose = Number(quote.preClose) > 0 ? Number(quote.preClose) : 0;
  const limitPrice =
    preClose > 0
      ? Math.round(preClose * (1 + candidate.limit) * 100 + 0.00001) / 100
      : 0;
  const current = Number(quote.price) || Number(quote.open) || 0;
  const bid1Price = Number(quote.bid1Price) || 0;
  const bid1Lots = Number(quote.bid1Lots) || 0;
  const sealed =
    limitPrice > 0 &&
    current >= limitPrice - 0.005 &&
    bid1Price >= limitPrice - 0.005 &&
    bid1Lots > 0;
  const sealAmount = sealed ? bid1Lots * 100 * bid1Price : 0;
  const floatCap =
    Number(quote.floatCap) > 0 ? Number(quote.floatCap) : candidate.floatCap;
  const floatCapRatio = floatCap > 0 ? sealAmount / floatCap : 0;
  const gapPct =
    preClose > 0 && Number(quote.open) > 0
      ? Number(quote.open) / preClose - 1
      : 0;
  const sectorStrength =
    clamp(Number(candidate.sectorStrongCount) / 4, 0, 1) * 0.55 +
    clamp(Number(candidate.sectorLimitCount) / 3, 0, 1) * 0.45;
  const score = sealed
    ? clamp(
        10 +
          clamp(floatCapRatio / 0.05, 0, 1) * 32 +
          clamp(sealAmount / 200_000_000, 0, 1) * 26 +
          clamp(gapPct / 0.08, 0, 1) * 14 +
          clamp(Number(quote.turnoverRate) / 15, 0, 1) * 10 +
          sectorStrength * 8,
        0,
        100
      )
    : clamp(clamp(gapPct / 0.1, 0, 1) * 18, 0, 18);
  const level = sealLevel(score, sealed);
  return {
    sealed,
    level,
    score,
    label: sealLabel(level, sealed, floatCapRatio),
    limitPrice,
    gapPct,
    bid1Price,
    bid1Lots,
    sealAmount,
    floatCapRatio,
    turnoverRate: Number(quote.turnoverRate) || 0,
    observedAt: quote.updatedAt || ""
  };
}

export function calculateBoardScore(candidate, quote, seal, liveScore) {
  const gapStrength =
    Number(quote.preClose) > 0 && candidate.limit > 0
      ? (Number(quote.open) / Number(quote.preClose) - 1) / candidate.limit
      : 0;
  const gapQuality = clamp(gapStrength, 0, 1) * 100;
  const sectorStrength =
    clamp(Number(candidate.sectorStrongCount) / 4, 0, 1) * 0.55 +
    clamp(Number(candidate.sectorLimitCount) / 3, 0, 1) * 0.45;
  const modelStrength = clamp(Number(candidate.modelScore) * 100, 0, 100);
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
