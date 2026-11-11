import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  CircleDollarSign,
  ExternalLink,
  Gauge,
  Landmark,
  Newspaper,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X
} from "lucide-react";
import {
  fetchDragonTigerSeats,
  fetchHoldingBenchmark,
  fetchIntradayData,
  fetchStockDetail
} from "../lib/market";
import { applyIndexDeviationRisk, buildAnomalyFromHistory } from "../lib/anomaly";
import { buildHoldingAnomalyRisk } from "../lib/indexAnomaly";
import { buildStockInsight, fetchStockNews } from "../lib/research";
import type {
  Candidate,
  CandidateAnomaly,
  DailyBar,
  DragonTigerRecord,
  DragonTigerSeatAnalysis,
  HoldingAnomalyRisk,
  IntradaySeries,
  SeatRecord,
  StockDetailData,
  StockInsight,
  StockNewsItem
} from "../types";

interface StockDetailDrawerProps {
  candidate: Candidate;
  onClose: () => void;
}

function pct(value: number | null | undefined, digits = 2) {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function ratioPct(value: number | null | undefined, digits = 2) {
  return value == null ? "—" : pct(value * 100, digits);
}

function money(value: number) {
  if (!Number.isFinite(value) || value === 0) return "—";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(0)}万`;
  return value.toFixed(0);
}

function anomalyStatusText(status: CandidateAnomaly["regulatoryStatus"]) {
  if (status === "abnormal") return "异动提示";
  if (status === "watch") return "接近阈值";
  return "公开提示未命中";
}

interface LhbPulse {
  recentListedDays: number;
  positiveDays: number;
  negativeDays: number;
  consecutivePositiveRecords: number;
  recentLimitCount: number;
  strongBuyerCount: number;
  relayLabel: string;
  relayTone: "strong" | "watch" | "risk";
  continuityLabel: string;
  continuityTone: "strong" | "watch" | "risk";
  continuityNote: string;
}

function isLimitUpBar(bar: DailyBar, code: string) {
  if (bar.preClose <= 0) return false;
  const threshold = code.startsWith("30") || code.startsWith("68") ? 0.195 : 0.095;
  return bar.close / bar.preClose - 1 >= threshold;
}

function buildLhbPulse(
  candidate: Candidate,
  detail: StockDetailData,
  record: DragonTigerRecord,
  analysis: DragonTigerSeatAnalysis | null
): LhbPulse {
  const recentBars = detail.kline.slice(-5);
  const recentDates = new Set(recentBars.map((bar) => bar.date));
  const recentRecords = detail.dragonTiger.filter((item) => recentDates.has(item.date));
  const positiveDays = recentRecords.filter((item) => item.netAmount > 0).length;
  const negativeDays = recentRecords.filter((item) => item.netAmount < 0).length;
  let consecutivePositiveRecords = 0;
  for (const item of recentRecords) {
    if (item.netAmount <= 0) break;
    consecutivePositiveRecords += 1;
  }
  const recentLimitCount = recentBars.filter((bar) => isLimitUpBar(bar, candidate.code)).length;
  let tailLimitStreak = 0;
  for (let index = recentBars.length - 1; index >= 0; index -= 1) {
    if (!isLimitUpBar(recentBars[index], candidate.code)) break;
    tailLimitStreak += 1;
  }
  const strongBuyerCount =
    analysis?.buyers.filter(
      (seat) =>
        seat.profile.style === "hot_money" ||
        seat.profile.style === "institution"
    ).length ?? 0;
  const weakLatestRecord = record.netAmount <= 0 || analysis?.verdict === "回避";

  let relayLabel = "暂未形成接力";
  let relayTone: LhbPulse["relayTone"] = "watch";
  if (weakLatestRecord) {
    relayLabel = "接力受阻";
    relayTone = "risk";
  } else if (tailLimitStreak >= 2) {
    relayLabel = "连板接力";
    relayTone = "strong";
  } else if (recentLimitCount >= 2) {
    relayLabel = "高频接力";
    relayTone = "strong";
  } else if (recentLimitCount === 1 && strongBuyerCount >= 2) {
    relayLabel = "首板接力";
    relayTone = "strong";
  } else if (candidate.limitToday && strongBuyerCount >= 1) {
    relayLabel = "封板接力";
    relayTone = "watch";
  }

  let continuityLabel = "近5日未上榜";
  let continuityTone: LhbPulse["continuityTone"] = "watch";
  if (recentRecords.length > 0) {
    if (recentRecords.length === 5 && positiveDays === 5) {
      continuityLabel = "近5日每日上榜净买入";
      continuityTone = "strong";
    } else if (positiveDays >= 2 && consecutivePositiveRecords >= 2) {
      continuityLabel = `连续${consecutivePositiveRecords}个上榜日净买入`;
      continuityTone = "strong";
    } else if (positiveDays >= 2) {
      continuityLabel = `近5日${positiveDays}次上榜净买入`;
      continuityTone = "strong";
    } else if (record.netAmount > 0) {
      continuityLabel = "最近上榜净买入";
    } else if (negativeDays > 0) {
      continuityLabel = "最近上榜呈资金分歧";
      continuityTone = "risk";
    }
  }

  const dailyProof =
    recentRecords.length === 5 && positiveDays === 5
      ? "近5个交易日均有龙虎榜记录且席位净买入，可以确认连续在场。"
      : `近5个交易日上榜${recentRecords.length}次，其中净买入${positiveDays}次、净卖出${negativeDays}次。`;

  return {
    recentListedDays: recentRecords.length,
    positiveDays,
    negativeDays,
    consecutivePositiveRecords,
    recentLimitCount,
    strongBuyerCount,
    relayLabel,
    relayTone,
    continuityLabel,
    continuityTone,
    continuityNote: `${dailyProof}龙虎榜仅在触发披露条件时出现，不能把未上榜等同于没有资金买入，也无法据此确认每个交易日都有同一主力买入。`
  };
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
  const movingAverage = (period: number) =>
    bars.map((_, index) => {
      if (index < period - 1) return null;
      const sample = bars.slice(index - period + 1, index + 1);
      return (
        sample.reduce((sum, item) => sum + item.close, 0) / sample.length
      );
    });
  const ma5 = movingAverage(5);
  const ma10 = movingAverage(10);
  const ma20 = movingAverage(20);
  const selectedIndex = Math.max(
    0,
    bars.findIndex(
      (bar) => bar.date === (selectedDate || bars.at(-1)?.date)
    )
  );
  const maLines = [
    { label: "MA5", values: ma5, color: "#D5A33B" },
    { label: "MA10", values: ma10, color: "#4C8ED9" },
    { label: "MA20", values: ma20, color: "#C85A86" }
  ];

  const yPrice = (price: number) =>
    top + ((maxPrice - price) / priceSpan) * priceHeight;

  return (
    <div className="candle-chart">
      <div className="candle-ma-legend" aria-label="移动平均线">
        {maLines.map((line) => (
          <span key={line.label}>
            <i style={{ background: line.color }} />
            {line.label}
            <strong>
              {line.values[selectedIndex] == null
                ? "—"
                : line.values[selectedIndex]!.toFixed(2)}
            </strong>
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="最近30个交易日K线图，包含5日、10日、20日移动平均线"
      >
        <defs>
          <linearGradient id={`volume-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C49A46" stopOpacity="0.66" />
            <stop offset="100%" stopColor="#C49A46" stopOpacity="0.14" />
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
                {`${bar.date} 开 ${bar.open.toFixed(2)} 高 ${bar.high.toFixed(2)} 低 ${bar.low.toFixed(2)} 收 ${bar.close.toFixed(2)} · MA5 ${ma5[index]?.toFixed(2) ?? "—"} · MA10 ${ma10[index]?.toFixed(2) ?? "—"} · MA20 ${ma20[index]?.toFixed(2) ?? "—"}`}
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
                fill={up ? color : "#EEF4FB"}
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
        {maLines.map((line) => {
          const points = line.values
            .map((value, index) =>
              value == null
                ? null
                : `${left + step * (index + 0.5)},${yPrice(value)}`
            )
            .filter((point): point is string => point !== null)
            .join(" ");
          return points ? (
            <polyline
              key={line.label}
              points={points}
              fill="none"
              stroke={line.color}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="candle-ma-line"
            />
          ) : null;
        })}
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
      <polyline points={avgLine} fill="none" stroke="#B88A3A" strokeWidth="1.7" />
      {series.points.map((point, index) => {
        const barHeight = (point.volume / maxVolume) * volumeHeight;
        return (
          <rect
            key={`${point.time}-${index}`}
            x={left + index * step - Math.max(1, Math.min(4, step * 0.32))}
            y={volumeTop + volumeHeight - barHeight}
            width={Math.max(1.5, Math.min(6, step * 0.65))}
            height={barHeight}
            fill="#B88A3A"
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
            <div><span>涨跌幅</span><strong className={series.close >= series.preClose ? "is-up" : "is-down"}>{ratioPct(series.close / series.preClose - 1)}</strong></div>
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

const seatAnalysisCache = new Map<string, DragonTigerSeatAnalysis>();
const seatAnalysisRequests = new Map<string, Promise<DragonTigerSeatAnalysis>>();

async function loadSeatAnalysis(
  code: string,
  record: DragonTigerRecord
): Promise<DragonTigerSeatAnalysis> {
  const key = `${code}-${record.date}-${record.changeType}`;
  const cached = seatAnalysisCache.get(key);
  if (cached) return cached;
  const pending = seatAnalysisRequests.get(key);
  if (pending) return pending;

  const request = fetchDragonTigerSeats(code, record.date, record.changeType)
    .then((analysis) => {
      seatAnalysisCache.set(key, analysis);
      return analysis;
    })
    .finally(() => {
      seatAnalysisRequests.delete(key);
    });
  seatAnalysisRequests.set(key, request);
  return request;
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
    loadSeatAnalysis(candidate.code, record)
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
        <div><span>占成交额</span><strong>{ratioPct(analysis.netRatio)}</strong></div>
        <div><span>买方集中度</span><strong>{ratioPct(analysis.buyConcentration, 1)}</strong></div>
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

function LhbSnapshotPanel({
  candidate,
  detail,
  record,
  analysis,
  loading,
  error
}: {
  candidate: Candidate;
  detail: StockDetailData;
  record: DragonTigerRecord;
  analysis: DragonTigerSeatAnalysis | null;
  loading: boolean;
  error: string | null;
}) {
  const pulse = buildLhbPulse(candidate, detail, record, analysis);
  const buyerNames = analysis?.buyers.map((seat) => seat.name).join(" · ");
  const sellerNames = analysis?.sellers.map((seat) => seat.name).join(" · ");

  return (
    <section className="drawer-lhb-snapshot" aria-label="最近交易日龙虎榜">
      <div className="lhb-snapshot-head">
        <div>
          <span>LATEST DRAGON-TIGER</span>
          <h3>{record.date} 最近交易日龙虎榜</h3>
        </div>
        <div className="lhb-snapshot-badges">
          <strong className={`lhb-pulse-badge lhb-pulse-badge--${pulse.relayTone}`}>
            {pulse.relayLabel}
          </strong>
          <strong className={`lhb-pulse-badge lhb-pulse-badge--${pulse.continuityTone}`}>
            {pulse.continuityLabel}
          </strong>
        </div>
      </div>

      <p className="lhb-snapshot-reason">{record.reason}</p>

      <div className="lhb-snapshot-grid">
        <div><span>最近净买入</span><strong className={record.netAmount >= 0 ? "is-up" : "is-down"}>{money(record.netAmount)}</strong></div>
        <div><span>近5日上榜</span><strong>{pulse.recentListedDays} 次</strong></div>
        <div><span>净买入上榜</span><strong>{pulse.positiveDays} 次</strong></div>
        <div><span>近5日涨停</span><strong>{pulse.recentLimitCount} 次</strong></div>
      </div>

      <div className={`lhb-continuity lhb-continuity--${pulse.continuityTone}`}>
        <span>接力与主力连续性</span>
        <strong>{pulse.continuityLabel}</strong>
        <p>{pulse.continuityNote}</p>
      </div>

      <div className="lhb-snapshot-names">
        <div>
          <span>买入前五席位</span>
          <p>{loading ? "正在读取买入席位…" : error ? "席位名称暂不可用" : buyerNames}</p>
        </div>
        <div>
          <span>卖出前五席位</span>
          <p>{loading ? "正在读取卖出席位…" : error ? "席位名称暂不可用" : sellerNames}</p>
        </div>
      </div>
      {error && <small className="lhb-snapshot-error">{error}</small>}
    </section>
  );
}

function DailyKCardRail({
  bars,
  code,
  selectedDate,
  onSelect
}: {
  bars: DailyBar[];
  code: string;
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [focusIndex, setFocusIndex] = useState(
    Math.max(0, bars.length - 1)
  );

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollLeft = rail.scrollWidth;
    setFocusIndex(Math.max(0, bars.length - 1));
  }, [bars]);

  function focusCard(index: number, behavior: ScrollBehavior = "smooth") {
    const rail = railRef.current;
    const card = rail?.querySelector<HTMLElement>(
      `[data-daily-index="${index}"]`
    );
    if (!rail || !card) return;
    const left =
      card.offsetLeft - rail.clientWidth / 2 + card.clientWidth / 2;
    rail.scrollTo({
      left: Math.max(0, Math.min(left, rail.scrollWidth - rail.clientWidth)),
      behavior
    });
    setFocusIndex(index);
  }

  return (
    <div className="daily-k-navigator">
      <div
        className="daily-k-rail"
        ref={railRef}
        aria-label="最近30个交易日日K卡片"
      >
        <div className="daily-k-list">
          {bars.map((bar, index) => {
          const change = bar.preClose > 0 ? bar.close / bar.preClose - 1 : 0;
          const up = bar.close >= bar.open;
          const selected = selectedDate === bar.date;
          const rangePosition =
            bar.high > bar.low
              ? Math.min(100, Math.max(0, ((bar.close - bar.low) / (bar.high - bar.low)) * 100))
              : 50;
          return (
            <button
              type="button"
              key={bar.date}
              data-date={bar.date}
              data-daily-index={index}
              className={`daily-k-card ${up ? "is-up" : "is-down"} ${selected ? "is-selected" : ""} ${isLimitUpBar(bar, code) ? "is-limit" : ""}`}
              onClick={() => {
                setFocusIndex(index);
                onSelect(bar.date);
              }}
              aria-label={`查看${bar.date}分时图，收盘${bar.close.toFixed(2)}，涨跌${pct(change * 100)}`}
            >
              <header>
                <time>{bar.date.slice(5)}</time>
                <span>{pct(change * 100)}</span>
              </header>
              <strong>{bar.close.toFixed(2)}</strong>
              <div className="daily-k-range">
                <i style={{ width: `${rangePosition}%` }} />
                <b style={{ left: `${rangePosition}%` }} />
              </div>
              <dl>
                <div><dt>开</dt><dd>{bar.open.toFixed(2)}</dd></div>
                <div><dt>高</dt><dd>{bar.high.toFixed(2)}</dd></div>
                <div><dt>低</dt><dd>{bar.low.toFixed(2)}</dd></div>
              </dl>
              <small>{(bar.volume / 10_000).toFixed(1)}万手</small>
            </button>
          );
          })}
        </div>
      </div>
      <div className="daily-k-slider">
        <div className="daily-k-slider-head">
          <span>30日交易滑轨</span>
          <strong>{bars[focusIndex]?.date ?? "—"}</strong>
        </div>
        <input
          type="range"
          min="0"
          max={Math.max(0, bars.length - 1)}
          step="1"
          value={Math.min(focusIndex, Math.max(0, bars.length - 1))}
          aria-label="拖动选择最近30个交易日"
          onChange={(event) => focusCard(Number(event.target.value), "auto")}
        />
        <div className="daily-k-slider-foot">
          <span>{bars[0]?.date.slice(5) ?? "—"}</span>
          <small>共 {bars.length} 个交易日 · 拖动定位后点击卡片查看分时</small>
          <span>{bars.at(-1)?.date.slice(5) ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}

function SelectedDayDetails({
  candidate,
  bar,
  records,
  news
}: {
  candidate: Candidate;
  bar: DailyBar;
  records: DragonTigerRecord[];
  news: StockNewsItem[];
}) {
  const dayReturn = bar.preClose > 0 ? bar.close / bar.preClose - 1 : 0;
  const sameDayNews = news
    .filter((item) => item.date.slice(0, 10) === bar.date)
    .slice(0, 3);

  return (
    <section className="drawer-section selected-day-details">
      <div className="drawer-section-title">
        <div>
          <span>SELECTED SESSION</span>
          <h3>{bar.date} 当日信息</h3>
        </div>
        <CalendarDays size={18} />
      </div>
      <div className="selected-day-metrics">
        <div><span>开盘</span><strong>{bar.open.toFixed(2)}</strong></div>
        <div><span>最高</span><strong>{bar.high.toFixed(2)}</strong></div>
        <div><span>最低</span><strong>{bar.low.toFixed(2)}</strong></div>
        <div><span>收盘</span><strong>{bar.close.toFixed(2)}</strong></div>
        <div><span>涨跌幅</span><strong className={dayReturn >= 0 ? "is-up" : "is-down"}>{ratioPct(dayReturn)}</strong></div>
        <div><span>成交量</span><strong>{(bar.volume / 10_000).toFixed(1)}万手</strong></div>
      </div>

      {sameDayNews.length > 0 && (
        <div className="selected-day-news">
          <span>当日重要消息</span>
          {sameDayNews.map((item) => (
            <a
              href={item.url || undefined}
              target="_blank"
              rel="noreferrer"
              key={item.id}
            >
              <strong>{item.title}</strong>
              <small>{item.source}</small>
            </a>
          ))}
        </div>
      )}

      <div className="selected-day-lhb">
        <span>当日龙虎榜</span>
        {records.length === 0 ? (
          <p>该交易日没有龙虎榜披露记录，不将“未上榜”等同于没有主力资金参与。</p>
        ) : (
          records.map((record) => (
            <div className="selected-day-lhb-record" key={`${record.date}-${record.changeType}`}>
              <header>
                <strong>{record.reason}</strong>
                <em className={record.netAmount >= 0 ? "is-up" : "is-down"}>
                  净额 {money(record.netAmount)}
                </em>
              </header>
              <p>
                买入 {money(record.buyAmount)} / 卖出 {money(record.sellAmount)} ·
                换手 {record.turnoverRate.toFixed(2)}% · 次日 {pct(record.after1d)}
              </p>
              <LhbSeatPanel candidate={candidate} record={record} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function StockInsightPanel({
  insight,
  loading
}: {
  insight: StockInsight | null;
  loading: boolean;
}) {
  if (loading || !insight) {
    return (
      <section className="drawer-insight drawer-insight--loading">
        <div className="drawer-insight-skeleton" />
        <div className="drawer-insight-skeleton is-short" />
        <div className="drawer-insight-skeleton is-short" />
      </section>
    );
  }
  return (
    <section className={`drawer-insight drawer-insight--${insight.stance}`}>
      <div className="drawer-insight-head">
        <div>
          <span><Sparkles size={13} />QUANT + EVENT ANALYSIS</span>
          <h3>{insight.title}</h3>
        </div>
        <div className="drawer-insight-score">
          <strong>{insight.score}</strong>
          <span>{insight.stance}</span>
        </div>
      </div>
      <p className="drawer-insight-summary">{insight.summary}</p>
      <div className="drawer-insight-columns">
        <div>
          <span><ShieldCheck size={13} />支持因素</span>
          <ul>
            {insight.positives.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div>
          <span><AlertTriangle size={13} />主要风险</span>
          <ul>
            {insight.risks.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>
      <div className="drawer-insight-action">
        <span>条件式操作结论</span>
        <strong>{insight.action}</strong>
      </div>
      <small>结论由公开行情、量价与关键词资讯自动生成，不构成投资建议。</small>
    </section>
  );
}

function StockNewsPanel({
  news,
  loading,
  error
}: {
  news: StockNewsItem[];
  loading: boolean;
  error: string | null;
}) {
  const positiveCount = news.filter((item) => item.tone === "positive").length;
  const visible = news.slice(0, 3);
  const more = news.slice(3);
  const renderItem = (item: StockNewsItem) => (
    <article className={`stock-news-item stock-news-item--${item.tone}`} key={item.id}>
      <header>
        <span>{item.kind === "announcement" ? "公司公告" : item.source}</span>
        <time>{item.date.slice(0, 10)}</time>
      </header>
      <h4>{item.title}</h4>
      {item.summary && <p>{item.summary}</p>}
      <footer>
        <div>
          <em>{item.tone === "positive" ? "利好线索" : item.tone === "risk" ? "风险线索" : "重要动态"}</em>
          {item.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer">
            查看原文 <ExternalLink size={12} />
          </a>
        )}
      </footer>
    </article>
  );

  return (
    <section className="drawer-section stock-news-section">
      <div className="drawer-section-title">
        <div>
          <span>EVENT & NEWS RADAR</span>
          <h3>公司重大消息与利好线索</h3>
        </div>
        <Newspaper size={18} />
      </div>
      <div className="stock-news-summary">
        <div>
          <strong>{positiveCount}</strong>
          <span>条利好关键词线索</span>
        </div>
        <p>优先展示回购、增持、中标、合同、预增、获批、分红等事件；自动识别结果需打开原文核验。</p>
      </div>
      {loading ? (
        <div className="stock-news-loading">
          <RefreshCw size={17} className="spin" /> 正在读取公司公告与市场资讯
        </div>
      ) : error ? (
        <div className="drawer-empty">{error}</div>
      ) : news.length === 0 ? (
        <div className="drawer-empty">近期暂未返回可识别的公司消息。</div>
      ) : (
        <>
          <div className="stock-news-list">{visible.map(renderItem)}</div>
          {more.length > 0 && (
            <details className="stock-news-more">
              <summary>查看其余 {more.length} 条动态</summary>
              <div className="stock-news-list">{more.map(renderItem)}</div>
            </details>
          )}
        </>
      )}
    </section>
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
  const [anomalyRisk, setAnomalyRisk] = useState<HoldingAnomalyRisk | null>(null);
  const [news, setNews] = useState<StockNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState<string | null>(null);
  const intradayRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);
    setAnomalyRisk(null);
    Promise.all([
      fetchStockDetail(candidate),
      fetchHoldingBenchmark(candidate.code).catch(() => null)
    ])
      .then(([data, benchmark]) => {
        if (controller.signal.aborted) return;
        setDetail(data);
        const history = (data.analysisKline ?? data.kline).map((bar) => ({
          date: bar.date,
          close: bar.close
        }));
        setAnomalyRisk(
          buildHoldingAnomalyRisk(data.quote, history, benchmark)
        );
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
    let cancelled = false;
    setNews([]);
    setNewsError(null);
    setNewsLoading(true);
    fetchStockNews(candidate.code, candidate.name)
      .then((items) => {
        if (!cancelled) setNews(items);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setNewsError(
            reason instanceof Error ? reason.message : "公司资讯暂不可用"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setNewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [candidate.code, candidate.name]);

  useEffect(() => {
    setSelectedDate(null);
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
  const effectiveCandidate = useMemo(() => {
    if (!detail) return candidate;
    const bars = detail.analysisKline ?? detail.kline;
    const history = bars.map((bar) => ({
      date: bar.date,
      close: bar.close
    }));
    const ret = (count: number) =>
      history.length > count
        ? detail.quote.price / history.at(-(count + 1))!.close - 1
        : 0;
    const countLimits = (count: number) =>
      bars.slice(-count).filter((bar) => isLimitUpBar(bar, candidate.code)).length;
    const baseAnomaly = buildAnomalyFromHistory(
      candidate.code,
      history,
      candidate.riskNotes
    );
    return {
      ...candidate,
      close: detail.quote.price,
      dayRet: detail.quote.changePct / 100,
      gap: detail.quote.preClose
        ? detail.quote.open / detail.quote.preClose - 1
        : 0,
      volRatio: detail.quote.volumeRatio,
      ret5: ret(5),
      ret10: ret(10),
      ret30: ret(30),
      closePos:
        detail.quote.high > detail.quote.low
          ? (detail.quote.price - detail.quote.low) /
            (detail.quote.high - detail.quote.low)
          : 0.5,
      limit20: countLimits(20),
      limit60:
        candidate.limit60 > 0 ? candidate.limit60 : countLimits(60),
      turnoverEst: detail.quote.turnoverRate,
      amountEst: detail.quote.amount,
      floatCap: detail.quote.floatCap,
      history,
      anomaly: applyIndexDeviationRisk(baseAnomaly, anomalyRisk)
    };
  }, [anomalyRisk, candidate, detail]);
  const insight = useMemo(
    () =>
      detail && quote
        ? buildStockInsight({
            candidate: effectiveCandidate,
            quote,
            bars: detail.analysisKline ?? detail.kline,
            anomaly: effectiveCandidate.anomaly,
            news
          })
        : null,
    [detail, effectiveCandidate, news, quote]
  );
  const selectedKBar =
    detail?.kline.find(
      (bar) => bar.date === (selectedDate ?? detail.kline.at(-1)?.date)
    ) ?? detail?.kline.at(-1);
  const primaryKlineSection = detail ? (
    <>
      <section className="drawer-section drawer-kline-primary">
        <div className="drawer-section-title">
          <div>
            <span>PRICE STRUCTURE</span>
            <h3>最近30个交易日</h3>
          </div>
          <BarChart3 size={18} />
        </div>
        <div className="chart-helper">
          完整显示30日日K及MA5、MA10、MA20，点击任意一天查看当日信息。
        </div>
        <CandleChart
          bars={detail.kline}
          selectedDate={selectedDate ?? ""}
          onSelect={setSelectedDate}
        />
        <DailyKCardRail
          bars={detail.kline}
          code={candidate.code}
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
      {selectedDate && selectedKBar && (
        <>
          <SelectedDayDetails
            candidate={effectiveCandidate}
            bar={selectedKBar}
            records={detail.dragonTiger.filter(
              (record) => record.date === selectedKBar.date
            )}
            news={news}
          />
          <IntradayPanel
            candidate={effectiveCandidate}
            bar={selectedKBar}
            panelRef={intradayRef}
          />
        </>
      )}
    </>
  ) : null;

  return (
    <div className="stock-drawer-root" role="presentation">
      <button className="stock-drawer-backdrop" aria-label="关闭股票详情" onClick={onClose} />
      <aside className="stock-drawer" role="dialog" aria-modal="true" aria-label={`${candidate.name}股票详情`}>
        <header className="drawer-header">
          <div>
            <span className="drawer-kicker">STOCK INTELLIGENCE / {candidate.code}</span>
            <h2>{candidate.name}</h2>
            <p>
              {candidate.industry.startsWith("全市场")
                ? "全市场股票 · 实时研究"
                : `${candidate.industry} · ${
                    candidate.rank < 100
                      ? `风险调整第 ${candidate.rank} 名`
                      : "持仓实时分析"
                  }`}
            </p>
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

            {primaryKlineSection}

            <StockInsightPanel insight={insight} loading={newsLoading && !insight} />

            <StockNewsPanel
              news={news}
              loading={newsLoading}
              error={newsError}
            />

            <section className="drawer-section">
              <div className="drawer-section-title">
                <div>
                  <span>TRADING FOCUS</span>
                  <h3>涨停基因与风险</h3>
                </div>
                <CalendarDays size={18} />
              </div>
              <div className="drawer-gene-grid">
                <div><span>近20日涨停</span><strong>{effectiveCandidate.limit20} 次</strong></div>
                <div><span>近60日涨停</span><strong>{effectiveCandidate.limit60} 次</strong></div>
                <div><span>5日涨跌</span><strong className={effectiveCandidate.ret5 >= 0 ? "is-up" : "is-down"}>{ratioPct(effectiveCandidate.ret5)}</strong></div>
                <div><span>10日涨跌</span><strong className={effectiveCandidate.ret10 >= 0 ? "is-up" : "is-down"}>{ratioPct(effectiveCandidate.ret10)}</strong></div>
                <div><span>板块强势股</span><strong>{effectiveCandidate.sectorStrongCount} / {effectiveCandidate.sectorN}</strong></div>
                <div><span>综合分</span><strong>{effectiveCandidate.compositeScore > 0 ? (effectiveCandidate.compositeScore * 100).toFixed(1) : `${insight?.score ?? "—"}`}</strong></div>
              </div>
              <ul className="drawer-risk-list">
                {effectiveCandidate.riskNotes.map((note) => (
                  <li key={note}><AlertTriangle size={13} />{note}</li>
                ))}
              </ul>
            </section>

          </>
        )}
      </aside>
    </div>
  );
}
