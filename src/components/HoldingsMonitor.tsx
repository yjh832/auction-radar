import { useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Briefcase,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2
} from "lucide-react";
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
  detectMarketStatus,
  fetchHoldingQuotes,
  fetchHoldingTechnical
} from "../lib/market";
import type {
  HoldingPosition,
  HoldingSnapshot,
  HoldingTechnicalProfile,
  StrategyDashboard
} from "../types";

const ENABLED_KEY = "auction-radar:holdings-monitor-enabled:v1";

function pct(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function money(value: number) {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)}万`;
  return value.toFixed(2);
}

function signalClass(kind: HoldingSnapshot["signal"]["kind"]) {
  if (kind === "stop" || kind === "distribution") return "is-stop";
  if (kind === "take_profit") return "is-take";
  if (kind === "reduce") return "is-reduce";
  if (kind === "add" || kind === "washout" || kind === "breakout") return "is-add";
  return "is-hold";
}

function HoldingCard({
  snapshot,
  onChange,
  onDelete
}: {
  snapshot: HoldingSnapshot;
  onChange: (position: HoldingPosition) => void;
  onDelete: (code: string) => void;
}) {
  const { position, quote } = snapshot;
  const [editing, setEditing] = useState(false);

  return (
    <article className={`holding-card ${signalClass(snapshot.signal.kind)}`}>
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
        <div className="holding-edit-grid">
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

      <footer>
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

export function HoldingsMonitor({ strategy }: { strategy: StrategyDashboard }) {
  const [positions, setPositions] = useState<HoldingPosition[]>(loadHoldings);
  const [snapshots, setSnapshots] = useState<HoldingSnapshot[]>([]);
  const [code, setCode] = useState("");
  const [cost, setCost] = useState("");
  const [shares, setShares] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    saveHoldings(positions);
  }, [positions]);

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
        const snapshot = evaluateHolding(
          position,
          quote,
          rapidSignal,
          technicalCache.current.get(position.code)
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
        createdAt: new Date().toISOString()
      };
      const next = [
        ...positions.filter((item) => item.code !== normalizedCode),
        nextPosition
      ];
      setPositions(next);
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
    setPositions((current) =>
      current.map((item) =>
        item.code === nextPosition.code ? nextPosition : item
      )
    );
    setSnapshots((current) =>
      current.map((item) =>
        item.position.code === nextPosition.code
          ? evaluateHolding(nextPosition, item.quote)
          : item
      )
    );
  }

  function deletePosition(positionCode: string) {
    tickHistory.current.delete(positionCode);
    technicalCache.current.delete(positionCode);
    technicalAttempts.current.delete(positionCode);
    setPositions((current) =>
      current.filter((item) => item.code !== positionCode)
    );
    setSnapshots((current) =>
      current.filter((item) => item.position.code !== positionCode)
    );
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

  return (
    <section className="holdings-panel" aria-label="我的持仓实时监控">
      <div className="holdings-heading">
        <div>
          <p>MY PORTFOLIO / LIVE MONITOR</p>
          <h2>我的持仓</h2>
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
            />
          ))}
        </div>
      )}

      <p className="holdings-notification-note">
        {notificationGranted
          ? "已授权通知：PWA 打开或仍在系统后台存活时会发送系统提醒。浏览器彻底关闭后，若要继续推送，需要额外的免费推送服务端。"
          : "手机系统通知需要点击“开启通知”并允许权限；iPhone 需先将网页安装到主屏幕。APP完全关闭后的持续推送不由纯静态网页提供。"}
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
    </section>
  );
}
