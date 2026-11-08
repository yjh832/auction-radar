import { useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
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
import {
  fetchDragonTigerSeats,
  fetchIntradayData,
  fetchStockDetail
} from "../lib/market";
import type {
  Candidate,
  DailyBar,
  DragonTigerRecord,
  DragonTigerSeatAnalysis,
  IntradaySeries,
  SeatRecord,
  StockDetailData
} from "../types";

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

function CandleChart({
  bars,
  selectedDate,
  onSelect
}: {
  bars: DailyBar[];
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
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
            <g
              key={bar.date}
              className={`candle-group ${selectedDate === bar.date ? "is-selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`查看${bar.date}分时图`}
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

const intradayCache = new Map<string, IntradaySeries>();

function IntradayChart({ series }: { series: IntradaySeries }) {
  if (series.points.length < 2) {
    return <div className="drawer-empty">当日没有可用分时数据</div>;
  }
  const width = 760;
  const height = 300;
  const left = 44;
  const right = 18;
  const top = 16;
  const priceHeight = 205;
  const volumeTop = 246;
  const volumeHeight = 34;
  const plotWidth = width - left - right;
  const minPrice = Math.min(series.preClose, ...series.points.map((point) => point.price));
  const maxPrice = Math.max(series.preClose, ...series.points.map((point) => point.price));
  const span = Math.max(maxPrice - minPrice, 0.01);
  const maxVolume = Math.max(...series.points.map((point) => point.volume), 1);
  const step = plotWidth / (series.points.length - 1);
  const yPrice = (price: number) =>
    top + ((maxPrice - price) / span) * priceHeight;
  const priceLine = series.points
    .map((point, index) => `${left + index * step},${yPrice(point.price)}`)
    .join(" ");
  const avgLine = series.points
    .map((point, index) => `${left + index * step},${yPrice(point.avgPrice)}`)
    .join(" ");
  const lineColor =
    (series.points.at(-1)?.price ?? series.preClose) >= series.preClose
      ? "#C84B31"
      : "#28705C";
  const labelIndexes = [
    0,
    Math.floor((series.points.length - 1) * 0.25),
    Math.floor((series.points.length - 1) * 0.5),
    Math.floor((series.points.length - 1) * 0.75),
    series.points.length - 1
  ];

  return (
    <svg
      className="intraday-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${series.date}分时走势`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const value = maxPrice - ratio * span;
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
      <line
        x1={left}
        x2={width - right}
        y1={yPrice(series.preClose)}
        y2={yPrice(series.preClose)}
        className="intraday-baseline"
      />
      <polyline points={priceLine} fill="none" stroke={lineColor} strokeWidth="2.4" />
      <polyline points={avgLine} fill="none" stroke="#B58A4C" strokeWidth="1.7" />
      {series.points.map((point, index) => {
        const barHeight = (point.volume / maxVolume) * volumeHeight;
        return (
          <rect
            key={`${point.time}-${index}`}
            x={left + index * step - Math.max(1, Math.min(4, step * 0.32))}
            y={volumeTop + volumeHeight - barHeight}
            width={Math.max(1.5, Math.min(6, step * 0.65))}
            height={barHeight}
            fill="#B58A4C"
            opacity="0.55"
          />
        );
      })}
      <line
        x1={left}
        x2={width - right}
        y1={volumeTop - 8}
        y2={volumeTop - 8}
        className="chart-vol-divider"
      />
      {labelIndexes.map((index, labelIndex) => {
        const point = series.points[index];
        if (!point) return null;
        return (
          <text
            key={`${point.time}-${labelIndex}`}
            x={left + index * step}
            y={height - 5}
            textAnchor={
              labelIndex === 0 ? "start" : labelIndex === 4 ? "end" : "middle"
            }
            className="chart-axis-label"
          >
            {point.time}
          </text>
        );
      })}
    </svg>
  );
}

function IntradayPanel({
  candidate,
  bar,
  panelRef
}: {
  candidate: Candidate;
  bar: DailyBar;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const [series, setSeries] = useState<IntradaySeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = `${candidate.code}-${bar.date}`;
    const cached = intradayCache.get(key);
    if (cached) {
      setSeries(cached);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchIntradayData(candidate, bar.date, bar.preClose)
      .then((data) => {
        if (cancelled) return;
        intradayCache.set(key, data);
        setSeries(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "分时加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bar, candidate]);

  return (
    <section className="drawer-section intraday-panel" ref={panelRef}>
      <div className="drawer-section-title">
        <div>
          <span>INTRADAY REPLAY</span>
          <h3>{bar.date} 分时图</h3>
        </div>
        <span className="intraday-legend">
          <i />价格 <i />均价
        </span>
      </div>
      {loading && (
        <div className="drawer-loading drawer-loading--compact">
          <RefreshCw size={19} className="spin" />
          <strong>读取当日分时</strong>
        </div>
      )}
      {error && <div className="drawer-empty">{error}</div>}
      {series && (
        <>
          <div className="intraday-summary">
            <div><span>开盘</span><strong>{series.open.toFixed(2)}</strong></div>
            <div><span>最高</span><strong>{series.high.toFixed(2)}</strong></div>
            <div><span>最低</span><strong>{series.low.toFixed(2)}</strong></div>
            <div><span>收盘</span><strong className={series.close >= series.preClose ? "is-up" : "is-down"}>{series.close.toFixed(2)}</strong></div>
            <div><span>成交额</span><strong>{money(series.amount)}</strong></div>
            <div><span>涨跌幅</span><strong className={series.close >= series.preClose ? "is-up" : "is-down"}>{pct(series.close / series.preClose - 1)}</strong></div>
          </div>
          <IntradayChart series={series} />
        </>
      )}
    </section>
  );
}

function SeatRow({ seat }: { seat: SeatRecord }) {
  return (
    <div className="seat-row">
      <div className="seat-name">
        <strong>{seat.name}</strong>
        <span className={`seat-style seat-style--${seat.profile.style}`}>
          {seat.profile.label}
        </span>
      </div>
      <div className="seat-amount">
        <span>{seat.side === "buy" ? "买入" : "卖出"}</span>
        <strong>{money(seat.side === "buy" ? seat.buyAmount : seat.sellAmount)}</strong>
      </div>
      <div>
        <span>净额</span>
        <strong className={seat.netAmount >= 0 ? "is-up" : "is-down"}>{money(seat.netAmount)}</strong>
      </div>
      <div>
        <span>近3日活跃</span>
        <strong>{seat.activity3d.toFixed(0)}次</strong>
      </div>
      <div>
        <span>3日上涨概率</span>
        <strong>{seat.riseProbability3d === null ? "—" : `${seat.riseProbability3d.toFixed(1)}%`}</strong>
      </div>
      <p>{seat.profile.habit}</p>
    </div>
  );
}

function LhbSeatPanel({
  candidate,
  record
}: {
  candidate: Candidate;
  record: DragonTigerRecord;
}) {
  const [analysis, setAnalysis] = useState<DragonTigerSeatAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    fetchDragonTigerSeats(candidate.code, record.date, record.changeType)
      .then((data) => {
        if (!cancelled) setAnalysis(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "买卖席位加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [candidate.code, record]);

  if (loading) {
    return (
      <div className="lhb-seat-panel lhb-seat-panel--loading">
        <RefreshCw size={17} className="spin" />
        正在读取当日买卖前五席位
      </div>
    );
  }
  if (error) {
    return <div className="lhb-seat-panel lhb-seat-panel--error">{error}</div>;
  }
  if (!analysis) return null;

  const verdictClass =
    analysis.verdict === "跟随"
      ? "follow"
      : analysis.verdict === "谨慎跟随"
        ? "caution"
        : analysis.verdict === "回避"
          ? "avoid"
          : "watch";

  return (
    <div className="lhb-seat-panel">
      <div className="lhb-analysis-head">
        <div>
          <span>SEAT ANALYSIS</span>
          <h4>{record.date} 买卖席位分析</h4>
        </div>
        <strong className={`follow-verdict follow-verdict--${verdictClass}`}>
          {analysis.verdict}
        </strong>
      </div>

      <div className="lhb-analysis-summary">
        <div><span>前五买方合计</span><strong>{money(analysis.buyTotal)}</strong></div>
        <div><span>前五卖方合计</span><strong>{money(analysis.sellTotal)}</strong></div>
        <div><span>席位净额</span><strong className={analysis.netAmount >= 0 ? "is-up" : "is-down"}>{money(analysis.netAmount)}</strong></div>
        <div><span>占成交额</span><strong>{pct(analysis.netRatio)}</strong></div>
        <div><span>买方集中度</span><strong>{pct(analysis.buyConcentration, 1)}</strong></div>
        <div><span>席位评分</span><strong>{analysis.seatScore.toFixed(1)}</strong></div>
      </div>

      <div className="follow-decision">
        <span>次日动作建议</span>
        <strong>{analysis.nextDayAction}</strong>
      </div>

      <div className="lhb-analysis-reasons">
        {analysis.reasons.map((reason) => (
          <div key={reason}><TrendingUp size={12} />{reason}</div>
        ))}
        {analysis.risks.map((risk) => (
          <div className="is-risk" key={risk}><AlertTriangle size={12} />{risk}</div>
        ))}
      </div>

      <div className="seat-columns">
        <div>
          <h5>买入前五</h5>
          {analysis.buyers.map((seat) => (
            <SeatRow seat={seat} key={`buy-${seat.name}`} />
          ))}
        </div>
        <div>
          <h5>卖出前五</h5>
          {analysis.sellers.map((seat) => (
            <SeatRow seat={seat} key={`sell-${seat.name}`} />
          ))}
        </div>
      </div>
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
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedLhb, setSelectedLhb] = useState<string | null>(null);
  const intradayRef = useRef<HTMLElement | null>(null);
  const lhbSeatRef = useRef<HTMLDivElement | null>(null);

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
    setSelectedDate(null);
    setSelectedLhb(null);
  }, [candidate.code]);

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
              <div className="chart-helper">点击任意K线查看当日分时图</div>
              <CandleChart
                bars={detail.kline}
                selectedDate={selectedDate ?? detail.kline.at(-1)?.date ?? ""}
                onSelect={(date) => {
                  setSelectedDate(date);
                  window.setTimeout(() => {
                    intradayRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start"
                    });
                  }, 60);
                }}
              />
            </section>

            {(() => {
              const selectedBar =
                detail.kline.find(
                  (bar) => bar.date === (selectedDate ?? detail.kline.at(-1)?.date)
                ) ?? detail.kline.at(-1);
              return selectedBar ? (
                <IntradayPanel
                  candidate={candidate}
                  bar={selectedBar}
                  panelRef={intradayRef}
                />
              ) : null;
            })()}

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
                  <div className="chart-helper">点击龙虎榜记录查看当日买卖前五席位、资金属性和跟随判断</div>
                  {detail.dragonTiger.map((record) => {
                    const key = `${record.date}-${record.changeType}`;
                    const selected = selectedLhb === key;
                    return (
                      <div key={key}>
                        <article
                          className={`lhb-item lhb-item--clickable ${selected ? "is-selected" : ""}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`查看${record.date}龙虎榜买卖席位`}
                          onClick={() => {
                            setSelectedLhb(selected ? null : key);
                            if (!selected) {
                              window.setTimeout(() => {
                                lhbSeatRef.current?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start"
                                });
                              }, 80);
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedLhb(selected ? null : key);
                            }
                          }}
                        >
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
                        {selected && (
                          <div ref={lhbSeatRef} className="lhb-seat-anchor">
                            <LhbSeatPanel candidate={candidate} record={record} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
