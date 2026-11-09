const DEFAULT_WEIGHTS = {
  gene: 0.205987,
  limit_today: 0.0568,
  limit_streak: 0.170636,
  close_pos: 0.204156,
  vol_ratio: 0.105847,
  sector_heat: 0.199509,
  near_high20: 0.050234,
  momentum: 0.006832
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function correlation(left, right) {
  if (left.length !== right.length || left.length < 3) return 0;
  const leftMean = average(left);
  const rightMean = average(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  if (leftVariance <= 1e-10 || rightVariance <= 1e-10) return 0;
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

function limitForCode(code) {
  return code.startsWith("30") || code.startsWith("68") ? 0.2 : 0.1;
}

export function candidateFactorScores(candidate) {
  return {
    gene: clamp(
      (Math.max(0, candidate.limit20 ?? 0) / 8) * 0.65 +
        (Math.max(0, candidate.limit60 ?? 0) / 16) * 0.35
    ),
    limit_today: candidate.limitToday ? 1 : 0,
    limit_streak: clamp(
      Math.log1p(Math.max(0, candidate.limitStreak ?? 0)) / Math.log(7)
    ),
    close_pos: clamp(candidate.closePos ?? 0.5),
    vol_ratio: clamp((candidate.volRatio ?? 0) / 3),
    sector_heat: clamp(
      (Math.max(0, candidate.sectorStrongCount ?? 0) / 5) * 0.55 +
        (Math.max(0, candidate.sectorLimitCount ?? 0) / 3) * 0.45
    ),
    near_high20: clamp(candidate.nearHigh20 ?? 0),
    momentum: clamp(((candidate.ret5 ?? 0) + 0.08) / 0.42)
  };
}

export function weightedFactorScore(candidate, weights) {
  const factors = candidateFactorScores(candidate);
  return clamp(
    Object.entries(weights).reduce((sum, [name, weight]) => {
      return sum + (factors[name] ?? 0) * weight;
    }, 0)
  );
}

export function adaptModelWeights({
  previousCandidates,
  quotes,
  previousWeights,
  previousDate,
  date,
  previousAdaptation
}) {
  const weights = Object.fromEntries(
    Object.keys(DEFAULT_WEIGHTS).map((name) => [
      name,
      Number(previousWeights?.[name] ?? DEFAULT_WEIGHTS[name])
    ])
  );
  const allReturns = [...quotes.values()].flatMap((quote) =>
    quote.preClose > 0 && quote.current > 0
      ? [quote.current / quote.preClose - 1]
      : []
  );
  const marketReturn = average(allReturns);
  const samples = previousCandidates.flatMap((candidate) => {
    const quote = quotes.get(candidate.code);
    if (!quote || candidate.close <= 0 || quote.current <= 0) return [];
    const limit = limitForCode(candidate.code);
    const dayReturn = quote.current / candidate.close - 1;
    const highReturn = quote.high / candidate.close - 1;
    const touchedLimit = highReturn >= limit - 0.005;
    const closedLimit = dayReturn >= limit - 0.011;
    return [{
      code: candidate.code,
      name: candidate.name,
      return: dayReturn,
      relativeReturn: dayReturn - marketReturn,
      touchedLimit,
      closedLimit,
      factors: candidateFactorScores(candidate)
    }];
  });

  if (samples.length < 4 || !previousDate || previousDate >= date) {
    return {
      weights,
      adaptation: previousAdaptation ?? null,
      samples,
      updated: false
    };
  }

  const outcomes = samples.map(
    (sample) =>
      sample.relativeReturn * 0.72 +
      (sample.touchedLimit ? 0.035 : 0) +
      (sample.closedLimit ? 0.055 : 0)
  );
  const correlations = {};
  const weightChanges = {};
  const nextWeights = { ...weights };
  const learningRate = 0.018;
  for (const factor of Object.keys(DEFAULT_WEIGHTS)) {
    const values = samples.map((sample) => sample.factors[factor] ?? 0);
    const nextCorrelation = correlation(values, outcomes);
    correlations[factor] = Number(nextCorrelation.toFixed(4));
    const delta = clamp(nextCorrelation * learningRate, -0.012, 0.012);
    weightChanges[factor] = Number(delta.toFixed(6));
    nextWeights[factor] = Math.max(0.02, weights[factor] + delta);
  }
  const total = Object.values(nextWeights).reduce(
    (sum, value) => sum + value,
    0
  );
  for (const factor of Object.keys(nextWeights)) {
    nextWeights[factor] = Number(
      (nextWeights[factor] / Math.max(total, 1e-9)).toFixed(6)
    );
  }

  const hitRate =
    samples.filter((sample) => sample.return > 0).length / samples.length;
  const avgReturn = average(samples.map((sample) => sample.return));
  const touchedLimitRate =
    samples.filter((sample) => sample.touchedLimit).length / samples.length;
  const closedLimitRate =
    samples.filter((sample) => sample.closedLimit).length / samples.length;
  const record = {
    date,
    sampleDate: previousDate,
    sampleSize: samples.length,
    hitRate: Number(hitRate.toFixed(4)),
    avgReturn: Number(avgReturn.toFixed(4)),
    touchedLimitRate: Number(touchedLimitRate.toFixed(4)),
    closedLimitRate: Number(closedLimitRate.toFixed(4)),
    factorCorrelations: correlations,
    weightChanges,
    evaluated: samples.map(({ code, name, return: value, touchedLimit, closedLimit }) => ({
      code,
      name,
      return: Number(value.toFixed(4)),
      touchedLimit,
      closedLimit
    })),
    note: "仅使用前一交易日入选标的的次日表现做轻量权重修正，避免小样本过度拟合。"
  };
  const history = Array.isArray(previousAdaptation?.history)
    ? [...previousAdaptation.history, record].slice(-20)
    : [record];
  return {
    weights: nextWeights,
    adaptation: {
      method: "previous-day-factor-correlation",
      latest: record,
      history
    },
    samples,
    updated: true
  };
}
