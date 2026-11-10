import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Briefcase,
  Link2,
  Plus,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Trash2
} from "lucide-react";
import type {
  CapitalFlowRecommendation
} from "./CapitalFlowDrawer";
import { DeviceSyncDialog } from "./DeviceSyncDialog";
import {
  createHoldingTrade,
  ensureOpeningTrades,
  loadHoldingTrades,
  saveHoldingTrades
} from "../lib/capitalFlow";
import {
  evaluateHolding,
  buildHoldingReviewAdvice,
  createHoldingTick,
  detectRapidMove,
  loadHoldings,
  notifyHoldingSignal,
  notifyHoldingAdvice,
  requestNotificationPermission,
  saveHoldings,
  showHoldingTestNotification
} from "../lib/holdings";
import type { HoldingTick } from "../lib/holdings";
import {
  benchmarkForCode,
  detectMarketStatus,
  fetchHoldingBenchmark,
  fetchHoldingQuotes,
  fetchHoldingTechnical
} from "../lib/market";
import { buildAnomalyFromHistory } from "../lib/anomaly";
import { buildHoldingAnomalyRisk } from "../lib/indexAnomaly";
import type {
  Candidate,
  CandidateAnomaly,
  HoldingAnomalyRisk,
  HoldingBenchmark,
  HoldingPosition,
  HoldingSnapshot,
  HoldingTechnicalProfile,
  HoldingTradeRecord,
  StrategyDashboard
} from "../types";

const ENABLED_KEY = "auction-radar:holdings-monitor-enabled:v1";
const CapitalFlowDrawer = lazy(() =>
  import("./CapitalFlowDrawer").then((module) => ({
    default: module.CapitalFlowDrawer
  }))
);
const HoldingRotationPanel = lazy(() =>
  import("./HoldingRotationPanel").then((module) => ({
    default: module.HoldingRotationPanel
  }))
);

function pct(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function money(value: number) {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)}万`;
  return value.toFixed(2);
}

function chinaTradeDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function signalClass(kind: HoldingSnapshot["signal"]["kind"]) {
  if (kind === "stop" || kind === "distribution") return "is-stop";
  if (kind === "take_profit") return "is-take";
  if (kind === "reduce") return "is-reduce";
  if (kind === "add" || kind === "washout" || kind === "breakout") return "is-add";
  return "is-hold";
}

function anomalyStatusText(status: HoldingAnomalyRisk["status"]) {
  if (status === "breached") return "红线已触发";
  if (status === "near") return "逼近红线";
  if (status === "watch") return "观察区";
  return "风险可控";
}

function HoldingCard({
  snapshot,
  onChange,
  onDelete,
  onOpen
}: {
  snapshot: HoldingSnapshot;
  onChange: (position: HoldingPosition) => void;
  onDelete: (code: string) => void;
  onOpen: () => void;
}) {
  const { position, quote } = snapshot;
  const [editing, setEditing] = useState(false);

  return (
    <article
      className={`holding-card ${signalClass(snapshot.signal.kind)}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <header>
        <div>
          <span>{position.code}</span>
          <h4>{quote.name || position.name}</h4>
        </div>
        <div className={`holding-signal holding-signal--${snapshot.signal.kind}`}>
          {snapshot.signal.title}
        </div>
      </header>

      <div className="holding-price-row">
        <strong>{quote.price.toFixed(2)}</strong>
        <span className={quote.changePct >= 0 ? "is-up" : "is-down"}>
          {quote.changePct >= 0 ? "+" : ""}
          {quote.changePct.toFixed(2)}%
        </span>
        <em className={snapshot.pnlPct >= 0 ? "is-up" : "is-down"}>
          持仓 {pct(snapshot.pnlPct)} · {snapshot.pnl >= 0 ? "+" : ""}
          {money(snapshot.pnl)}
        </em>
      </div>

      <div className="holding-stats">
        <div><span>持仓市值</span><strong>{money(snapshot.marketValue)}</strong></div>
        <div><span>分时均价</span><strong>{snapshot.avgPrice.toFixed(2)}</strong></div>
        <div><span>量比</span><strong>{quote.volumeRatio.toFixed(2)}</strong></div>
        <div><span>距日内高点</span><strong>{pct(snapshot.drawdownFromHigh)}</strong></div>
      </div>

      {snapshot.anomalyRisk && (
        <section
          className={`holding-anomaly-risk holding-anomaly-risk--${snapshot.anomalyRisk.status}`}
          aria-label={`${snapshot.position.name}异动偏离预警`}
        >
          <header>
            <span>10日异动偏离 / 对应{snapshot.anomalyRisk.benchmarkName}</span>
            <strong>{anomalyStatusText(snapshot.anomalyRisk.status)}</strong>
          </header>
          <div className="holding-anomaly-metrics">
            <div>
              <span>10日累计偏离</span>
              <strong>{pct(snapshot.anomalyRisk.tenDayDeviation)}</strong>
            </div>
            <div>
              <span>距100%红线</span>
              <strong>{pct(snapshot.anomalyRisk.tenDayRemaining)}</strong>
            </div>
            <div>
              <span>当日偏离</span>
              <strong>{pct(snapshot.anomalyRisk.currentDayDeviation)}</strong>
            </div>
            <div>
              <span>今日10日红线价</span>
              <strong>
                {snapshot.anomalyRisk.tenDayRedLinePrice?.toFixed(2) ?? "—"}
              </strong>
            </div>
            <div>
              <span>明日红线价*</span>
              <strong>
                {snapshot.anomalyRisk.nextDayTenDayRedLinePrice?.toFixed(2) ??
                  "—"}
              </strong>
            </div>
            <div>
              <span>30日累计偏离</span>
              <strong>{pct(snapshot.anomalyRisk.thirtyDayDeviation)}</strong>
            </div>
            <div>
              <span>距200%红线</span>
              <strong>{pct(snapshot.anomalyRisk.thirtyDayRemaining)}</strong>
            </div>
            <div>
              <span>今日30日红线价</span>
              <strong>
                {snapshot.anomalyRisk.thirtyDayRedLinePrice?.toFixed(2) ?? "—"}
              </strong>
            </div>
          </div>
          <p>{snapshot.anomalyRisk.action}</p>
          <small>
            *明日红线价按指数平盘估算；最终以交易所异动认定为准。
          </small>
        </section>
      )}

      <p className="holding-signal-detail">{snapshot.signal.detail}</p>
      <div className="holding-price-plan">
        <div><span>止损参考</span><strong>{snapshot.stopPrice.toFixed(2)}</strong></div>
        <div><span>第一止盈</span><strong>{snapshot.takeProfitPrice.toFixed(2)}</strong></div>
        <div>
          <span>延伸止盈</span>
          <strong>{snapshot.takeProfitStretch?.toFixed(2) ?? "—"}</strong>
        </div>
      </div>
      {snapshot.reviewAdvice && (
        <div className={`holding-review-advice holding-review-advice--${snapshot.reviewAdvice.kind}`}>
          <span>复盘 / 竞价建议</span>
          <strong>{snapshot.reviewAdvice.title}</strong>
          <p>{snapshot.reviewAdvice.detail}</p>
        </div>
      )}
      {snapshot.signals.length > 1 && (
        <div className="holding-secondary-signals">
          {snapshot.signals
            .filter((signal) => signal.kind !== snapshot.signal.kind)
            .slice(0, 2)
            .map((signal) => (
              <span key={`${signal.kind}-${signal.title}`}>{signal.title}</span>
            ))}
        </div>
      )}

      {editing && (
        <div
          className="holding-edit-grid"
          onClick={(event) => event.stopPropagation()}
        >
          <label>
            成本
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={position.cost}
              onChange={(event) =>
                onChange({ ...position, cost: Number(event.target.value) || 0 })
              }
            />
          </label>
          <label>
            股数
            <input
              type="number"
              min="1"
              step="100"
              value={position.shares}
              onChange={(event) =>
                onChange({ ...position, shares: Number(event.target.value) || 0 })
              }
            />
          </label>
          <label>
            止损 %
            <input
              type="number"
              min="1"
              max="30"
              step="0.5"
              value={position.stopLossPct}
              onChange={(event) =>
                onChange({
                  ...position,
                  stopLossPct: Number(event.target.value) || 7
                })
              }
            />
          </label>
          <label>
            止盈 %
            <input
              type="number"
              min="1"
              max="100"
              step="0.5"
              value={position.takeProfitPct}
              onChange={(event) =>
                onChange({
                  ...position,
                  takeProfitPct: Number(event.target.value) || 12
                })
              }
            />
          </label>
        </div>
      )}

      <footer onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => setEditing((value) => !value)}>
          {editing ? "完成调整" : "调整参数"}
        </button>
        <button
          type="button"
          className="holding-delete"
          onClick={() => onDelete(position.code)}
          aria-label={`删除${position.name}持仓`}
        >
          <Trash2 size={14} />
          删除
        </button>
      </footer>
    </article>
  );
}

export function HoldingsMonitor({
  strategy,
  recommendedCandidates,
  onOpenStock
}: {
  strategy: StrategyDashboard;
  recommendedCandidates: Candidate[];
  onOpenStock: (candidate: Candidate) => void;
}) {
  const [positions, setPositions] = useState<HoldingPosition[]>(loadHoldings);
  const [trades, setTrades] = useState<HoldingTradeRecord[]>(loadHoldingTrades);
  const [snapshots, setSnapshots] = useState<HoldingSnapshot[]>([]);
  const [code, setCode] = useState("");
  const [cost, setCost] = useState("");
  const [shares, setShares] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(() =>
    window.location.hash.includes("holdings-sync=")
  );
  const [capitalFlowOpen, setCapitalFlowOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [monitoringEnabled, setMonitoringEnabled] = useState(() => {
    try {
      return localStorage.getItem(ENABLED_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [permission, setPermission] = useState(() =>
    "Notification" in window ? Notification.permission : "unsupported"
  );
  const tickHistory = useRef<Map<string, HoldingTick[]>>(new Map());
  const technicalCache = useRef<Map<string, HoldingTechnicalProfile>>(new Map());
  const technicalAttempts = useRef<Set<string>>(new Set());
  const benchmarkCache = useRef<Map<string, HoldingBenchmark>>(new Map());
  const benchmarkAttempts = useRef<Set<string>>(new Set());

  useEffect(() => {
    saveHoldings(positions);
  }, [positions]);

  useEffect(() => {
    saveHoldingTrades(trades);
  }, [trades]);

  useEffect(() => {
    try {
      localStorage.setItem(ENABLED_KEY, monitoringEnabled ? "1" : "0");
    } catch {
      // Preference persistence is optional.
    }
  }, [monitoringEnabled]);

  async function refresh(list = positions) {
    if (!list.length) {
      setSnapshots([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const missingTechnical = list.filter(
        (position) =>
          !technicalCache.current.has(position.code) &&
          !technicalAttempts.current.has(position.code)
      );
      if (missingTechnical.length) {
        await Promise.allSettled(
          missingTechnical.map(async (position) => {
            technicalAttempts.current.add(position.code);
            try {
              const technical = await fetchHoldingTechnical(position.code);
              technicalCache.current.set(position.code, technical);
            } catch {
              // Cost-based alerts remain available without K-line support.
            }
          })
        );
      }
      const missingBenchmarkCodes = list.filter(
        (position) =>
          !benchmarkCache.current.has(position.code) &&
          !benchmarkAttempts.current.has(position.code)
      );
      const benchmarkGroups = new Map<string, string[]>();
      for (const position of missingBenchmarkCodes) {
        const config = benchmarkForCode(position.code);
        const group = benchmarkGroups.get(config.symbol) ?? [];
        group.push(position.code);
        benchmarkGroups.set(config.symbol, group);
      }
      if (benchmarkGroups.size) {
        await Promise.allSettled(
          [...benchmarkGroups.entries()].map(async ([symbol, codes]) => {
            for (const positionCode of codes) {
              benchmarkAttempts.current.add(positionCode);
            }
            try {
              const benchmark = await fetchHoldingBenchmark(codes[0]);
              for (const positionCode of codes) {
                benchmarkCache.current.set(positionCode, benchmark);
              }
            } catch {
              // The cost-based monitor still works when the benchmark is unavailable.
            }
          })
        );
      }
      const quotes = await fetchHoldingQuotes(list.map((item) => item.code));
      const marketForAdvice = detectMarketStatus(new Date());
      const candidateMap = new Map(
        (strategy.reviewUniverse?.length
          ? strategy.reviewUniverse
          : strategy.candidates
        ).map((candidate) => [candidate.code, candidate])
      );
      const evaluated = list.flatMap((position) => {
        const quote = quotes.get(position.code);
        if (!quote) return [];
        const history = tickHistory.current.get(position.code) ?? [];
        const rapidSignal = detectRapidMove(position, quote, history);
        const technical = technicalCache.current.get(position.code);
        const anomalyRisk = buildHoldingAnomalyRisk(
          quote,
          technical?.history ?? [],
          benchmarkCache.current.get(position.code)
        );
        const snapshot = evaluateHolding(
          position,
          quote,
          rapidSignal,
          technical,
          anomalyRisk
        );
        tickHistory.current.set(
          position.code,
          [...history, createHoldingTick(quote)].slice(-24)
        );
        return [{
          ...snapshot,
          reviewAdvice: buildHoldingReviewAdvice(
            position,
            snapshot,
            candidateMap.get(position.code),
            strategy.reviewMaps,
            strategy.live,
            marketForAdvice.liveEligible
          )
        }];
      });
      setSnapshots(evaluated);
      setLastUpdated(
        new Intl.DateTimeFormat("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        }).format(new Date())
      );
      const market = detectMarketStatus(new Date());
      if (monitoringEnabled && permission === "granted") {
        if (market.liveEligible) {
          await Promise.allSettled(
            evaluated.map((snapshot) => notifyHoldingAdvice(snapshot, "auction"))
          );
        } else if (
          market.key === "closed" &&
          market.clock.minutes >= 15 * 60 &&
          strategy.asOf === market.clock.date
        ) {
          await Promise.allSettled(
            evaluated.map((snapshot) => notifyHoldingAdvice(snapshot, "review"))
          );
        } else if (market.key === "trading") {
          await Promise.allSettled(evaluated.map(notifyHoldingSignal));
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "持仓行情刷新失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!positions.length || !monitoringEnabled) return;
    void refresh(positions);
    const timer = window.setInterval(() => {
      const market = detectMarketStatus(new Date());
      if (market.key === "trading" || market.liveEligible) {
        void refresh(positions);
      }
    }, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(positions);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    monitoringEnabled,
    positions,
    strategy.asOf,
    strategy.live?.fetchedAt,
    permission
  ]);

  async function addPosition(event: React.FormEvent) {
    event.preventDefault();
    const normalizedCode = code.trim().replace(/\D/g, "").slice(0, 6);
    const numericCost = Number(cost);
    const numericShares = Number(shares);
    if (normalizedCode.length !== 6 || numericCost <= 0 || numericShares <= 0) {
      setError("请输入6位股票代码、有效成本和股数。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const quotes = await fetchHoldingQuotes([normalizedCode]);
      const quote = quotes.get(normalizedCode);
      if (!quote) throw new Error("未查询到该股票，请检查代码。");
      const nextPosition: HoldingPosition = {
        id: normalizedCode,
        code: normalizedCode,
        name: quote.name,
        cost: numericCost,
        shares: numericShares,
        stopLossPct: 7,
        takeProfitPct: 12,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const currentRecommendations = recommendedCandidates.slice(0, 2);
      const recommendationIndex = currentRecommendations.findIndex(
        (candidate) => candidate.code === normalizedCode
      );
      const recommendation =
        recommendationIndex >= 0
          ? currentRecommendations[recommendationIndex]
          : null;
      const recommendationRank =
        recommendationIndex === 0 ? 1 : recommendationIndex === 1 ? 2 : undefined;
      const recommendationDate =
        strategy.live?.marketStatus.clock.date ?? strategy.asOf;
      const buyTrade = createHoldingTrade({
        code: normalizedCode,
        name: quote.name,
        side: "buy",
        price: numericCost,
        shares: numericShares,
        fee: 0,
        tradeDate: chinaTradeDate(),
        source: recommendation ? "recommendation" : "manual",
        recommendationRank,
        recommendationDate: recommendation ? recommendationDate : undefined
      });
      const next = [
        ...positions.filter((item) => item.code !== normalizedCode),
        nextPosition
      ];
      setPositions(next);
      setTrades((current) => [...current, buyTrade]);
      setCode("");
      setCost("");
      setShares("");
      await refresh(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加持仓失败");
    } finally {
      setLoading(false);
    }
  }

  function updatePosition(nextPosition: HoldingPosition) {
    const updatedPosition = {
      ...nextPosition,
      updatedAt: new Date().toISOString()
    };
    setPositions((current) =>
      current.map((item) =>
        item.code === nextPosition.code ? updatedPosition : item
      )
    );
    setSnapshots((current) =>
      current.map((item) =>
        item.position.code === updatedPosition.code
          ? evaluateHolding(
              updatedPosition,
              item.quote,
              undefined,
              technicalCache.current.get(updatedPosition.code),
              item.anomalyRisk
            )
          : item
      )
    );
  }

  function importPositions(
    imported: HoldingPosition[],
    mode: "merge" | "replace"
  ) {
    if (mode === "replace") {
      setPositions(imported);
      setSyncOpen(false);
      return;
    }
    const merged = new Map(positions.map((item) => [item.code, item]));
    for (const incoming of imported) {
      const current = merged.get(incoming.code);
      const incomingTime = new Date(
        incoming.updatedAt ?? incoming.createdAt
      ).getTime();
      const currentTime = current
        ? new Date(current.updatedAt ?? current.createdAt).getTime()
        : 0;
      if (!current || incomingTime >= currentTime) {
        merged.set(incoming.code, incoming);
      }
    }
    setPositions([...merged.values()]);
    setSyncOpen(false);
  }

  function deletePosition(positionCode: string) {
    tickHistory.current.delete(positionCode);
    technicalCache.current.delete(positionCode);
    technicalAttempts.current.delete(positionCode);
    benchmarkCache.current.delete(positionCode);
    benchmarkAttempts.current.delete(positionCode);
    setPositions((current) =>
      current.filter((item) => item.code !== positionCode)
    );
    setSnapshots((current) =>
      current.filter((item) => item.position.code !== positionCode)
    );
  }

  function recordSale(trade: HoldingTradeRecord) {
    const nextPositions = positions.flatMap((position) => {
      if (position.code !== trade.code) return [position];
      const remainingShares = position.shares - trade.shares;
      return remainingShares > 0
        ? [{
            ...position,
            shares: remainingShares,
            updatedAt: new Date().toISOString()
          }]
        : [];
    });
    setTrades((current) => [...current, trade]);
    setPositions(nextPositions);
    if (nextPositions.some((position) => position.code === trade.code)) {
      void refresh(nextPositions);
    } else {
      setSnapshots((current) =>
        current.filter((snapshot) => snapshot.position.code !== trade.code)
      );
    }
  }

  function openHolding(snapshot: HoldingSnapshot) {
    const anomalyRisk = snapshot.anomalyRisk;
    const buildRiskAnomaly = (baseAnomaly: CandidateAnomaly) =>
      anomalyRisk
        ? {
            ...baseAnomaly,
            method: "index_deviation" as const,
            benchmarkCode: anomalyRisk.benchmarkCode,
            benchmarkName: anomalyRisk.benchmarkName,
            currentDayDeviation: anomalyRisk.currentDayDeviation,
            tenDayDeviation: anomalyRisk.tenDayDeviation,
            thirtyDayDeviation: anomalyRisk.thirtyDayDeviation,
            tenDayRemaining: anomalyRisk.tenDayRemaining,
            thirtyDayRemaining: anomalyRisk.thirtyDayRemaining,
            tenDayRedLinePrice: anomalyRisk.tenDayRedLinePrice,
            thirtyDayRedLinePrice: anomalyRisk.thirtyDayRedLinePrice,
            nextDayTenDayRedLinePrice:
              anomalyRisk.nextDayTenDayRedLinePrice,
            riskAction: anomalyRisk.action,
            regulatoryStatus:
              anomalyRisk.status === "breached"
                ? ("abnormal" as const)
                : anomalyRisk.status === "near" ||
                    anomalyRisk.status === "watch"
                  ? ("watch" as const)
                  : ("clear" as const),
            regulatoryLabels: [
              anomalyRisk.label,
              ...baseAnomaly.regulatoryLabels
            ]
          }
        : baseAnomaly;
    const candidates = [
      ...(strategy.live?.candidates ?? []),
      ...strategy.candidates,
      ...(strategy.reviewUniverse ?? [])
    ];
    const existing = candidates.find(
      (candidate) => candidate.code === snapshot.position.code
    );
    if (existing) {
      const baseAnomaly =
        existing.anomaly ??
        buildAnomalyFromHistory(
          snapshot.position.code,
          existing.history,
          existing.riskNotes
        );
      onOpenStock({
        ...existing,
        anomaly: buildRiskAnomaly(baseAnomaly)
      });
      return;
    }
    const { quote } = snapshot;
    const technical = technicalCache.current.get(snapshot.position.code);
    const limit =
      snapshot.position.code.startsWith("30") ||
      snapshot.position.code.startsWith("68")
        ? 0.2
        : 0.1;
    const riskNotes = ["持仓股票，未进入今日复盘候选池"];
    const history = technical?.history ?? [];
    const baseAnomaly = buildAnomalyFromHistory(
      snapshot.position.code,
      history,
      riskNotes
    );
    const anomaly = buildRiskAnomaly(baseAnomaly);
    onOpenStock({
      rank: 999,
      modelRank: 999,
      code: snapshot.position.code,
      symbol: quote.symbol,
      name: quote.name,
      industry: "持仓",
      modelScore: 0,
      compositeScore: 0,
      close: quote.price,
      dayRet: quote.changePct / 100,
      gap: quote.preClose ? quote.open / quote.preClose - 1 : 0,
      limit,
      limitToday: quote.preClose
        ? quote.price >= quote.preClose * (1 + limit) - 0.011
        : false,
      limit20: 0,
      limit60: 0,
      limitStreak: 0,
      volRatio: quote.volumeRatio,
      ret5: technical?.ret5 ?? 0,
      ret10: technical?.ret10 ?? 0,
      ret30: technical?.ret30 ?? 0,
      closePos:
        quote.high > quote.low
          ? (quote.price - quote.low) / (quote.high - quote.low)
          : 0.5,
      nearHigh20:
        technical?.high20 && technical.high20 > 0
          ? quote.price / technical.high20
          : 1,
      turnoverEst: quote.turnoverRate,
      amountEst: quote.amount,
      avg5Amount: quote.amount / Math.max(quote.volumeRatio || 1, 1),
      sectorN: 0,
      sectorLimitCount: 0,
      sectorStrongCount: 0,
      floatCap: quote.floatCap,
      riskLevel: "medium",
      riskPenalty: 0.04,
      riskNotes,
      history,
      lastAuction: {
        price: quote.open,
        amount: 0,
        ratio: 0,
        first5Ret: 0
      },
      anomaly
    });
  }

  async function enableNotifications() {
    if (notificationGranted) {
      const shown = await showHoldingTestNotification();
      setError(shown ? null : "测试通知发送失败，请检查系统通知权限。");
      return;
    }
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === "granted") {
      await showHoldingTestNotification();
    }
  }

  const market = detectMarketStatus(new Date());
  const isMarketMonitorable =
    market.key === "trading" || market.liveEligible;
  const notificationGranted = permission === "granted";
  const recommendationDate =
    strategy.live?.marketStatus.clock.date ?? strategy.asOf;
  const capitalFlowRecommendations: CapitalFlowRecommendation[] =
    recommendedCandidates.slice(0, 2).map((candidate, index) => ({
      code: candidate.code,
      name: candidate.name,
      rank: index === 0 ? 1 : 2,
      date: recommendationDate,
      modelScore: candidate.modelScore
    }));

  function openCapitalFlow() {
    setTrades((current) =>
      ensureOpeningTrades(
        current,
        positions,
        capitalFlowRecommendations
      )
    );
    setCapitalFlowOpen(true);
  }

  return (
    <section className="holdings-panel" aria-label="我的持仓实时监控">
      <div className="holdings-heading">
        <div>
          <p><span className="eyebrow-index">02</span> PORTFOLIO RADAR</p>
          <h2>持仓雷达</h2>
          <span>
            {positions.length
              ? `${positions.length} 只 · ${isMarketMonitorable ? "交易时段每30秒刷新" : "非交易时段保留最近行情"}`
              : "录入已购买股票后开始监测"}
          </span>
        </div>
        <div className="holdings-state">
          <strong className={isMarketMonitorable ? "is-live" : ""}>
            {!monitoringEnabled
              ? "自动监测已关闭"
              : isMarketMonitorable
                ? "监测中"
                : "等待交易时段"}
          </strong>
          {lastUpdated && <small>更新 {lastUpdated}</small>}
        </div>
      </div>

      <form className="holding-add-form" onSubmit={addPosition}>
        <label>
          股票代码
          <input
            inputMode="numeric"
            value={code}
            maxLength={6}
            placeholder="例如 601595"
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <label>
          持仓成本
          <input
            inputMode="decimal"
            value={cost}
            placeholder="买入均价"
            onChange={(event) => setCost(event.target.value)}
          />
        </label>
        <label>
          持仓股数
          <input
            inputMode="numeric"
            value={shares}
            placeholder="例如 1000"
            onChange={(event) => setShares(event.target.value)}
          />
        </label>
        <button type="submit" disabled={loading}>
          <Plus size={16} />
          {loading ? "读取中" : "加入监测"}
        </button>
        <button
          type="button"
          className="capital-flow-trigger"
          onClick={openCapitalFlow}
        >
          <TrendingUp size={16} />
          资金走势
        </button>
      </form>

      <div className="holdings-toolbar">
        <div>
          <Briefcase size={15} />
          <span>数据仅保存在本机，不上传持仓信息</span>
        </div>
        <div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            刷新
          </button>
          <button
            type="button"
            onClick={() => setMonitoringEnabled((value) => !value)}
          >
            {monitoringEnabled ? <BellOff size={14} /> : <Bell size={14} />}
            {monitoringEnabled ? "关闭自动监测" : "开启自动监测"}
          </button>
          <button type="button" onClick={() => setSyncOpen(true)}>
            <Link2 size={14} />
            设备同步
          </button>
          <button
            type="button"
            className={notificationGranted ? "is-granted" : ""}
            onClick={() => void enableNotifications()}
            disabled={permission === "denied" || permission === "unsupported"}
          >
            <Bell size={14} />
            {notificationGranted ? "测试通知" : permission === "denied" ? "通知被拒绝" : "开启通知"}
          </button>
        </div>
      </div>

      {error && <div className="holdings-error"><ShieldAlert size={15} />{error}</div>}

      {positions.length === 0 ? (
        <div className="holdings-empty">
          <Briefcase size={28} />
          <strong>还没有持仓</strong>
          <p>输入股票代码、成本和股数后，系统会在交易时段监测加仓、减仓、止盈和止损条件。</p>
        </div>
      ) : (
        <div className="holding-grid">
          {snapshots.map((snapshot) => (
            <HoldingCard
              key={snapshot.position.code}
              snapshot={snapshot}
              onChange={updatePosition}
              onDelete={deletePosition}
              onOpen={() => openHolding(snapshot)}
            />
          ))}
        </div>
      )}

      {positions.length > 0 && (
        <Suspense
          fallback={
            <div className="module-loading">
              正在生成持仓与每日推荐票的对比计划…
            </div>
          }
        >
          <HoldingRotationPanel
            positions={positions}
            snapshots={snapshots}
            candidates={recommendedCandidates}
            market={market}
            dataDate={
              strategy.live?.marketStatus.clock.date ?? strategy.asOf
            }
            lastUpdated={lastUpdated}
          />
        </Suspense>
      )}

      <p className="holdings-notification-note">
        {notificationGranted
          ? "已授权通知：PWA 打开或仍在系统后台存活时会发送系统提醒。浏览器彻底关闭后，若要继续推送，需要额外的免费推送服务端。"
          : "手机系统通知需要点击“开启通知”并允许权限；iPhone 需先将网页安装到主屏幕。APP完全关闭后的持续推送不由纯静态网页提供。"}
      </p>
      <p className="holdings-notification-note holdings-anomaly-method-note">
        异动偏离值按“个股每日收盘/实时涨跌幅 − 对应指数同期涨跌幅”滚动累加；10日达到100%、
        30日达到200%为风险预警口径，不是交易所正式认定。盘中红线价会随指数实时变化。
      </p>
      <details className="notification-help">
        <summary>手机通知怎么设置，才能更容易及时收到？</summary>
        <ol>
          <li>Android：用 Chrome 打开竞价雷达，菜单选择“添加到主屏幕”，再从桌面图标进入并点击“开启通知”。</li>
          <li>iPhone：用 Safari 打开，分享菜单中选择“添加到主屏幕”；iOS 16.4 及以上从桌面图标进入并允许通知。</li>
          <li>设备设置中检查“通知 → 竞价雷达”，开启横幅、声音和锁屏显示，并关闭省电模式对该应用的限制。</li>
          <li>当前纯静态版本只能在应用/PWA 打开或仍在系统后台存活时提醒；要将 APP 完全关闭后的持续提醒也做到，需要增加推送服务端。</li>
        </ol>
      </details>

      {syncOpen && (
        <DeviceSyncDialog
          holdings={positions}
          onClose={() => setSyncOpen(false)}
          onImport={importPositions}
        />
      )}
      {capitalFlowOpen && (
        <Suspense fallback={null}>
          <CapitalFlowDrawer
            positions={positions}
            snapshots={snapshots}
            recommendations={capitalFlowRecommendations}
            trades={trades}
            onClose={() => setCapitalFlowOpen(false)}
            onRecordSale={recordSale}
          />
        </Suspense>
      )}
    </section>
  );
}
