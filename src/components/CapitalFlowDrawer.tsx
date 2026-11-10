import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ReceiptText,
  RotateCcw,
  Target,
  Trash2,
  TrendingUp,
  Wallet,
  X
} from "lucide-react";
import { createHoldingTrade } from "../lib/capitalFlow";
import { analyzeCapitalFlow } from "../lib/capitalFlowAnalysis";
import type {
  HoldingPosition,
  HoldingSnapshot,
  HoldingTradeRecord
} from "../types";

export interface CapitalFlowRecommendation {
  code: string;
  name: string;
  rank: 1 | 2;
  date: string;
  modelScore: number;
}

function pct(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function money(value: number) {
  const sign = value > 0 ? "+" : "";
  if (Math.abs(value) >= 100_000_000) {
    return `${sign}${(value / 100_000_000).toFixed(2)}亿`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${sign}${(value / 10_000).toFixed(2)}万`;
  }
  return `${sign}${value.toFixed(2)}`;
}

function chinaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function CapitalFlowChart({
  points
}: {
  points: ReturnType<typeof analyzeCapitalFlow>["points"];
}) {
  if (points.length < 2) {
    return (
      <div className="capital-flow-chart-empty">
        <TrendingUp size={22} />
        <span>记录第一笔买入后生成资金曲线</span>
      </div>
    );
  }

  const width = 760;
  const height = 250;
  const left = 52;
  const right = 18;
  const top = 20;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = points.flatMap((point) => [point.netInvested, point.profit]);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = Math.max(max - min, 1);
  const x = (index: number) =>
    left + (index / Math.max(1, points.length - 1)) * plotWidth;
  const y = (value: number) => top + ((max - value) / span) * plotHeight;
  const pathFor = (key: "netInvested" | "profit") =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(point[key]).toFixed(2)}`
      )
      .join(" ");
  const lastX = x(points.length - 1);
  const firstX = x(0);
  const areaPath =
    `${pathFor("netInvested")} L ${lastX.toFixed(2)} ${y(0).toFixed(2)} ` +
    `L ${firstX.toFixed(2)} ${y(0).toFixed(2)} Z`;

  return (
    <div className="capital-flow-chart">
      <div className="capital-flow-chart-legend">
        <span><i className="is-capital" />净投入</span>
        <span><i className="is-profit" />累计收益</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="持仓资金走势">
        {[0, 0.5, 1].map((ratio) => {
          const value = max - span * ratio;
          return (
            <g key={ratio}>
              <line
                x1={left}
                x2={width - right}
                y1={top + plotHeight * ratio}
                y2={top + plotHeight * ratio}
                className="chart-gridline"
              />
              <text
                x={left - 8}
                y={top + plotHeight * ratio + 3}
                textAnchor="end"
                className="chart-axis-label"
              >
                {money(value)}
              </text>
            </g>
          );
        })}
        <line
          x1={left}
          x2={width - right}
          y1={y(0)}
          y2={y(0)}
          className="capital-flow-zero"
        />
        <path d={areaPath} className="capital-flow-area" />
        <path d={pathFor("netInvested")} className="capital-flow-line is-capital" />
        <path d={pathFor("profit")} className="capital-flow-line is-profit" />
        {points.map((point, index) => (
          <g key={point.id} className="capital-flow-point">
            <circle
              cx={x(index)}
              cy={y(point.netInvested)}
              r="3.5"
              className="is-capital"
            />
            <circle
              cx={x(index)}
              cy={y(point.profit)}
              r="3.5"
              className="is-profit"
            />
          </g>
        ))}
        <text x={left} y={height - 8} className="chart-axis-label">
          {points[0].date.slice(5)}
        </text>
        <text
          x={width - right}
          y={height - 8}
          textAnchor="end"
          className="chart-axis-label"
        >
          {points.at(-1)?.date.slice(5)}
        </text>
      </svg>
    </div>
  );
}

export function CapitalFlowDrawer({
  positions,
  snapshots,
  recommendations,
  trades,
  onClose,
  onRecordSale,
  onDeleteTrade
}: {
  positions: HoldingPosition[];
  snapshots: HoldingSnapshot[];
  recommendations: CapitalFlowRecommendation[];
  trades: HoldingTradeRecord[];
  onClose: () => void;
  onRecordSale: (trade: HoldingTradeRecord) => void;
  onDeleteTrade: (trade: HoldingTradeRecord) => void;
}) {
  const analysis = useMemo(
    () => analyzeCapitalFlow(trades, snapshots),
    [snapshots, trades]
  );
  const snapshotMap = useMemo(
    () => new Map(snapshots.map((item) => [item.position.code, item])),
    [snapshots]
  );
  const [sellCode, setSellCode] = useState(positions[0]?.code ?? "");
  const [sellPrice, setSellPrice] = useState("");
  const [sellShares, setSellShares] = useState("");
  const [sellFee, setSellFee] = useState("0");
  const [sellDate, setSellDate] = useState(chinaToday);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [ledgerMessage, setLedgerMessage] = useState<string | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (positions.some((position) => position.code === sellCode)) return;
    const first = positions[0];
    setSellCode(first?.code ?? "");
    setSellPrice(
      first
        ? String(snapshotMap.get(first.code)?.quote.price ?? first.cost)
        : ""
    );
    setSellShares(first ? String(first.shares) : "");
  }, [positions, sellCode, snapshotMap]);

  function selectSellCode(code: string) {
    const position = positions.find((item) => item.code === code);
    setSellCode(code);
    setSellPrice(
      String(
        snapshotMap.get(code)?.quote.price ??
          position?.cost ??
          ""
      )
    );
    setSellShares(String(position?.shares ?? ""));
    setMessage(null);
    setFormError(null);
  }

  function recordSale(event: React.FormEvent) {
    event.preventDefault();
    const position = positions.find((item) => item.code === sellCode);
    const price = Number(sellPrice);
    const shares = Number(sellShares);
    const fee = Number(sellFee) || 0;
    if (!position) {
      setFormError("请选择当前持仓。");
      return;
    }
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(shares) ||
      shares <= 0 ||
      shares > position.shares ||
      !sellDate
    ) {
      setFormError("请输入有效卖出日期、价格和不超过当前持仓的股数。");
      return;
    }
    const trade = createHoldingTrade({
      code: position.code,
      name: position.name,
      side: "sell",
      price,
      shares,
      fee: Math.max(0, fee),
      tradeDate: sellDate,
      source: "manual",
      saleKind: shares >= position.shares ? "clear" : "t",
      costBasis: position.cost * shares,
      note: `卖出 ${shares} 股`
    });
    onRecordSale(trade);
    setMessage(
      shares >= position.shares
        ? `${position.name} 已全部卖出并计入资金曲线。`
        : `${position.name} 已卖出 ${shares} 股并计入资金曲线。`
    );
    setFormError(null);
    const remaining = position.shares - shares;
    setSellShares(remaining > 0 ? String(remaining) : "");
  }

  const latestTrades = trades
    .map((trade, index) => ({ trade, index }))
    .sort(
      (a, b) =>
        new Date(b.trade.tradeDate).getTime() -
          new Date(a.trade.tradeDate).getTime() ||
        b.index - a.index
    )
    .map((item) => item.trade);

  function deleteTrade(trade: HoldingTradeRecord, undo = false) {
    onDeleteTrade(trade);
    setPendingDeleteId(null);
    setUndoPending(false);
    setLedgerMessage(
      `${undo ? "已撤销" : "已删除"}${trade.name}${trade.side === "buy" ? "买入" : "卖出"}记录，持仓数量已同步回算。`
    );
  }

  return (
    <div className="capital-flow-root" role="presentation">
      <button
        type="button"
        className="capital-flow-backdrop"
        aria-label="关闭资金走势"
        onClick={onClose}
      />
      <aside
        className="capital-flow-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="持仓资金走势与交易记录"
      >
        <header className="capital-flow-header">
          <div>
            <span>CAPITAL FLOW / TRADE JOURNAL</span>
            <h2>持仓资金走势</h2>
            <p>把推荐买入与卖出结果沉淀为可回看的胜率样本。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>

        <section className="capital-flow-summary">
          <div>
            <span>总收益率</span>
            <strong className={analysis.returnPct >= 0 ? "is-up" : "is-down"}>
              {pct(analysis.returnPct)}
            </strong>
            <small>已实现 + 当前浮动</small>
          </div>
          <div>
            <span>已实现盈亏</span>
            <strong className={analysis.realizedPnl >= 0 ? "is-up" : "is-down"}>
              {money(analysis.realizedPnl)}
            </strong>
            <small>{analysis.settlements.length} 笔卖出结算</small>
          </div>
          <div>
            <span>当前净投入</span>
            <strong>{money(analysis.netInvested)}</strong>
            <small>持仓市值 {money(analysis.openMarketValue)}</small>
          </div>
          <div>
            <span>推荐跟投胜率</span>
            <strong>
              {analysis.recommendationSamples
                ? pct(analysis.recommendationWinRate)
                : "—"}
            </strong>
            <small>
              {analysis.recommendationWins}/{analysis.recommendationSamples} 笔盈利
            </small>
          </div>
        </section>

        <div className="capital-flow-profit-split">
          <div>
            <span>做T收益</span>
            <strong className={analysis.tTradePnl >= 0 ? "is-up" : "is-down"}>
              {money(analysis.tTradePnl)}
            </strong>
            <small>{analysis.tTradeCount} 笔部分卖出结算</small>
          </div>
          <div>
            <span>清仓收益</span>
            <strong className={analysis.clearPnl >= 0 ? "is-up" : "is-down"}>
              {money(analysis.clearPnl)}
            </strong>
            <small>{analysis.clearCount} 次持仓清仓</small>
          </div>
        </div>

        <section className="capital-flow-section">
          <div className="capital-flow-section-title">
            <div>
              <span>CAPITAL CURVE</span>
              <h3>买入卖出后的资金轨迹</h3>
            </div>
            <TrendingUp size={19} />
          </div>
          <CapitalFlowChart points={analysis.points} />
          <p className="capital-flow-method">
            净投入 = 累计买入金额 − 累计卖出净额；累计收益在卖出时结算已实现盈亏，并追加当前持仓浮动盈亏。
          </p>
        </section>

        <section className="capital-flow-section">
          <div className="capital-flow-section-title">
            <div>
              <span>TOP TWO TRACKING</span>
              <h3>当前首选 / 备选跟投记录</h3>
            </div>
            <Target size={19} />
          </div>
          <div className="capital-flow-recommendations">
            {recommendations.length ? (
              recommendations.map((recommendation) => {
                const related = trades.filter(
                  (trade) => trade.code === recommendation.code
                );
                const buys = related.filter((trade) => trade.side === "buy");
                const current = snapshotMap.get(recommendation.code);
                const invested = buys.reduce(
                  (sum, trade) => sum + trade.price * trade.shares + trade.fee,
                  0
                );
                return (
                  <article key={`${recommendation.date}-${recommendation.code}`}>
                    <div>
                      <b>{recommendation.rank === 1 ? "首选" : "备选"}</b>
                      <strong>{recommendation.name}</strong>
                      <span>{recommendation.code}</span>
                    </div>
                    {buys.length ? (
                      <>
                        <div>
                          <span>累计买入</span>
                          <strong>{money(invested)}</strong>
                        </div>
                        <div>
                          <span>{current ? "当前持仓收益" : "已结束"}</span>
                          <strong
                            className={
                              current
                                ? current.pnlPct >= 0
                                  ? "is-up"
                                  : "is-down"
                                : ""
                            }
                          >
                            {current ? pct(current.pnlPct) : "已结算"}
                          </strong>
                        </div>
                      </>
                    ) : (
                      <p>尚未记录买入，买入后自动纳入推荐样本。</p>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="capital-flow-empty">
                当前没有可追踪的首选或备选标的。
              </div>
            )}
          </div>
          <p className="capital-flow-method">
            加入监测时若代码属于当前首选或备选，会自动标记推荐来源；只有完整卖出且能匹配到推荐买入的记录才计入胜率。
          </p>
        </section>

        <section className="capital-flow-section">
          <div className="capital-flow-section-title">
            <div>
              <span>RECORD A SALE</span>
              <h3>记录做T / 清仓</h3>
            </div>
            <Wallet size={19} />
          </div>
          <form className="capital-flow-sell-form" onSubmit={recordSale}>
            <label>
              持仓标的
              <select
                value={sellCode}
                onChange={(event) => selectSellCode(event.target.value)}
                disabled={!positions.length}
              >
                {positions.length ? (
                  positions.map((position) => (
                    <option key={position.code} value={position.code}>
                      {position.name} · {position.code}
                    </option>
                  ))
                ) : (
                  <option value="">暂无持仓</option>
                )}
              </select>
            </label>
            <label>
              卖出日期
              <input
                type="date"
                value={sellDate}
                onChange={(event) => setSellDate(event.target.value)}
              />
            </label>
            <label>
              卖出价格
              <input
                inputMode="decimal"
                value={sellPrice}
                placeholder="成交价"
                onChange={(event) => setSellPrice(event.target.value)}
              />
            </label>
            <label>
              卖出股数
              <input
                inputMode="numeric"
                value={sellShares}
                placeholder="股数"
                onChange={(event) => setSellShares(event.target.value)}
              />
            </label>
            <label>
              手续费
              <input
                inputMode="decimal"
                value={sellFee}
                placeholder="0"
                onChange={(event) => setSellFee(event.target.value)}
              />
            </label>
            <button type="submit" disabled={!positions.length}>
              <ArrowDownRight size={16} />
              记录卖出
            </button>
          </form>
          <p className="capital-flow-method">
            少于全部持仓会记为做T卖出；卖出全部持仓会记为清仓。两者都会同步扣减持仓并永久保留交易流水。
          </p>
          {formError && <div className="capital-flow-form-error">{formError}</div>}
          {message && <div className="capital-flow-form-success">{message}</div>}
        </section>

        <section className="capital-flow-section capital-flow-ledger">
          <div className="capital-flow-section-title">
            <div>
              <span>TRADE LEDGER</span>
              <h3>买卖流水</h3>
            </div>
            <div className="capital-flow-ledger-actions">
              <button
                type="button"
                className={undoPending ? "is-confirming" : ""}
                disabled={!latestTrades.length}
                onClick={() => {
                  if (!latestTrades.length) return;
                  if (!undoPending) {
                    setUndoPending(true);
                    setPendingDeleteId(null);
                    return;
                  }
                  deleteTrade(latestTrades[0], true);
                }}
              >
                <RotateCcw size={14} />
                {undoPending ? "确认撤销" : "撤销最后一笔"}
              </button>
              <ReceiptText size={19} />
            </div>
          </div>
          {latestTrades.length ? (
            <div className="capital-flow-trade-list">
              {latestTrades.map((trade) => {
                const settlement = analysis.settlements.find(
                  (item) => item.tradeId === trade.id
                );
                const sourceLabel =
                  trade.recommendationRank === 1
                    ? "推荐首选"
                    : trade.recommendationRank === 2
                      ? "推荐备选"
                      : trade.source === "recommendation"
                        ? "推荐标的"
                        : "手动记录";
                return (
                  <article key={trade.id}>
                    <div className={`capital-flow-trade-side is-${trade.side}`}>
                      {trade.side === "buy" ? (
                        <ArrowUpRight size={15} />
                      ) : (
                        <ArrowDownRight size={15} />
                      )}
                      {trade.side === "buy" ? "买入" : "卖出"}
                    </div>
                    <div className="capital-flow-trade-identity">
                      <strong>{trade.name}</strong>
                      <span>
                        {trade.code} · {trade.tradeDate}
                        {trade.side === "sell"
                          ? ` · ${trade.saleKind === "clear" ? "清仓" : "做T"}`
                          : ""}
                      </span>
                    </div>
                    <div>
                      <span>成交</span>
                      <strong>{trade.price.toFixed(2)} × {trade.shares}</strong>
                    </div>
                    <div>
                      <span>金额</span>
                      <strong>{money(trade.price * trade.shares)}</strong>
                    </div>
                    <div className="capital-flow-trade-result">
                      <span>{settlement ? "结算收益" : "来源"}</span>
                      <div>
                        {settlement ? (
                          <strong className={settlement.pnl >= 0 ? "is-up" : "is-down"}>
                            {money(settlement.pnl)} · {pct(settlement.pnlPct)}
                          </strong>
                        ) : (
                          <strong>{sourceLabel}</strong>
                        )}
                        <button
                          type="button"
                          className={pendingDeleteId === trade.id ? "is-confirming" : ""}
                          onClick={() => {
                            if (pendingDeleteId !== trade.id) {
                              setPendingDeleteId(trade.id);
                              setUndoPending(false);
                              return;
                            }
                            deleteTrade(trade);
                          }}
                        >
                          <Trash2 size={12} />
                          {pendingDeleteId === trade.id ? "确认删除" : "删除"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="capital-flow-empty">
              <ReceiptText size={22} />
              <strong>还没有交易流水</strong>
              <p>加入监测会自动记录第一笔买入，之后在面板中记录卖出。</p>
            </div>
          )}
          {ledgerMessage && (
            <div className="capital-flow-ledger-message">{ledgerMessage}</div>
          )}
        </section>

        <p className="capital-flow-disclaimer">
          个人交易样本仅用于回顾执行效果，不会直接改写每日选股权重；样本积累后再结合推荐日、市场环境和买卖点进行归因分析。
        </p>
      </aside>
    </div>
  );
}
