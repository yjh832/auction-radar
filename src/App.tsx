import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Clock3,
  Database,
  Download,
  Landmark,
  Radar,
  RefreshCw,
  ShieldAlert,
  TimerReset,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import strategyFallback from "../data/strategy.json";
import { CandidateTable } from "./components/CandidateTable";
import { CandidateAnomalyPanel } from "./components/CandidateAnomalyPanel";
import { GlobalIndexTape } from "./components/GlobalIndexTape";
import { HoldingsMonitor } from "./components/HoldingsMonitor";
import { ScoreDial } from "./components/ScoreDial";
import { StockSearch } from "./components/StockSearch";
import { loadCachedResult, saveCachedResult } from "./lib/cache";
import {
  detectMarketStatus,
  fetchGlobalMarketContext,
  fetchSinaMarketSnapshot,
  reviewWithSnapshot,
  scoreWithSnapshot
} from "./lib/market";
import {
  filterMainBoard,
  isMainBoardCode
} from "./lib/universe";
import type {
  Candidate,
  GlobalIndexDefinition,
  GlobalMarketContext,
  StockSearchResult,
  StrategyDashboard
} from "./types";

const fallbackStrategy = strategyFallback as StrategyDashboard;
const StockDetailDrawer = lazy(() =>
  import("./components/StockDetailDrawer").then((module) => ({
    default: module.StockDetailDrawer
  }))
);
const CandidateUniverseDrawer = lazy(() =>
  import("./components/CandidateUniverseDrawer").then((module) => ({
    default: module.CandidateUniverseDrawer
  }))
);
const IndexDetailDrawer = lazy(() =>
  import("./components/IndexDetailDrawer").then((module) => ({
    default: module.IndexDetailDrawer
  }))
);
const ReviewMapsPanel = lazy(() =>
  import("./components/ReviewMapsPanel").then((module) => ({
    default: module.ReviewMapsPanel
  }))
);

const INDEX_SELECTION_KEY = "auction-radar:global-indices:v1";
const DEFAULT_INDEX_SYMBOLS = [
  "sh000001",
  "sz399001",
  "sz399006",
  "sh000688",
  "hkHSI",
  "usIXIC"
];

function loadIndexSelection() {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(INDEX_SELECTION_KEY) ?? "[]"
    );
    if (
      Array.isArray(parsed) &&
      parsed.length === 6 &&
      parsed.every((value) => typeof value === "string")
    ) {
      return parsed as string[];
    }
  } catch {
    // Use the default index mix.
  }
  return DEFAULT_INDEX_SYMBOLS;
}

function candidateFromSearch(result: StockSearchResult): Candidate {
  const limit =
    result.code.startsWith("30") || result.code.startsWith("68") ? 0.2 : 0.1;
  return {
    rank: 999,
    modelRank: 999,
    code: result.code,
    symbol: result.symbol,
    name: result.name,
    industry: "全市场股票",
    modelScore: 0,
    compositeScore: 0,
    close: 0,
    dayRet: 0,
    gap: 0,
    limit,
    limitToday: false,
    limit20: 0,
    limit60: 0,
    limitStreak: 0,
    volRatio: 0,
    ret5: 0,
    ret10: 0,
    ret30: 0,
    closePos: 0.5,
    nearHigh20: 0,
    turnoverEst: 0,
    amountEst: 0,
    avg5Amount: 0,
    sectorN: 0,
    sectorLimitCount: 0,
    sectorStrongCount: 0,
    floatCap: 0,
    riskLevel: "medium",
    riskPenalty: 0,
    riskNotes: ["全市场搜索标的，不参与当日候选评分"],
    history: [],
    lastAuction: {
      price: 0,
      amount: 0,
      ratio: 0,
      first5Ret: 0
    }
  };
}

function pct(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function tradePlan(candidate: Candidate) {
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
  return {
    entryLow,
    entryHigh,
    stop,
    target
  };
}

function riskText(level: Candidate["riskLevel"]) {
  if (level === "high") return "高";
  if (level === "medium") return "中";
  return "低";
}

function formatChinaDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${year}.${month}.${day}`;
}

function marketBadgeClass(key?: string) {
  if (key === "auction_open" || key === "auction_final" || key === "auction_result") {
    return "market-status market-status--auction";
  }
  if (key === "trading") return "market-status market-status--trading";
  return "market-status";
}

function isAfterCloseSession(now = new Date()) {
  const status = detectMarketStatus(now);
  return (
    status.clock.weekday !== "Sat" &&
    status.clock.weekday !== "Sun" &&
    status.clock.minutes >= 15 * 60
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function App() {
  const [dashboard, setDashboard] = useState<StrategyDashboard>(fallbackStrategy);
  const [now, setNow] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [showCandidateUniverse, setShowCandidateUniverse] = useState(false);
  const [selectedIndex, setSelectedIndex] =
    useState<GlobalIndexDefinition | null>(null);
  const [selectedIndexSymbols, setSelectedIndexSymbols] =
    useState<string[]>(loadIndexSelection);
  const [globalMarket, setGlobalMarket] =
    useState<GlobalMarketContext | null>(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const bootstrapped = useRef(false);

  const refreshGlobalIndices = useCallback(async () => {
    if (!navigator.onLine) return;
    setGlobalLoading(true);
    try {
      const context = await fetchGlobalMarketContext(selectedIndexSymbols);
      setGlobalMarket(context);
    } catch {
      // Keep the last global snapshot when the public feed is unavailable.
    } finally {
      setGlobalLoading(false);
    }
  }, [selectedIndexSymbols]);

  useEffect(() => {
    try {
      localStorage.setItem(
        INDEX_SELECTION_KEY,
        JSON.stringify(selectedIndexSymbols)
      );
    } catch {
      // Index selection persistence is optional.
    }
    void refreshGlobalIndices();
    const timer = window.setInterval(() => void refreshGlobalIndices(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshGlobalIndices();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshGlobalIndices]);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    let cancelled = false;

    const cached = loadCachedResult();
    if (cached) {
      setDashboard((current) => ({ ...current, live: cached }));
    }

    async function boot() {
      let base = fallbackStrategy;
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}strategy.json?t=${Date.now()}`,
          {
            cache: "no-store"
          }
        );
        if (response.ok) {
          base = (await response.json()) as StrategyDashboard;
        }
      } catch {
        // The bundled strategy remains available when the network is offline.
      }
      if (!cancelled) {
        setDashboard((current) => ({ ...base, live: current.live ?? null }));
      }
      if (
        !cancelled &&
        navigator.onLine &&
        (detectMarketStatus(new Date()).liveEligible ||
          isAfterCloseSession(new Date()))
      ) {
        await refreshMarket(base, true);
      }
    }
    void boot();

    return () => {
      cancelled = true;
    };

  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onInstall = (event: Event) => {
      const prompt = event as BeforeInstallPromptEvent;
      prompt.preventDefault();
      setInstallPrompt(prompt);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);

  const marketStatus = detectMarketStatus(now);
  const reviewSession = isAfterCloseSession(now);
  const hasLiveAttempt = Boolean(dashboard.live);
  const recommendationSource = hasLiveAttempt
    ? dashboard.live?.recommendation ?? null
    : dashboard.recommendation;
  const recommendation =
    recommendationSource && isMainBoardCode(recommendationSource.code)
      ? recommendationSource
      : null;
  const liveCandidates = filterMainBoard(dashboard.live?.candidates ?? []);
  const candidates = liveCandidates.length
    ? liveCandidates
    : filterMainBoard(dashboard.candidates);
  const reviewCandidates = dashboard.reviewUniverse?.length
    ? filterMainBoard(dashboard.reviewUniverse)
    : candidates;
  const bestPicks = candidates.slice(0, 2);
  const pick = bestPicks[0] ?? recommendation ?? dashboard.recommendation;
  const reviewMaps = dashboard.live?.reviewMaps ?? dashboard.reviewMaps;
  const adaptation = dashboard.model.adaptation?.latest ?? null;
  const factorLabels: Record<string, string> = {
    gene: "涨停记忆",
    limit_today: "当日封板",
    limit_streak: "连板强度",
    close_pos: "高位收盘",
    vol_ratio: "量能",
    sector_heat: "板块热度",
    near_high20: "接近20日高",
    momentum: "动量"
  };
  const adaptationChanges = adaptation
    ? Object.entries(adaptation.weightChanges)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 2)
    : [];

  const chinaTime = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(now),
    [now]
  );

  async function refreshMarket(
    base: StrategyDashboard = dashboard,
    silent = false
  ) {
    if (!navigator.onLine) {
      setNotice("设备当前离线，保留本地缓存结果。");
      return;
    }
    setRefreshing(true);
    setLoadProgress(0);
    try {
      const [snapshot, nextGlobalMarket] = await Promise.all([
        fetchSinaMarketSnapshot(setLoadProgress),
        fetchGlobalMarketContext(selectedIndexSymbols).catch(() => null)
      ]);
      if (nextGlobalMarket) setGlobalMarket(nextGlobalMarket);
      const live = reviewSession
        ? await reviewWithSnapshot(
            base,
            snapshot,
            new Date(),
            nextGlobalMarket ?? globalMarket
          )
        : await scoreWithSnapshot(
            base,
            snapshot,
            new Date(),
            nextGlobalMarket ?? globalMarket
          );
      setDashboard((current) => ({ ...current, live }));
      saveCachedResult(live);
      if (!silent) {
        setNotice(
          live.mode === "auction"
            ? live.recommendation
              ? `9:25竞价刷新完成：${live.recommendation.name}`
              : live.noPickReason ?? "今日无满足条件的标的。"
            : live.mode === "review"
              ? live.recommendation
                ? `收盘复盘完成：6只候选，首选${live.recommendation.name}`
                : live.noPickReason ?? "收盘复盘暂无有效标的。"
            : `已刷新浏览器行情：${live.quoteCount}只，高开${live.positiveOpenCount}只。非竞价时段保留盘前首选。`
        );
      }
    } catch {
      setNotice("浏览器直连行情失败，已保留本地缓存与盘前推演结果。");
    } finally {
      setRefreshing(false);
      setLoadProgress(0);
    }
  }

  async function installPwa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  const closeStockDetail = useCallback(() => setSelectedCandidate(null), []);
  const closeCandidateUniverse = useCallback(
    () => setShowCandidateUniverse(false),
    []
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="竞价雷达首页">
          <span className="brand-mark">
            <Radar size={19} strokeWidth={1.7} />
          </span>
          <span>
            <strong>竞价雷达</strong>
            <small>集合竞价 · 涨停基因雷达</small>
          </span>
        </a>

        <StockSearch
          onSelect={(result) =>
            setSelectedCandidate(candidateFromSearch(result))
          }
        />

        <div className="topbar-meta">
          <div>
            <span>北京时间</span>
            <strong>{chinaTime}</strong>
          </div>
          <div>
            <span>下一交易日</span>
            <strong>{formatChinaDate(dashboard.nextTradingDate)}</strong>
          </div>
          {installPrompt && (
            <button className="install-button" type="button" onClick={installPwa}>
              <Download size={14} />
              安装应用
            </button>
          )}
          <div className={marketBadgeClass(marketStatus.key)}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {marketStatus.label}
          </div>
        </div>
      </header>

      <GlobalIndexTape
        selectedSymbols={selectedIndexSymbols}
        indices={globalMarket?.indices ?? []}
        strongestUsSectors={
          globalMarket?.strongestUsSectors ??
          dashboard.globalReference?.strongestUsSectors ??
          []
        }
        loading={globalLoading}
        onSelectionChange={setSelectedIndexSymbols}
        onOpen={setSelectedIndex}
        onRefresh={() => void refreshGlobalIndices()}
      />

      <main id="top" className="page-frame">
        <section className="hero-grid">
          <article className="pick-panel reveal reveal-1">
            <div className="pick-panel__eyebrow">
              <span>
                <b className="eyebrow-index">01</b>
                {dashboard.live?.mode === "auction"
                  ? "9:25竞价最佳两手"
                  : "今日最佳两手"}
              </span>
              <span className="eyebrow-en">
                {dashboard.live?.mode === "auction"
                  ? "AUCTION TOP TWO"
                  : "TOP TWO OBSERVATIONS"}
              </span>
            </div>
            <div className="best-picks-list">
              {bestPicks.map((best, index) => {
                const plan = tradePlan(best);
                return (
                  <article
                    className={`best-pick-card best-pick-card--${index === 0 ? "one" : "two"}`}
                    key={best.code}
                  >
                    <div className="best-pick-card__top">
                      <div className="best-pick-card__identity">
                        <div className="best-pick-card__rank">
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <strong>{index === 0 ? "首选" : "备选"}</strong>
                        </div>
                        <div>
                          <div className="stock-tags">
                            <span>{best.industry}</span>
                            {best.limitToday && <span className="tag-red">上日封板</span>}
                            {best.reviewTags?.slice(0, 2).map((tag) => (
                              <span
                                className={tag.startsWith("美股") ? "tag-us" : "tag-blue"}
                                key={tag}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <h2>{best.name}</h2>
                          <div className="stock-code-row">
                            <p className="stock-code">{best.code} · 深沪 A 股</p>
                            <button
                              type="button"
                              className="detail-trigger"
                              onClick={() => setSelectedCandidate(best)}
                            >
                              <BarChart3 size={13} />
                              完整信息
                            </button>
                          </div>
                        </div>
                      </div>
                      <ScoreDial
                        value={
                          best.recommendationScore != null
                            ? best.recommendationScore / 100
                            : best.compositeScore
                        }
                        label={
                          best.recommendationScore != null
                            ? "精选分"
                            : "综合分"
                        }
                      />
                    </div>

                    <div className="best-pick-card__metrics">
                      <div><span>现价 / 收盘</span><strong>{best.close.toFixed(2)}</strong></div>
                      <div><span>当日涨跌</span><strong className={best.dayRet >= 0 ? "is-up" : "is-down"}>{pct(best.dayRet)}</strong></div>
                      <div><span>模型分</span><strong>{(best.modelScore * 100).toFixed(1)}</strong></div>
                      <div><span>风险</span><strong className={`risk-${best.riskLevel}`}>{riskText(best.riskLevel)}</strong></div>
                      <div>
                        <span>打板推荐值</span>
                        <strong>{best.boardScore == null ? "—" : best.boardScore.toFixed(0)}</strong>
                        <small>{best.auctionSeal?.label ?? "等待9:25封单"}</small>
                      </div>
                    </div>

                    <div className="best-pick-card__plan">
                      <div>
                        <span>竞价入场观察区</span>
                        <strong>{plan.entryLow.toFixed(2)} — {plan.entryHigh.toFixed(2)}</strong>
                        <small>高于上沿不追，等待承接</small>
                      </div>
                      <div>
                        <span>防守离场价</span>
                        <strong>{plan.stop.toFixed(2)}</strong>
                        <small>跌破后优先控制风险</small>
                      </div>
                      <div>
                        <span>目标离场价</span>
                        <strong>{plan.target.toFixed(2)}</strong>
                        <small>到达后分批观察</small>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </article>

          <aside className="decision-rail reveal reveal-2">
            <div className="rail-block status-block">
              <div className="rail-heading">
                <div>
                  <span>DECISION STATE</span>
                  <h2>盘前待确认</h2>
                </div>
                <Clock3 size={22} />
              </div>
              <div className="decision-state">
                <span className="decision-state__dot" />
                <div>
                  <strong>
                    {dashboard.live?.mode === "auction"
                      ? "浏览器竞价已完成"
                      : dashboard.live?.mode === "review"
                        ? "收盘复盘已完成"
                      : "浏览器直连就绪"}
                  </strong>
                  <p>打开或点击时在本机更新行情并重新计算</p>
                </div>
              </div>
              <button
                type="button"
                className="refresh-button"
                onClick={() => void refreshMarket()}
                disabled={refreshing || !online}
              >
                <RefreshCw size={16} className={refreshing ? "spin" : ""} />
                {refreshing
                  ? `读取行情 ${loadProgress} 只`
                  : marketStatus.liveEligible
                    ? "刷新9:25竞价"
                    : reviewSession
                      ? "更新收盘复盘"
                      : "刷新最新行情"}
              </button>
              <p className="rail-note">
                浏览器直连行情，无需后端。结果与最近快照仅缓存在本机。
              </p>
            </div>

            <div className="rail-block">
              <div className="rail-heading rail-heading--compact">
                <div>
                  <span>EXECUTION GATE</span>
                  <h2>三关确认</h2>
                </div>
                <TimerReset size={20} />
              </div>
              <ol className="gate-list">
                <li>
                  <span>09:20</span>
                  <div>
                    <strong>竞价锁定</strong>
                    <p>高开强度保持 12%—72%，末端不下砸。</p>
                  </div>
                </li>
                <li>
                  <span>09:25</span>
                  <div>
                    <strong>量价匹配</strong>
                    <p>竞价额不低于前5日均额的 1%，非一字板。</p>
                  </div>
                </li>
                <li>
                  <span>09:35</span>
                  <div>
                    <strong>承接成立</strong>
                    <p>不破开盘价，最低回撤控制在 1.5% 内。</p>
                  </div>
                </li>
              </ol>
            </div>

            <div className="rail-block risk-block">
              <div className="rail-heading rail-heading--compact">
                <div>
                  <span>RISK VETO</span>
                  <h2>风险否决</h2>
                </div>
                <ShieldAlert size={20} />
              </div>
              <ul className="risk-list">
                {pick.riskNotes.map((note) => (
                  <li key={note}>
                    <AlertTriangle size={14} />
                    {note}
                  </li>
                ))}
                <li>
                  <X size={14} />
                  指数低开且9:35未修复时，不执行追涨。
                </li>
              </ul>
            </div>
          </aside>
        </section>

        <HoldingsMonitor
          strategy={dashboard}
          recommendedCandidates={bestPicks}
          onOpenStock={setSelectedCandidate}
        />

        <section className="terminal-grid reveal reveal-3">
          <div className="queue-panel">
            <div className="section-heading">
              <div>
                <span className="section-index">03</span>
                <div>
                  <p>OBSERVATION POOL</p>
                  <h2>{dashboard.live?.mode === "auction" ? "竞价雷达" : "候选雷达"}</h2>
                </div>
              </div>
              <div className="section-heading-actions">
                <div className="section-meta">
                  主板权限 · 首页前 {candidates.length} 只
                </div>
                <button
                  type="button"
                  className="universe-entry"
                  onClick={() => setShowCandidateUniverse(true)}
                >
                  <Database size={15} />
                  查看 {reviewCandidates.length} 支完整候选池
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
            <CandidateTable candidates={candidates} onSelect={setSelectedCandidate} />
            <CandidateAnomalyPanel
              candidates={candidates}
              onSelect={setSelectedCandidate}
            />
          </div>

          <aside className="evidence-panel">
            <div className="section-heading section-heading--small">
              <div>
                <span className="section-index">03B</span>
                <div>
                  <p>MODEL EVIDENCE</p>
                  <h2>模型证据</h2>
                </div>
              </div>
              <BarChart3 size={20} />
            </div>

            <div className="evidence-hero">
              <span>验证期每日前3</span>
              <strong>
                {(dashboard.model.top3Validation.touch_rate * 100).toFixed(1)}%
              </strong>
              <p>次日触及涨停率</p>
            </div>

            <div className="comparison-row">
              <div>
                <span>候选池基准</span>
                <strong>{(dashboard.model.baseRate.touch_rate * 100).toFixed(1)}%</strong>
              </div>
              <div>
                <span>收盘封板率</span>
                <strong>
                  {(dashboard.model.top3Validation.close_limit_rate * 100).toFixed(1)}%
                </strong>
              </div>
            </div>

            <div className="weight-stack">
              <div className="section-kicker">
                <Landmark size={14} />
                核心权重
              </div>
              {[
                ["涨停记忆", dashboard.model.weights.gene],
                ["高位收盘", dashboard.model.weights.close_pos],
                ["板块热度", dashboard.model.weights.sector_heat],
                ["连板强度", dashboard.model.weights.limit_streak]
              ].map(([label, value]) => (
                <div className="weight-row" key={label}>
                  <span>{label}</span>
                  <div>
                    <i style={{ width: `${Number(value) * 300}%` }} />
                  </div>
                  <strong>{(Number(value) * 100).toFixed(1)}%</strong>
                </div>
              ))}
            </div>

            <div className="model-adaptation">
              <div className="section-kicker">
                <Activity size={14} />
                每日自适应
              </div>
              {adaptation ? (
                <>
                  <div className="model-adaptation-score">
                    <strong>{(adaptation.hitRate * 100).toFixed(0)}%</strong>
                    <span>上批候选红盘率</span>
                  </div>
                  <div className="model-adaptation-meta">
                    <span>{adaptation.sampleSize} 只样本</span>
                    <span className={adaptation.avgReturn >= 0 ? "is-up" : "is-down"}>
                      均涨幅 {pct(adaptation.avgReturn)}
                    </span>
                    <span>{adaptation.sampleDate} → {adaptation.date}</span>
                  </div>
                  <div className="model-adaptation-changes">
                    {adaptationChanges.map(([factor, change]) => (
                      <span key={factor}>
                        {factorLabels[factor] ?? factor}{" "}
                        <strong>
                          {change >= 0 ? "+" : ""}
                          {(change * 100).toFixed(2)}%
                        </strong>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="model-adaptation-empty">
                  <strong>等待首个完整评估日</strong>
                  <p>下一交易日收盘后，将根据本批入选标的的实际表现更新权重。</p>
                </div>
              )}
              <small className="model-adaptation-data">
                数据截止 {formatChinaDate(dashboard.asOf)} · 每日收盘后滚动更新
              </small>
            </div>
          </aside>
        </section>

        <Suspense
          fallback={
            <section className="module-loading" aria-label="正在加载三图复盘">
              正在加载三图复盘…
            </section>
          }
        >
          <ReviewMapsPanel
            maps={reviewMaps}
            auctionSector={dashboard.live?.strongestSector}
            auctionCandidates={
              dashboard.live?.mode === "auction"
                ? candidates
                : null
            }
            globalMarket={globalMarket}
          />
        </Suspense>

        <section className="workflow-strip reveal reveal-4">
          <div className="workflow-title">
            <p><span className="eyebrow-index">05</span> TRADING PIPELINE</p>
            <h2>盘前执行流程</h2>
          </div>
          <div className="workflow-step">
            <span>01</span>
            <strong>收盘后建池</strong>
            <p>仅保留沪深主板，再过滤ST、流动性不足和极端过热。</p>
          </div>
          <div className="workflow-step">
            <span>02</span>
            <strong>9:25竞价打分</strong>
            <p>用开盘价、竞价成交额和板块开盘强度重新排序。</p>
          </div>
          <div className="workflow-step">
            <span>03</span>
            <strong>9:35承接复核</strong>
            <p>不破开盘才保留；失败则当日不推荐，避免强行交易。</p>
          </div>
        </section>

        <footer>
          <div>
            <Radar size={17} />
            <span>
              竞价雷达 · LIMIT-UP GENE STRATEGY · BUILD{" "}
              {__BUILD_ID__.slice(0, 16).replace("T", " ")}
            </span>
          </div>
          <p>{dashboard.disclaimer}</p>
        </footer>
      </main>

      {notice && (
        <div className="toast" role="status">
          <ArrowUpRight size={16} />
          <span>{notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <Suspense fallback={null}>
        {selectedCandidate && (
          <StockDetailDrawer
            candidate={selectedCandidate}
            onClose={closeStockDetail}
          />
        )}

        {showCandidateUniverse && (
          <CandidateUniverseDrawer
            candidates={reviewCandidates}
            onClose={closeCandidateUniverse}
            onSelect={(candidate) => {
              setSelectedCandidate(candidate);
            }}
          />
        )}

        {selectedIndex && (
          <IndexDetailDrawer
            definition={selectedIndex}
            onClose={() => setSelectedIndex(null)}
          />
        )}
      </Suspense>
    </div>
  );
}

export default App;
