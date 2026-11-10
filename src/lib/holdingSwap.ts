import type {
  Candidate,
  HoldingSnapshot,
  RiskLevel
} from "../types";

export type HoldingSwapAction =
  | "hold"
  | "reduce"
  | "observe_switch"
  | "switch_partial";

export interface HoldingSwapMarket {
  key: string;
  label: string;
  liveEligible: boolean;
  clock: {
    date: string;
    time: string;
    minutes: number;
  };
}

export interface HoldingSwapCandidatePlan {
  candidate: Candidate;
  rankLabel: string;
  score: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  target: number;
  confirmed: boolean;
  rejection: string | null;
}

export interface HoldingSwapPlan {
  holdingCode: string;
  holdingName: string;
  holdingScore: number;
  holdingSignal: string;
  holdingPnlPct: number;
  holdingDayPct: number;
  holdingStop: number;
  holdingTakeProfit: number;
  holdingRisk: RiskLevel;
  holdingRisks: string[];
  candidate: HoldingSwapCandidatePlan | null;
  edge: number;
  swapScore: number;
  action: HoldingSwapAction;
  actionLabel: string;
  decision: string;
  timing: string;
  conditions: string[];
  holdingCoverage: number;
  dimensions: Array<{
    key: string;
    label: string;
    holding: number;
    candidate: number;
  }>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizedPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 0;
  return clamp(value <= 1 ? value * 100 : value, 0, 100);
}

function candidateStrength(
  candidate: Candidate,
  market: HoldingSwapMarket
) {
  const breakdown = candidate.scoreBreakdown;
  const quality =
    candidate.qualityScore ??
    normalizedPercent(candidate.reviewScore ?? candidate.compositeScore);
  const recommendation =
    candidate.recommendationScore ??
    (normalizedPercent(candidate.reviewScore) * 0.55 +
      normalizedPercent(candidate.compositeScore) * 0.45);
  const board = candidate.boardScore ?? candidate.auctionSeal?.score ?? 0;
  let score = clamp(
    recommendation * 0.55 +
      quality * 0.2 +
      board * 0.15 +
      (breakdown?.sector ?? quality) * 0.1,
    0,
    100
  );
  if (market.liveEligible && candidate.liveEligible === false) score -= 24;
  return {
    score: clamp(score, 0, 100),
    dimensions: {
      trend: breakdown?.momentum ?? quality,
      intraday: breakdown
        ? breakdown.auction * 0.55 + breakdown.seal * 0.45
        : 50,
      seal: breakdown?.seal ?? board,
      liquidity: breakdown?.liquidity ?? 50,
      relative: breakdown?.sector ?? 50,
      risk: breakdown?.risk ?? (candidate.riskLevel === "low" ? 82 : candidate.riskLevel === "medium" ? 60 : 28),
      model: breakdown
        ? breakdown.model * 0.55 + breakdown.review * 0.45
        : quality
    }
  };
}

function holdingStrength(
  snapshot: HoldingSnapshot,
  candidatePool: Candidate[]
) {
  const { quote, signal, anomalyRisk } = snapshot;
  const closePosition =
    quote.high > quote.low
      ? (quote.price - quote.low) / (quote.high - quote.low)
      : 0.5;
  const technical = snapshot.technical;
  const trend = technical
    ? clamp(
        50 +
          (quote.price >= technical.ma5 ? 9 : -9) +
          (quote.price >= technical.ma20 ? 10 : -10) +
          clamp(technical.ret5 * 100, -12, 12) +
          clamp(technical.ret10 * 60, -10, 10),
        0,
        100
      )
    : 50;
  const intraday = clamp(
    50 +
      clamp(quote.changePct * 1.1, -10, 10) +
      (quote.price >= snapshot.avgPrice ? 8 : -8) +
      clamp((closePosition - 0.5) * 18, -7, 7),
    0,
    100
  );
  const position = clamp(50 + snapshot.pnlPct * 90, 10, 90);
  const seal = snapshot.auctionSeal?.sealed
    ? snapshot.auctionSeal.score
    : 35;
  const liquidity = clamp(
    clamp(quote.volumeRatio / 2.5, 0, 1) * 65 +
      clamp(quote.turnoverRate / 18, 0, 1) * 35,
    0,
    100
  );
  const relative = snapshot.benchmark
    ? clamp(
        50 +
          (quote.changePct - snapshot.benchmark.quote.changePct) * 5,
        0,
        100
      )
    : 50;

  const signalAdjustment: Partial<Record<HoldingSnapshot["signal"]["kind"], number>> = {
    stop: -28,
    distribution: -24,
    reduce: -16,
    limit_seal: 18,
    add: 9,
    breakout: 8,
    washout: 4,
    take_profit: 3,
    watch: -5,
    hold: 1
  };
  let risk = 78 + (signalAdjustment[signal.kind] ?? 0);
  if (anomalyRisk?.status === "breached") risk -= 30;
  else if (anomalyRisk?.status === "near") risk -= 15;
  else if (anomalyRisk?.status === "watch") risk -= 6;
  if (
    snapshot.reviewAdvice?.kind === "stop" ||
    snapshot.reviewAdvice?.kind === "distribution"
  ) {
    risk -= 10;
  } else if (snapshot.reviewAdvice?.kind === "reduce") {
    risk -= 6;
  }
  const inCorePool = candidatePool.some(
    (candidate) => candidate.code === snapshot.position.code
  );
  const ownedCandidate = candidatePool.find(
    (candidate) => candidate.code === snapshot.position.code
  );
  const modelFit = inCorePool
    ? normalizedPercent(
        ownedCandidate?.recommendationScore ??
          ownedCandidate?.reviewScore ??
          ownedCandidate?.compositeScore
      )
    : 45;
  risk = clamp(risk, 0, 100);
  const score = clamp(
    trend * 0.18 +
      intraday * 0.15 +
      position * 0.12 +
      seal * 0.17 +
      liquidity * 0.08 +
      relative * 0.1 +
      risk * 0.12 +
      modelFit * 0.08,
    0,
    100
  );
  return {
    score,
    coverage: [
      Boolean(technical),
      Boolean(snapshot.benchmark),
      Boolean(snapshot.auctionSeal),
      quote.volumeLots > 0,
      Boolean(ownedCandidate)
    ].filter(Boolean).length / 5,
    dimensions: {
      trend,
      intraday,
      seal,
      liquidity,
      relative,
      risk,
      model: modelFit
    }
  };
}

function candidateTradePlan(candidate: Candidate) {
  const reference =
    candidate.live?.current && candidate.live.current > 0
      ? candidate.live.current
      : candidate.close;
  const recent = candidate.history
    .slice(-10)
    .map((item) => Number(item.close))
    .filter((value) => value > 0);
  const support = recent.length
    ? Math.min(...recent.slice(-5))
    : reference * 0.97;
  const entryLow = Math.max(support, reference * 0.985);
  const entryHigh = Math.max(entryLow + 0.01, reference * 1.02);
  const stop = Math.min(support * 0.99, entryLow * 0.97);
  const target = Math.max(
    entryHigh * 1.06,
    entryHigh + (entryHigh - stop) * 1.8
  );
  return { entryLow, entryHigh, stop, target };
}

function actionCopy(
  action: HoldingSwapAction,
  holding: HoldingSnapshot,
  candidate: HoldingSwapCandidatePlan | null,
  edge: number
) {
  if (holding.signal.kind === "limit_seal") {
    return {
      label: "强封持有",
      decision:
        "持仓呈现高开且大封单特征，优先尊重当前强势结构，不因另一个候选的静态分而机械换股。",
      timing: "观察封单是否持续；若封单快速衰减或跌破分时均价，再重新比较"
    };
  }
  if (action === "reduce") {
    return {
      label: "风险优先",
      decision: holding.anomalyRisk?.status === "breached"
        ? "持仓已触及异动风险线，先降低风险暴露；推荐票也必须通过竞价和开盘承接后才考虑承接资金。"
        : "持仓出现止损或转弱信号，先执行持仓风控，不用未确认的推荐票直接替换。",
      timing: "先处理持仓风险，9:25和9:35确认后再讨论换股"
    };
  }
  if (action === "switch_partial" && candidate) {
    return {
      label: "确认后分批换",
      decision: `推荐${candidate.rankLabel}${candidate.candidate.name}的量化强度高出持仓 ${Math.max(0, edge).toFixed(0)} 分，采用先换一部分、保留一部分的两步方案。`,
      timing: "9:25看竞价，9:35看承接；两项同时通过才分批置换"
    };
  }
  if (action === "observe_switch" && candidate) {
    return {
      label: "换股观察",
      decision: `推荐${candidate.rankLabel}${candidate.candidate.name}有一定优势，但尚未达到直接置换门槛，先保持原持仓并观察确认条件。`,
      timing: "竞价与开盘承接确认前不主动追换"
    };
  }
  return {
    label: "维持持仓",
    decision: candidate
      ? `推荐${candidate.rankLabel}${candidate.candidate.name}相对优势不足，继续按原持仓的止盈止损纪律管理。`
      : "当前首选和候选池均已持有或没有更合适的未持有标的，继续管理原持仓。",
    timing: "按持仓止损、止盈与异动红线执行"
  };
}

export function buildHoldingSwapPlans(
  snapshots: HoldingSnapshot[],
  candidates: Candidate[],
  market: HoldingSwapMarket
): HoldingSwapPlan[] {
  const heldCodes = new Set(
    snapshots.map((snapshot) => snapshot.position.code)
  );
  const corePool = candidates.slice(0, 6);
  const externalPool = corePool.flatMap((candidate, index) =>
    heldCodes.has(candidate.code) ? [] : [{ candidate, index }]
  );

  return snapshots.map((holding) => {
    const candidate = externalPool
      .map((item) => ({
        ...item,
        strength: candidateStrength(item.candidate, market)
      }))
      .sort((a, b) => b.strength.score - a.strength.score)[0] ?? null;
    const holdingStrengthResult = holdingStrength(holding, corePool);
    const holdingScore = holdingStrengthResult.score;
    const candidatePlan = candidate
      ? (() => {
          const tradePlan = candidateTradePlan(candidate.candidate);
          const rejection =
            market.liveEligible && candidate.candidate.liveEligible === false
              ? candidate.candidate.liveReason ?? "竞价硬条件未通过"
              : null;
          return {
            candidate: candidate.candidate,
            rankLabel:
              candidate.index === 0
                ? "首选"
                : candidate.index === 1
                  ? "备选"
                  : `候选${candidate.index + 1}`,
            score: candidate.strength.score,
            ...tradePlan,
            confirmed: !rejection,
            rejection
          };
        })()
      : null;
    const edge = candidatePlan ? candidatePlan.score - holdingScore : 0;
    const candidateDimensions = candidate?.strength.dimensions ?? {
      trend: 50,
      intraday: 50,
      seal: 0,
      liquidity: 50,
      relative: 50,
      risk: 50,
      model: 50
    };
    const dimensions = [
      ["trend", "趋势动量"],
      ["intraday", "竞价分时"],
      ["seal", "封单强度"],
      ["liquidity", "资金流动"],
      ["relative", "板块相对"],
      ["risk", "风险质量"],
      ["model", "模型匹配"]
    ].map(([key, label]) => ({
      key,
      label,
      holding:
        holdingStrengthResult.dimensions[
          key as keyof typeof holdingStrengthResult.dimensions
        ],
      candidate:
        candidateDimensions[
          key as keyof typeof candidateDimensions
        ]
    }));
    const severeRisk =
      holding.signal.kind === "stop" ||
      holding.signal.kind === "distribution" ||
      holding.anomalyRisk?.status === "breached";
    const riskBoost = severeRisk
      ? 14
      : holding.signal.kind === "reduce" ||
          holding.anomalyRisk?.status === "near"
        ? 7
        : 0;
    let swapScore = candidatePlan
      ? clamp(50 + edge * 1.8 + riskBoost, 0, 100)
      : severeRisk
        ? 76
        : holding.signal.kind === "reduce"
          ? 61
          : 42;
    if (candidatePlan?.rejection) swapScore = Math.min(swapScore, 54);

    let action: HoldingSwapAction;
    if (holding.signal.kind === "limit_seal" && !severeRisk) {
      action = "hold";
      swapScore = Math.min(swapScore, 45);
    } else if (severeRisk) {
      action = "reduce";
    } else if (!candidatePlan || candidatePlan.rejection) {
      action = swapScore >= 58 ? "observe_switch" : "hold";
    } else if (swapScore >= 76) {
      action = "switch_partial";
    } else if (swapScore >= 58) {
      action = "observe_switch";
    } else {
      action = "hold";
    }

    const copy = actionCopy(action, holding, candidatePlan, edge);
    const highRisk =
      severeRisk ||
      holding.anomalyRisk?.status === "near" ||
      holding.reviewAdvice?.kind === "stop" ||
      holding.reviewAdvice?.kind === "distribution";
    const mediumRisk =
      holding.signal.kind === "reduce" ||
      holding.signal.kind === "watch" ||
      holding.anomalyRisk?.status === "watch";
    const holdingRisks = [
      holding.signal.title,
      holding.anomalyRisk?.status === "breached"
        ? holding.anomalyRisk.label
        : null,
      holding.reviewAdvice?.title ?? null
    ].filter((item): item is string => Boolean(item));
    const conditions = candidatePlan
      ? [
          `9:25：${candidatePlan.candidate.name}不接近一字板，竞价量能通过，观察区 ${candidatePlan.entryLow.toFixed(2)}—${candidatePlan.entryHigh.toFixed(2)}`,
          `9:35：${candidatePlan.candidate.name}保持开盘价与分时均价上方；若冲高回落则取消换股`,
          `${holding.position.name}跌破 ${holding.stopPrice.toFixed(2)} 或失守分时均价时，才执行已确认的分批置换`,
          `若持仓重新站回分时均价或推荐票被否决，则维持持仓，不为了换而换`
        ]
      : [
          `${holding.position.name}止损参考 ${holding.stopPrice.toFixed(2)}`,
          `第一止盈参考 ${holding.takeProfitPrice.toFixed(2)}`,
          "当前没有未持有且更强的新推荐，不进行无优势换股"
        ];

    return {
      holdingCode: holding.position.code,
      holdingName: holding.position.name,
      holdingScore,
      holdingSignal: holding.signal.title,
      holdingPnlPct: holding.pnlPct,
      holdingDayPct: holding.dayPct,
      holdingStop: holding.stopPrice,
      holdingTakeProfit: holding.takeProfitPrice,
      holdingRisk: highRisk ? "high" : mediumRisk ? "medium" : "low",
      holdingRisks,
      candidate: candidatePlan,
      edge,
      swapScore,
      action,
      actionLabel: copy.label,
      decision: copy.decision,
      timing: copy.timing,
      conditions,
      holdingCoverage: holdingStrengthResult.coverage,
      dimensions
    };
  });
}
