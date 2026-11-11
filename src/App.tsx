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
import { IntradayRadarPanel } from "./components/IntradayRadarPanel";
import { ScoreDial } from "./components/ScoreDial";
import { StockSearch } from "./components/StockSearch";
import { loadCachedResult, saveCachedResult } from "./lib/cache";
import {
  detectMarketStatus,
  fetchRecentDailyHistory,
  fetchGlobalMarketContext,
  fetchSinaMarketSnapshot,
  intradayWithMarket,
  reviewWithSnapshot,
  scoreWithSnapshot
} from "./lib/market";
import {
  filterMainBoard,
  isMainBoardCode
} from "./lib/universe";
import {
  buildBoardPicks,
  buildTrendPicks
} from "./lib/recommendationStyles";
import type { RecommendationStyle } from "./lib/recommendationStyles";
import { analyzeCapitalStyle } from "./lib/capitalStyle";
import type {
  Candidate,
  GlobalIndexDefinition,
  GlobalMarketContext,
  HistoryPoint,
  LiveResult,
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
const RECOMMENDATION_STYLE_KEY = "auction-radar:recommendation-style:v1";
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

function money(value: number) {
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)}亿`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toFixed(0)}万`;
  }
  return value.toFixed(0);
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
  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;
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
  const [recommendationStyle, setRecommendationStyle] =
    useState<RecommendationStyle>(() => {
      try {
        const stored = localStorage.getItem(RECOMMENDATION_STYLE_KEY);
        if (stored === "board" || stored === "intraday" || stored === "trend") {
          return stored;
        }
        return detectMarketStatus(new Date()).key === "trading"
          ? "intraday"
          : "trend";
      } catch {
        return "trend";
      }
    });
  const [boardHistoryCache, setBoardHistoryCache] = useState<
    Record<string, HistoryPoint[]>
  >({});
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
    try {
      localStorage.setItem(RECOMMENDATION_STYLE_KEY, recommendationStyle);
    } catch {
      // Recommendation style persistence is optional.
    }
  }, [recommendationStyle]);

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
      const initialStatus = detectMarketStatus(new Date());
      if (
        !cancelled &&
        navigator.onLine &&
        (initialStatus.liveEligible ||
          initialStatus.key === "trading" ||
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
  const tradingSession = marketStatus.key === "trading";
  const intradaySession = tradingSession || marketStatus.key === "lunch";
  useEffect(() => {
    if (!tradingSession || !online) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshMarket(dashboardRef.current, true);
    };
    refreshWhenVisible();
    const timer = window.setInterval(refreshWhenVisible, 90_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [tradingSession, online]);
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
  const reviewMaps = dashboard.live?.reviewMaps ?? dashboard.reviewMaps;
  const trendPicks = buildTrendPicks(candidates);
  const intradayPicks = candidates
    .filter((candidate) => candidate.intraday)
    .sort(
      (a, b) =>
        Number(b.liveEligible) - Number(a.liveEligible) ||
        (b.intradayScore ?? 0) - (a.intradayScore ?? 0)
    )
    .slice(0, 2);
  const boardHistoryMap = new Map(Object.entries(boardHistoryCache));
  const boardUniverse = buildBoardPicks(
    reviewCandidates,
    reviewMaps,
    boardHistoryMap
  );
  const boardPicks = boardUniverse.slice(0, 2);
  const currentLimitCodes = new Set(
    (reviewMaps?.limitUps ?? []).map((item) => item.code)
  );
  const leadBrokenCode = (reviewMaps?.previousLimitUps ?? [])
    .filter(
      (item) =>
        isMainBoardCode(item.code) &&
        item.streak >= 3 &&
        !currentLimitCodes.has(item.code)
    )
    .sort((a, b) => b.streak - a.streak)[0]?.code;
  const pendingBoardHistoryKey = [
    ...new Set([
      ...boardUniverse
        .filter((item) => item.candidate.history.length < 7)
        .map((item) => item.candidate.code),
      ...(leadBrokenCode && !boardHistoryCache[leadBrokenCode]
        ? [leadBrokenCode]
        : [])
    ])
  ].join(",");
  useEffect(() => {
    if (
      recommendationStyle !== "board" ||
      !pendingBoardHistoryKey ||
      !navigator.onLine
    ) {
      return;
    }
    const codes = pendingBoardHistoryKey.split(",");
    void Promise.all(
      codes.map(async (code) => {
        try {
          return [code, await fetchRecentDailyHistory(code, 40)] as const;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      const additions = results.filter(
        (item): item is readonly [string, HistoryPoint[]] =>
          item !== null && item[1].length > 0
      );
      if (!additions.length) return;
      setBoardHistoryCache((current) => ({
        ...current,
        ...Object.fromEntries(additions)
      }));
    });
  }, [pendingBoardHistoryKey, recommendationStyle]);
  const boardPickMap = new Map(
    boardUniverse.map((item) => [item.candidate.code, item])
  );
  const bestPicks =
    recommendationStyle === "intraday"
      ? intradayPicks.length
        ? intradayPicks
        : trendPicks
      : recommendationStyle === "board"
      ? boardPicks.map((item) => item.candidate)
      : trendPicks;
  const preferredCodes = bestPicks.map((candidate) => candidate.code);
  const preferredLabels =
    recommendationStyle === "board"
      ? boardPicks.map((item) => item.roleLabel)
      : recommendationStyle === "intraday"
        ? intradayPicks.some((candidate) => candidate.liveEligible)
          ? ["盘中首选", "盘中备选"]
          : ["盘中观察", "盘中观察"]
      : ["首选", "备选"];
  const displayedCandidates =
    recommendationStyle === "board"
      ? boardUniverse.map((item) => item.candidate)
      : recommendationStyle === "intraday"
        ? candidates
      : candidates;
  const pick = bestPicks[0] ?? recommendation ?? dashboard.recommendation;
  const actionablePicks =
    recommendationStyle === "intraday"
      ? bestPicks.filter((candidate) => candidate.liveEligible)
      : bestPicks;
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
    base: StrategyDashboard = dashboardRef.current,
    silent = false
  ) {
    if (!navigator.onLine) {
      setNotice("设备当前离线，保留本地缓存结果。");
      return;
    }
    setRefreshing(true);
    setLoadProgress(0);
    try {
      const globalPromise = fetchGlobalMarketContext(
        selectedIndexSymbols
      ).catch(() => null);
      let live: LiveResult;
      if (intradaySession) {
        const [intradayResult, nextGlobalMarket] = await Promise.all([
          intradayWithMarket(base, new Date(), globalMarket),
          globalPromise
        ]);
        live = intradayResult;
        if (nextGlobalMarket) setGlobalMarket(nextGlobalMarket);
      } else {
        const [snapshot, nextGlobalMarket] = await Promise.all([
          fetchSinaMarketSnapshot(setLoadProgress),
          globalPromise
        ]);
        if (nextGlobalMarket) setGlobalMarket(nextGlobalMarket);
        live = reviewSession
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
      }
      setDashboard((current) => ({ ...current, live }));
      saveCachedResult(live);
      if (!silent) {
        setNotice(
          live.mode === "auction"
            ? live.recommendation
              ? `9:25竞价刷新完成：${live.recommendation.name}`
              : live.noPickReason ?? "今日无满足条件的标的。"
            : live.mode === "intraday"
              ? live.recommendation
                ? `盘中雷达更新：${live.recommendation.name}，板块与资金共振`
                : live.noPickReason ?? "盘中暂无满足条件的标的。"
            : live.mode === "review"
              ? live.recommendation
                ? `收盘复盘完成：6只候选，首选${live.recommendation.name}`
                : live.noPickReason ?? "收盘复盘暂无有效标的。"
            : `已刷新浏览器行情：${live.quoteCount}只，高开${live.positiveOpenCount}只。非竞价时段保留盘前首选。`
        );
      }
    } catch {
      setNotice(
        intradaySession
          ? "盘中板块或资金接口暂不可用，已保留上一轮雷达结果。"
          : "浏览器直连行情失败，已保留本地缓存与盘前推演结果。"
      );
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
            <small>竞价 · 盘中资金 · 复盘雷达</small>
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
            <div className="pick-panel__topline">
              <div className="pick-panel__eyebrow">
                <span>
                  <b className="eyebrow-index">01</b>
                  {recommendationStyle === "board"
                    ? dashboard.live?.mode === "auction"
                      ? "9:25打板策略"
                      : "打板策略最佳两手"
                    : recommendationStyle === "intraday"
                      ? dashboard.live?.mode === "intraday"
                        ? dashboard.live.recommendation
                          ? "盘中实时推荐"
                          : "盘中观察窗口"
                        : "盘中决策最佳两手"
                    : dashboard.live?.mode === "auction"
                      ? "9:25竞价最佳两手"
                      : dashboard.live?.mode === "review"
                        ? "次日可参与最佳两手"
                        : "今日最佳两手"}
                </span>
                <span className="eyebrow-en">
                  {recommendationStyle === "board"
                    ? "LIMIT-UP TACTICAL PICKS"
                    : recommendationStyle === "intraday"
                      ? "INTRADAY MARKET RADAR"
                    : dashboard.live?.mode === "auction"
                      ? "AUCTION TOP TWO"
                      : dashboard.live?.mode === "review"
                        ? "NEXT-DAY ACTIONABLE"
                        : "TOP TWO OBSERVATIONS"}
                </span>
              </div>
              <div
                className="recommendation-style-switch"
                role="group"
                aria-label="推荐风格"
              >
                <button
                  type="button"
                  className={recommendationStyle === "trend" ? "is-active" : ""}
                  onClick={() => setRecommendationStyle("trend")}
                >
                  趋势推荐
                </button>
                <button
                  type="button"
                  className={recommendationStyle === "intraday" ? "is-active" : ""}
                  onClick={() => setRecommendationStyle("intraday")}
                >
                  盘中推荐
                </button>
                <button
                  type="button"
                  className={recommendationStyle === "board" ? "is-active" : ""}
                  onClick={() => setRecommendationStyle("board")}
                >
                  打板策略
                </button>
              </div>
            </div>
            <div className="best-picks-list">
              {bestPicks.map((best, index) => {
                const plan = tradePlan(best);
                const boardPick = boardPickMap.get(best.code);
                const capitalProfile = analyzeCapitalStyle(best);
                const pickLabel =
                  recommendationStyle === "board"
                    ? boardPick?.roleLabel ?? (index === 0 ? "打板首选" : "打板备选")
                    : recommendationStyle === "intraday"
                      ? best.liveEligible
                        ? index === 0
                          ? "盘中首选"
                          : "盘中备选"
                        : "盘中观察"
                    : index === 0
                      ? "首选"
                      : "备选";
                return (
                  <article
                    className={`best-pick-card best-pick-card--${index === 0 ? "one" : "two"}`}
                    key={best.code}
                  >
                    <div className="best-pick-card__top">
                      <div className="best-pick-card__identity">
                        <div className="best-pick-card__rank">
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <strong>{pickLabel}</strong>
                        </div>
                        <div>
                          <div className="stock-tags">
                            <span>{best.industry}</span>
                            {best.recentPosition && (
                              <span
                                className={`recent-position-badge is-${best.recentPosition.status}`}
                              >
                                {best.recentPosition.label}
                              </span>
                            )}
                            <span
                              className={`capital-style-badge is-${capitalProfile.style}`}
                              title={`游资评分 ${capitalProfile.hotMoneyScore}，机构评分 ${capitalProfile.institutionScore}`}
                            >
                              {capitalProfile.label}
                            </span>
                            {recommendationStyle === "board" &&
                              best.leaderRelationLabel && (
                                <span
                                  className={`leader-relation-badge ${
                                    best.leaderRelationQualified
                                      ? "is-linked"
                                      : "is-unlinked"
                                  }`}
                                >
                                  {best.leaderRelationLabel}
                                </span>
                              )}
                            {recommendationStyle === "board" &&
                              best.leaderRelationQualified &&
                              best.leaderSimilarity != null && (
                                <span className="leader-pattern-badge">
                                  {best.matchedLeader ?? "最高标"}模板{" "}
                                  {best.leaderSimilarity.toFixed(0)}%
                                </span>
                              )}
                            {best.limitToday && <span className="tag-red">上日封板</span>}
                            {best.reviewTags?.slice(0, recommendationStyle === "board" ? 1 : 2).map((tag) => (
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
                          recommendationStyle === "board"
                            ? (boardPick?.score ?? 0) / 100
                            : best.recommendationScore != null
                              ? best.recommendationScore / 100
                              : best.compositeScore
                        }
                        label={
                          recommendationStyle === "board"
                            ? "打板值"
                            : recommendationStyle === "intraday"
                              ? "盘中分"
                            : best.recommendationScore != null
                            ? "精选分"
                            : "综合分"
                        }
                      />
                    </div>

                    <div className="best-pick-card__metrics">
                      <div><span>现价 / 收盘</span><strong>{best.close.toFixed(2)}</strong></div>
                      <div><span>当日涨跌</span><strong className={best.dayRet >= 0 ? "is-up" : "is-down"}>{pct(best.dayRet)}</strong></div>
                      {recommendationStyle === "board" ? (
                        <>
                          <div>
                            <span>封板高度</span>
                            <strong>{best.limitStreak}板</strong>
                            <small>{best.limitToday ? "今日涨停" : "未封板"}</small>
                          </div>
                          <div>
                            <span>封单占流通</span>
                            <strong>{pct(best.auctionSeal?.floatCapRatio ?? 0)}</strong>
                            <small>{best.auctionSeal?.label ?? "等待封单"}</small>
                          </div>
                          <div>
                            <span>打板推荐值</span>
                            <strong>{boardPick?.score.toFixed(0) ?? "—"}</strong>
                            <small>{boardPick?.roleLabel ?? "打板模型"}</small>
                          </div>
                        </>
                      ) : recommendationStyle === "intraday" ? (
                        <>
                          <div>
                            <span>板块异动</span>
                            <strong>{best.intraday?.sectorName ?? best.industry}</strong>
                            <small>{pct((best.intraday?.sectorChangePct ?? 0) / 100)}</small>
                          </div>
                          <div>
                            <span>主力净流入</span>
                            <strong>
                              {best.intraday?.flowRank != null
                                ? money(best.intraday.mainNetInflow)
                                : "量价代理"}
                            </strong>
                            <small>
                              {best.intraday?.flowRank != null
                                ? `占成交 ${best.intraday.mainNetRatio.toFixed(1)}%`
                                : "资金榜暂缺，未虚构净流入"}
                            </small>
                          </div>
                          <div>
                            <span>量价关系</span>
                            <strong>
                              {best.intraday?.priceVsVwap != null
                                ? pct(best.intraday.priceVsVwap)
                                : "—"}
                            </strong>
                            <small>
                              量比 {(best.intraday?.volumeRatio ?? 0).toFixed(2)} ·{" "}
                              {best.intraday?.priceVsVwap != null &&
                              best.intraday.priceVsVwap >= 0
                                ? "站上分时均价"
                                : "低于分时均价"}
                            </small>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <span>次日可参与</span>
                            <strong>{best.actionabilityScore?.toFixed(0) ?? "—"}</strong>
                            <small>{best.actionabilityLabel ?? "等待量化"}</small>
                          </div>
                          <div><span>风险</span><strong className={`risk-${best.riskLevel}`}>{riskText(best.riskLevel)}</strong></div>
                          <div>
                            <span>打板推荐值</span>
                            <strong>{best.boardScore == null ? "—" : best.boardScore.toFixed(0)}</strong>
                            <small>{best.auctionSeal?.label ?? "等待9:25封单"}</small>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="best-pick-card__plan">
                      <div>
                        <span>
                          {recommendationStyle === "intraday"
                            ? "盘中承接观察区"
                            : "竞价入场观察区"}
                        </span>
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
                    {recommendationStyle === "board" && boardPick && (
                      <div className="best-pick-board-reason">
                        <span>打板模型值 {boardPick.score.toFixed(0)}</span>
                        <div>
                          {boardPick.reasons.map((reason) => (
                            <em key={reason}>{reason}</em>
                          ))}
                        </div>
                      </div>
                    )}
                    {recommendationStyle === "intraday" && best.intraday && (
                      <div className="best-pick-board-reason intraday-decision-reason">
                        <span>
                          盘中模型值 {best.intraday.score.toFixed(0)} ·{" "}
                          {best.intraday.actionLabel}
                        </span>
                        <div>
                          {best.intraday.reasons.map((reason) => (
                            <em key={reason}>{reason}</em>
                          ))}
                          {best.intraday.risks.map((risk) => (
                            <em className="is-risk" key={risk}>
                              {risk}
                            </em>
                          ))}
                        </div>
                      </div>
                    )}
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
                  <h2>
                    {tradingSession
                      ? "盘中行情确认"
                      : marketStatus.key === "lunch"
                        ? "午间行情确认"
                        : "行情确认"}
                  </h2>
                </div>
                <Clock3 size={22} />
              </div>
              <div className="decision-state">
                <span className="decision-state__dot" />
                <div>
                  <strong>
                    {dashboard.live?.mode === "auction"
                      ? "浏览器竞价已完成"
                      : dashboard.live?.mode === "intraday"
                        ? "盘中资金雷达已更新"
                      : dashboard.live?.mode === "review"
                        ? "收盘复盘已完成"
                      : "浏览器直连就绪"}
                  </strong>
                  <p>
                    {tradingSession
                      ? "交易时段每90秒自动更新板块、资金与量价评分"
                      : "打开或点击时在本机更新行情并重新计算"}
                  </p>
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
                  ? loadProgress > 0
                    ? `读取行情 ${loadProgress} 只`
                    : "刷新中…"
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
          recommendedCandidates={actionablePicks}
          onOpenStock={setSelectedCandidate}
        />

        {dashboard.live?.intraday && (
          <IntradayRadarPanel
            radar={dashboard.live.intraday}
            candidates={candidates}
            onSelect={setSelectedCandidate}
          />
        )}

        <section className="terminal-grid reveal reveal-3">
          <div className="queue-panel">
            <div className="section-heading">
              <div>
                <span className="section-index">03</span>
                <div>
                  <p>OBSERVATION POOL</p>
                  <h2>
                    {recommendationStyle === "board"
                      ? "打板备选雷达"
                      : recommendationStyle === "intraday" ||
                          dashboard.live?.mode === "intraday"
                        ? "盘中异动雷达"
                      : dashboard.live?.mode === "auction"
                        ? "竞价雷达"
                        : "候选雷达"}
                  </h2>
                </div>
              </div>
              <div className="section-heading-actions">
                <div className="section-meta">
                  主板权限 ·{" "}
                  {recommendationStyle === "board"
                    ? `主选2只 + 备选${Math.max(0, boardUniverse.length - 2)}只`
                    : recommendationStyle === "intraday"
                      ? `盘中实时候选${candidates.length}只 · 90秒刷新`
                    : `首页前 ${candidates.length} 只`}
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
            <CandidateTable
              candidates={displayedCandidates}
              onSelect={setSelectedCandidate}
              preferredCodes={preferredCodes}
              preferredLabels={preferredLabels}
            />
            {recommendationStyle === "trend" && (
              <CandidateAnomalyPanel
                candidates={candidates}
                onSelect={setSelectedCandidate}
              />
            )}
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
            <h2>全天交易执行流程</h2>
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
            <strong>盘中资金复核</strong>
            <p>每90秒重排板块异动、主力净流入、量比和分时均价承接。</p>
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
            preferredCodes={preferredCodes}
            preferredLabels={preferredLabels}
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
