import { useEffect, useId, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  CircleDollarSign,
  Gauge,
  Landmark,
  RefreshCw,
  TrendingUp,
  X
} from "lucide-react";
import { fetchStockDetail } from "../lib/market";
import type { Candidate, DailyBar, StockDetailData } from "../types";

interface StockDetailDrawerProps {
  candidate: Candidate;
  onClose: () => void;
}

function pct(value: number | null, digits = 2) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function money(value: number) {
  if (!Number.isFinite(value) || value === 0) return "—";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(0)}万`;
  return value.toFixed(0);
}

function CandleChart({ bars }: { bars: DailyBar[] }) {
  const gradientId = useId().replace(/:/g, "");
  if (bars.length < 2) {
    return <div className="drawer-empty">K线数据不足</div>;
  }

  const width = 760;
  const height = 330;
  const left = 42;
  const right = 18;
  const top = 18;
  const priceHeight = 220;
  const volumeTop = 264;
  const volumeHeight = 46;
  const plotWidth = width - left - right;
  const minPrice = Math.min(...bars.map((bar) => bar.low));
  const maxPrice = Math.max(...bars.map((bar) => bar.high));
  const priceSpan = Math.max(maxPrice - minPrice, 0.01);
  const maxVolume = Math.max(...bars.map((bar) => bar.volume), 1);
  const step = plotWidth / bars.length;
  const bodyWidth = Math.min(step * 0.5, 18);

  const yPrice = (price: number) =>
    top + ((maxPrice - price) / priceSpan) * priceHeight;
  const maPoints = bars
    .map((bar, index) =>
      bar.ma5 === null
        ? null
        : `${left + step * (index + 0.5)},${yPrice(bar.ma5)}`
    )
    .filter((point): point is string => Boolean(point))
    .join(" ");

  return (
    <div className="candle-chart">
      <div className="chart-legend">
        <span><i className="legend-up" />上涨</span>
        <span><i className="legend-down" />下跌</span>
        <span><i className="legend-ma" />MA5</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="最近30个交易日K线图">
        <defs>
          <linearGradient id={`volume-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#B58A4C" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#B58A4C" stopOpacity="0.16" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maxPrice - ratio * priceSpan;
          const y = top + ratio * priceHeight;
          return (
            <g key={ratio}>
              <line x1={left} x2={width - right} y1={y} y2={y} className="chart-gridline" />
              <text x={left - 7} y={y + 3} textAnchor="end" className="chart-axis-label">
                {value.toFixed(2)}
              </text>
            </g>
          );
        })}
        {bars.map((bar, index) => {
          const x = left + step * (index + 0.5);
          const up = bar.close >= bar.open;
          const color = up ? "#C84B31" : "#28705C";
          const bodyTop = Math.min(yPrice(bar.open), yPrice(bar.close));
          const bodyHeight = Math.max(
            2,
            Math.abs(yPrice(bar.open) - yPrice(bar.close))
          );
          const volumeHeightValue = (bar.volume / maxVolume) * volumeHeight;
          return (
            <g key={bar.date}>
              <title>
                {`${bar.date} 开 ${bar.open.toFixed(2)} 高 ${bar.high.toFixed(2)} 低 ${bar.low.toFixed(2)} 收 ${bar.close.toFixed(2)}`}
              </title>
              <line
                x1={x}
                x2={x}
                y1={yPrice(bar.high)}
                y2={yPrice(bar.low)}
                stroke={color}
                strokeWidth="1.4"
              />
              <rect
                x={x - bodyWidth / 2}
                y={bodyTop}
                width={bodyWidth}
                height={bodyHeight}
                fill={up ? color : "#F2EEE5"}
                stroke={color}
                strokeWidth="1.6"
              />
              <rect
                x={x - bodyWidth / 2}
                y={volumeTop + volumeHeight - volumeHeightValue}
                width={bodyWidth}
                height={volumeHeightValue}
                fill={`url(#volume-${gradientId})`}
                opacity={up ? 0.9 : 0.48}
              />
            </g>
          );
        })}
        <polyline
          points={maPoints}
          fill="none"
          stroke="#B58A4C"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1={left}
          x2={width - right}
          y1={volumeTop - 8}
          y2={volumeTop - 8}
          className="chart-vol-divider"
        />
        <text x={left} y={height - 6} className="chart-axis-label">
          {bars[0].date.slice(5)}
        </text>
        <text x={width / 2} y={height - 6} textAnchor="middle" className="chart-axis-label">
          {bars[Math.floor(bars.length / 2)].date.slice(5)}
        </text>
        <text x={width - right} y={height - 6} textAnchor="end" className="chart-axis-label">
          {bars.at(-1)?.date.slice(5)}
        </text>
      </svg>
    </div>
  );
}

export function StockDetailDrawer({
  candidate,
  onClose
}: StockDetailDrawerProps) {
  const [detail, setDetail] = useState<StockDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);
    fetchStockDetail(candidate)
      .then((data) => {
        if (!controller.signal.aborted) setDetail(data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "详情加载失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [candidate, retryKey]);

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

  const quote = detail?.quote;

  return (
    <div className="stock-drawer-root" role="presentation">
      <button className="stock-drawer-backdrop" aria-label="关闭股票详情" onClick={onClose} />
      <aside className="stock-drawer" role="dialog" aria-modal="true" aria-label={`${candidate.name}股票详情`}>
        <header className="drawer-header">
          <div>
            <span className="drawer-kicker">STOCK INTELLIGENCE / {candidate.code}</span>
            <h2>{candidate.name}</h2>
            <p>{candidate.industry} · 风险调整第 {candidate.rank} 名</p>
          </div>
          <button className="drawer-close" type="button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>

        {loading && (
          <div className="drawer-loading">
            <RefreshCw size={24} className="spin" />
            <strong>正在读取行情、K线和龙虎榜</strong>
            <span>浏览器直接连接公开数据源</span>
          </div>
        )}

        {error && (
          <div className="drawer-error">
            <AlertTriangle size={20} />
            <div>
              <strong>详情加载失败</strong>
              <p>{error}</p>
            </div>
            <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
              重试
            </button>
          </div>
        )}

        {detail && quote && (
          <>
            <section className="drawer-price-row">
              <div>
                <span>最新价格</span>
                <strong>{quote.price.toFixed(2)}</strong>
                <em className={quote.changePct >= 0 ? "is-up" : "is-down"}>
                  {quote.change >= 0 ? "+" : ""}
                  {quote.change.toFixed(2)} / {pct(quote.changePct)}
                </em>
              </div>
              <div className="drawer-market-badge">
                <span>{quote.updatedAt.slice(8, 10)}:{quote.updatedAt.slice(10, 12)}</span>
                <strong>行情快照</strong>
              </div>
            </section>

            <section className="drawer-metric-grid">
              <div><span><CircleDollarSign size={13} />成交额</span><strong>{money(quote.amount)}</strong></div>
              <div><span><Gauge size={13} />实际换手率</span><strong>{quote.turnoverRate.toFixed(2)}%</strong></div>
              <div><span><TrendingUp size={13} />振幅</span><strong>{quote.amplitude.toFixed(2)}%</strong></div>
              <div><span><BarChart3 size={13} />量比</span><strong>{quote.volumeRatio.toFixed(2)}</strong></div>
              <div><span><Building2 size={13} />总市值</span><strong>{money(quote.marketCap)}</strong></div>
              <div><span><Landmark size={13} />流通市值</span><strong>{money(quote.floatCap)}</strong></div>
              <div><span>今开 / 昨收</span><strong>{quote.open.toFixed(2)} / {quote.preClose.toFixed(2)}</strong></div>
              <div><span>最高 / 最低</span><strong>{quote.high.toFixed(2)} / {quote.low.toFixed(2)}</strong></div>
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title">
                <div>
                  <span>PRICE STRUCTURE</span>
                  <h3>最近30日K线</h3>
                </div>
                <BarChart3 size={18} />
              </div>
              <CandleChart bars={detail.kline} />
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title">
                <div>
                  <span>TRADING FOCUS</span>
                  <h3>涨停基因与风险</h3>
                </div>
                <CalendarDays size={18} />
              </div>
              <div className="drawer-gene-grid">
                <div><span>近20日涨停</span><strong>{candidate.limit20} 次</strong></div>
                <div><span>近60日涨停</span><strong>{candidate.limit60} 次</strong></div>
                <div><span>5日涨跌</span><strong className={candidate.ret5 >= 0 ? "is-up" : "is-down"}>{pct(candidate.ret5)}</strong></div>
                <div><span>10日涨跌</span><strong className={candidate.ret10 >= 0 ? "is-up" : "is-down"}>{pct(candidate.ret10)}</strong></div>
                <div><span>板块强势股</span><strong>{candidate.sectorStrongCount} / {candidate.sectorN}</strong></div>
                <div><span>综合分</span><strong>{(candidate.compositeScore * 100).toFixed(1)}</strong></div>
              </div>
              <ul className="drawer-risk-list">
                {candidate.riskNotes.map((note) => (
                  <li key={note}><AlertTriangle size={13} />{note}</li>
                ))}
              </ul>
            </section>

            <section className="drawer-section drawer-lhb-section">
              <div className="drawer-section-title">
                <div>
                  <span>DRAGON-TIGER LIST</span>
                  <h3>最近龙虎榜</h3>
                </div>
                <TrendingUp size={18} />
              </div>
              {detail.dragonTiger.length === 0 ? (
                <div className="drawer-empty">当前接口未返回该股票近期龙虎榜记录。</div>
              ) : (
                <div className="lhb-list">
                  {detail.dragonTiger.map((record) => (
                    <article className="lhb-item" key={`${record.date}-${record.reason}`}>
                      <div className="lhb-item-head">
                        <strong>{record.date}</strong>
                        <span className={record.changePct >= 0 ? "is-up" : "is-down"}>
                          {pct(record.changePct)}
                        </span>
                      </div>
                      <p>{record.reason}</p>
                      <div className="lhb-item-grid">
                        <div><span>净买入</span><strong className={record.netAmount >= 0 ? "is-up" : "is-down"}>{money(record.netAmount)}</strong></div>
                        <div><span>买入 / 卖出</span><strong>{money(record.buyAmount)} / {money(record.sellAmount)}</strong></div>
                        <div><span>换手率</span><strong>{record.turnoverRate.toFixed(2)}%</strong></div>
                        <div><span>成交占比</span><strong>{record.boardAmountRatio.toFixed(2)}%</strong></div>
                        <div><span>次日表现</span><strong>{pct(record.after1d)}</strong></div>
                        <div><span>5日表现</span><strong>{pct(record.after5d)}</strong></div>
                      </div>
                      {record.note && <small>{record.note}</small>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
