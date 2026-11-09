import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Gauge,
  RefreshCw,
  TrendingUp,
  X
} from "lucide-react";
import { fetchGlobalIndexDetail } from "../lib/market";
import type {
  DailyBar,
  GlobalIndexDefinition,
  IndexDetailData
} from "../types";

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function IndexKline({
  bars,
  selectedDate,
  onSelect
}: {
  bars: DailyBar[];
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  if (bars.length < 2) return <div className="drawer-empty">指数K线不足</div>;
  const width = 760;
  const height = 290;
  const left = 44;
  const right = 18;
  const top = 18;
  const priceHeight = 190;
  const volumeTop = 230;
  const volumeHeight = 38;
  const plotWidth = width - left - right;
  const min = Math.min(...bars.map((bar) => bar.low));
  const max = Math.max(...bars.map((bar) => bar.high));
  const span = Math.max(max - min, 0.01);
  const maxVolume = Math.max(...bars.map((bar) => bar.volume), 1);
  const step = plotWidth / bars.length;
  const bodyWidth = Math.min(16, step * 0.48);
  const y = (price: number) => top + ((max - price) / span) * priceHeight;

  return (
    <div className="candle-chart index-candle-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="指数最近30日K线">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1={left}
              x2={width - right}
              y1={top + ratio * priceHeight}
              y2={top + ratio * priceHeight}
              className="chart-gridline"
            />
            <text
              x={left - 7}
              y={top + ratio * priceHeight + 3}
              textAnchor="end"
              className="chart-axis-label"
            >
              {(max - ratio * span).toFixed(2)}
            </text>
          </g>
        ))}
        {bars.map((bar, index) => {
          const x = left + step * (index + 0.5);
          const up = bar.close >= bar.open;
          const color = up ? "#c54135" : "#2c7459";
          const bodyTop = Math.min(y(bar.open), y(bar.close));
          const bodyHeight = Math.max(2, Math.abs(y(bar.open) - y(bar.close)));
          const volume = (bar.volume / maxVolume) * volumeHeight;
          return (
            <g
              key={bar.date}
              className={`candle-group ${selectedDate === bar.date ? "is-selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`查看${bar.date}指数行情`}
              onClick={() => onSelect(bar.date)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(bar.date);
                }
              }}
            >
              <title>
                {`${bar.date} 开 ${bar.open.toFixed(2)} 高 ${bar.high.toFixed(2)} 低 ${bar.low.toFixed(2)} 收 ${bar.close.toFixed(2)}`}
              </title>
              <rect
                x={x - step / 2}
                y={top}
                width={step}
                height={priceHeight}
                className="candle-hit-area"
              />
              <line
                x1={x}
                x2={x}
                y1={y(bar.high)}
                y2={y(bar.low)}
                stroke={color}
                strokeWidth="1.3"
              />
              <rect
                x={x - bodyWidth / 2}
                y={bodyTop}
                width={bodyWidth}
                height={bodyHeight}
                fill={up ? color : "#fffaf3"}
                stroke={color}
                strokeWidth="1.4"
              />
              <rect
                x={x - bodyWidth / 2}
                y={volumeTop + volumeHeight - volume}
                width={bodyWidth}
                height={volume}
                fill="#c49a46"
                opacity={up ? 0.72 : 0.4}
              />
            </g>
          );
        })}
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

export function IndexDetailDrawer({
  definition,
  onClose
}: {
  definition: GlobalIndexDefinition;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<IndexDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGlobalIndexDetail(definition.symbol)
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
          setSelectedDate(data.kline.at(-1)?.date ?? null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "指数详情加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [definition.symbol, retryKey]);

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const selectedBar =
    detail?.kline.find((bar) => bar.date === selectedDate) ??
    detail?.kline.at(-1);
  const quote = detail?.quote;

  return (
    <div className="stock-drawer-root index-detail-root" role="presentation">
      <button className="stock-drawer-backdrop" aria-label="关闭指数详情" onClick={onClose} />
      <aside className="stock-drawer index-detail-drawer" role="dialog" aria-modal="true" aria-label={`${definition.name}指数详情`}>
        <header className="drawer-header">
          <div>
            <span className="drawer-kicker">
              GLOBAL INDEX / {definition.region}
            </span>
            <h2>{definition.name}</h2>
            <p>{definition.symbol.toUpperCase()} · 最近30日趋势与强弱分析</p>
          </div>
          <button className="drawer-close" type="button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>

        {loading && (
          <div className="drawer-loading">
            <RefreshCw size={22} className="spin" />
            <strong>正在读取指数行情与30日K线</strong>
          </div>
        )}

        {error && (
          <div className="drawer-error">
            <AlertTriangle size={20} />
            <div><strong>指数详情加载失败</strong><p>{error}</p></div>
            <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
              重试
            </button>
          </div>
        )}

        {detail && quote && (
          <>
            <section className="drawer-price-row">
              <div>
                <span>最新点位</span>
                <strong>{quote.price.toFixed(2)}</strong>
                <em className={quote.changePct >= 0 ? "is-up" : "is-down"}>
                  {quote.change >= 0 ? "+" : ""}
                  {quote.change.toFixed(2)} / {quote.changePct.toFixed(2)}%
                </em>
              </div>
              <div className="drawer-market-badge">
                <span>{definition.region}</span>
                <strong>指数快照</strong>
              </div>
            </section>

            <section className="drawer-metric-grid">
              <div><span>今开</span><strong>{quote.open.toFixed(2)}</strong></div>
              <div><span>昨收</span><strong>{quote.preClose.toFixed(2)}</strong></div>
              <div><span>最高</span><strong>{quote.high.toFixed(2)}</strong></div>
              <div><span>最低</span><strong>{quote.low.toFixed(2)}</strong></div>
              <div><span>5日涨跌</span><strong className={detail.ret5 >= 0 ? "is-up" : "is-down"}>{pct(detail.ret5)}</strong></div>
              <div><span>10日涨跌</span><strong className={detail.ret10 >= 0 ? "is-up" : "is-down"}>{pct(detail.ret10)}</strong></div>
              <div><span>30日涨跌</span><strong className={detail.ret30 >= 0 ? "is-up" : "is-down"}>{pct(detail.ret30)}</strong></div>
              <div><span>MA5 / MA20</span><strong>{detail.ma5.toFixed(2)} / {detail.ma20.toFixed(2)}</strong></div>
            </section>

            <section className={`index-analysis index-analysis--${detail.stance}`}>
              <div>
                <span>INDEX STRENGTH</span>
                <h3>{detail.stance}指数结构</h3>
                <p>{detail.summary}</p>
              </div>
              <strong>{detail.score}</strong>
            </section>

            <section className="drawer-section">
              <div className="drawer-section-title">
                <div><span>30-DAY TREND</span><h3>最近30日K线</h3></div>
                <BarChart3 size={18} />
              </div>
              <IndexKline
                bars={detail.kline}
                selectedDate={selectedDate ?? ""}
                onSelect={setSelectedDate}
              />
            </section>

            {selectedBar && (
              <section className="drawer-section index-day-card">
                <div>
                  <span>{selectedBar.date}</span>
                  <strong className={selectedBar.close >= selectedBar.preClose ? "is-up" : "is-down"}>
                    {pct(selectedBar.close / selectedBar.preClose - 1)}
                  </strong>
                </div>
                <div><span>开盘</span><strong>{selectedBar.open.toFixed(2)}</strong></div>
                <div><span>最高</span><strong>{selectedBar.high.toFixed(2)}</strong></div>
                <div><span>最低</span><strong>{selectedBar.low.toFixed(2)}</strong></div>
                <div><span>收盘</span><strong>{selectedBar.close.toFixed(2)}</strong></div>
                <div><span>趋势</span><strong>{detail.stance}</strong></div>
              </section>
            )}

            <p className="index-disclaimer">
              指数强弱用于辅助判断市场环境。美股行业ETF作为前夜风险偏好和板块映射参考，不直接替代A股竞价确认。
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
