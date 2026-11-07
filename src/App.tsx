import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Check,
  Clock3,
  Database,
  Download,
  Gauge,
  Landmark,
  Radar,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  TimerReset,
  TrendingUp,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import strategyFallback from "../data/strategy.json";
import { CandidateTable } from "./components/CandidateTable";
import { ScoreDial } from "./components/ScoreDial";
import { Sparkline } from "./components/Sparkline";
import { loadCachedResult, saveCachedResult } from "./lib/cache";
import {
  detectMarketStatus,
  fetchSinaMarketSnapshot,
  scoreWithSnapshot
} from "./lib/market";
import type { Candidate, StrategyDashboard } from "./types";

const fallbackStrategy = strategyFallback as StrategyDashboard;

function pct(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
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
  const bootstrapped = useRef(false);

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
        detectMarketStatus(new Date()).liveEligible
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
  const hasLiveAttempt = Boolean(dashboard.live);
  const recommendation = hasLiveAttempt
    ? dashboard.live?.recommendation ?? null
    : dashboard.recommendation;
  const candidates = dashboard.live?.candidates?.length
    ? dashboard.live.candidates
    : dashboard.candidates;
  const pick = recommendation ?? dashboard.recommendation;

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

  const topReasons = [
    `${pick.industry}板块上日有${pick.sectorLimitCount}只涨停`,
    `近20日出现${pick.limit20}次涨停`,
    `上日竞价额约为前5日均额的${(pick.lastAuction.ratio * 100).toFixed(2)}%`,
    pick.limitStreak > 1 ? `${pick.limitStreak}连板后仍有主动承接` : "首板后仍保持日内高位收盘"
  ];

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
      const snapshot = await fetchSinaMarketSnapshot(setLoadProgress);
      const live = scoreWithSnapshot(base, snapshot);
      setDashboard((current) => ({ ...current, live }));
      saveCachedResult(live);
      if (!silent) {
        setNotice(
          live.mode === "auction"
            ? live.recommendation
              ? `9:25竞价刷新完成：${live.recommendation.name}`
              : live.noPickReason ?? "今日无满足条件的标的。"
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

      <div className="market-tape" aria-label="市场状态">
        <div className="market-tape__live">
          <ScanLine size={17} />
          <span>MARKET TAPE</span>
        </div>
        {dashboard.market.indices.map((index) => (
          <div className="tape-index" key={index.name}>
            <span>{index.name}</span>
            <strong>{index.value.toFixed(2)}</strong>
            <em className={index.changePct >= 0 ? "is-up" : "is-down"}>
              {pct(index.changePct)}
            </em>
          </div>
        ))}
        <div className="tape-breadth">
          <Activity size={15} />
          <span>
            {dashboard.live
              ? `浏览器快照 ${dashboard.live.quoteCount} 只 · 高开 ${dashboard.live.positiveOpenCount} 只`
              : dashboard.market.breadthNote}
          </span>
        </div>
      </div>

      <main id="top" className="page-frame">
        <section className="hero-grid">
          <article className="pick-panel reveal reveal-1">
            <div className="pick-panel__eyebrow">
              <span>今日唯一推荐</span>
              <span className="eyebrow-en">UNIQUE CONVICTION PICK</span>
            </div>

            <div className="pick-panel__headline">
              <div>
                <div className="stock-tags">
                  <span>风险调整 #{pick.rank}</span>
                  <span>{pick.industry}</span>
                  {pick.limitToday && <span className="tag-red">上日封板</span>}
                </div>
                <h1>{pick.name}</h1>
                <p className="stock-code">{pick.code} · 深沪 A 股</p>
              </div>
              <ScoreDial value={pick.compositeScore} label="综合分" />
            </div>

            <p className="pick-thesis">
              {pick.limitStreak > 1 ? "强势连板" : "首板确认"}叠加
              <strong>{pick.industry}</strong>板块温度，模型与风险约束共同给出的当日优先观察对象。
            </p>

            <div className="pick-metrics">
              <div className="pick-metric">
                <span>模型分</span>
                <strong>{(pick.modelScore * 100).toFixed(1)}</strong>
                <small>原始排序</small>
              </div>
              <div className="pick-metric">
                <span>上日收盘</span>
                <strong>{pick.close.toFixed(2)}</strong>
                <small className={pick.dayRet >= 0 ? "is-up" : "is-down"}>
                  {pct(pick.dayRet)}
                </small>
              </div>
              <div className="pick-metric">
                <span>上日竞价额比</span>
                <strong>{(pick.lastAuction.ratio * 100).toFixed(2)}%</strong>
                <small>占前5日均额</small>
              </div>
              <div className="pick-metric">
                <span>风险等级</span>
                <strong className={`risk-${pick.riskLevel}`}>{riskText(pick.riskLevel)}</strong>
                <small>扣分 {pick.riskPenalty.toFixed(2)}</small>
              </div>
            </div>

            <div className="pick-chart-row">
              <div>
                <div className="section-kicker">
                  <TrendingUp size={14} />
                  近20日收盘结构
                </div>
                <Sparkline points={pick.history} />
              </div>
              <div className="reason-list">
                <div className="section-kicker">
                  <Gauge size={14} />
                  入选依据
                </div>
                {topReasons.map((reason) => (
                  <div className="reason-row" key={reason}>
                    <Check size={14} />
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
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
                  ? `读取全市场 ${loadProgress} 只`
                  : marketStatus.liveEligible
                    ? "刷新9:25竞价"
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

        <section className="terminal-grid reveal reveal-3">
          <div className="queue-panel">
            <div className="section-heading">
              <div>
                <span className="section-index">02</span>
                <div>
                  <p>RANKED UNIVERSE</p>
                  <h2>候选梯队</h2>
                </div>
              </div>
              <div className="section-meta">
                共 {candidates.length} 只 · 综合分排序
              </div>
            </div>
            <CandidateTable candidates={candidates} />
          </div>

          <aside className="evidence-panel">
            <div className="section-heading section-heading--small">
              <div>
                <span className="section-index">03</span>
                <div>
                  <p>MODEL EVIDENCE</p>
                  <h2>验证指标</h2>
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

            <div className="data-stamp">
              <Database size={15} />
              <div>
                <span>数据截止</span>
                <strong>{formatChinaDate(dashboard.asOf)}</strong>
              </div>
            </div>
          </aside>
        </section>

        <section className="workflow-strip reveal reveal-4">
          <div className="workflow-title">
            <p>DAILY PIPELINE</p>
            <h2>每天如何得到唯一标的</h2>
          </div>
          <div className="workflow-step">
            <span>01</span>
            <strong>收盘后建池</strong>
            <p>更新日线与涨停记忆，过滤ST、流动性不足和极端过热。</p>
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
    </div>
  );
}

export default App;
