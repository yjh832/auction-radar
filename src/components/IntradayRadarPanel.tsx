import {
  Activity,
  ArrowUpRight,
  Gauge,
  Layers3,
  RefreshCw,
  Waves
} from "lucide-react";
import type { Candidate, IntradayMarketRadar } from "../types";

function pct(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function money(value: number) {
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)}亿`;
  }
  return `${(value / 10_000).toFixed(0)}万`;
}

export function IntradayRadarPanel({
  radar,
  candidates,
  onSelect,
  onRefresh,
  refreshing
}: {
  radar: IntradayMarketRadar;
  candidates: Candidate[];
  onSelect: (candidate: Candidate) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const leaders = candidates
    .filter((candidate) => candidate.intraday)
    .sort(
      (a, b) =>
        Number(b.liveEligible) - Number(a.liveEligible) ||
        (b.intradayScore ?? 0) - (a.intradayScore ?? 0)
    )
    .slice(0, 6);
  const topSectors = radar.sectors.slice(0, 6);
  const eligibleCount = candidates.filter(
    (candidate) => candidate.liveEligible
  ).length;
  const updatedAt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(radar.fetchedAt));

  return (
    <section className="intraday-radar reveal reveal-3" aria-label="盘中实时决策雷达">
      <div className="intraday-radar__heading">
        <div>
          <p>
            <span className="eyebrow-index">02B</span> INTRADAY DECISION
          </p>
          <h2>盘中异动与资金雷达</h2>
        </div>
        <div className="intraday-heading-actions">
          <span className="intraday-live-pill">
            <i />
            自动90秒 · {eligibleCount}只通过 · 更新 {updatedAt}
          </span>
          <button
            type="button"
            className="intraday-refresh-button"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? "spin" : ""} />
            {refreshing ? "刷新中" : "立即刷新"}
          </button>
        </div>
      </div>

      <div className="intraday-radar__summary">
        <article>
          <span>板块资金主线</span>
          <strong>{radar.leadingSector?.name ?? "等待板块数据"}</strong>
          <p>{radar.summary}</p>
        </article>
        <article>
          <span>模型权重</span>
          <div className="intraday-weights">
            <em><Layers3 size={12} />板块25%</em>
            <em><Waves size={12} />主力资金25%</em>
            <em><Gauge size={12} />量能20%</em>
            <em><Activity size={12} />量价20%</em>
            <em>模型10%</em>
          </div>
        </article>
      </div>

      <div className="intraday-radar__grid">
        <article className="intraday-sector-board">
          <header>
            <span>板块异动榜</span>
            <small>涨幅 × 主力净流入</small>
          </header>
          {topSectors.map((sector) => (
            <button
              key={sector.code}
              type="button"
              onClick={() => {
                const candidate = leaders.find(
                  (item) => item.intraday?.sectorName === sector.name
                );
                if (candidate) onSelect(candidate);
              }}
              disabled={!leaders.some(
                (item) => item.intraday?.sectorName === sector.name
              )}
            >
              <span>{String(sector.rank).padStart(2, "0")}</span>
              <div>
                <strong>{sector.name}</strong>
                <small>
                  {sector.mainNetInflow !== 0
                    ? money(sector.mainNetInflow)
                    : "量价代理"}
                </small>
              </div>
              <em className={sector.changePct >= 0 ? "is-up" : "is-down"}>
                {pct(sector.changePct)}
              </em>
              <b>{Math.round(sector.score)}</b>
            </button>
          ))}
        </article>

        <article className="intraday-stock-board">
          <header>
            <span>盘中候选</span>
            <small>点击查看完整信息</small>
          </header>
          {leaders.map((candidate, index) => (
            <button
              key={candidate.code}
              type="button"
              onClick={() => onSelect(candidate)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{candidate.name}</strong>
                <small>
                  {candidate.code} · {candidate.intraday?.sectorName}
                </small>
              </div>
              <div>
                <strong>{candidate.intradayScore?.toFixed(0)}</strong>
                <small>盘中分</small>
              </div>
              <em
                className={
                  candidate.liveEligible ? "is-watch" : "is-wait"
                }
              >
                {candidate.liveEligible ? "通过" : "观察"}
              </em>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </article>
      </div>
    </section>
  );
}
