import { AlertTriangle, ShieldCheck, TrendingUp } from "lucide-react";
import type { Candidate } from "../types";

function pct(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function statusText(status: "clear" | "watch" | "abnormal") {
  if (status === "abnormal") return "异动提示";
  if (status === "watch") return "接近阈值";
  return "公开提示未命中";
}

export function CandidateAnomalyPanel({
  candidates,
  onSelect
}: {
  candidates: Candidate[];
  onSelect: (candidate: Candidate) => void;
}) {
  return (
    <section className="anomaly-panel" aria-label="六只候选异动与公开监管提示">
      <div className="anomaly-panel-heading">
        <div>
          <span>VOLATILITY WATCH</span>
          <h3>六只候选异动检查</h3>
        </div>
        <p>3日阈值预警仅作风险参考，不等于交易所正式异动或监管认定。</p>
      </div>
      <div className="anomaly-card-grid">
        {candidates.map((candidate) => {
          const anomaly = candidate.anomaly;
          const status = anomaly?.regulatoryStatus ?? "clear";
          return (
            <button
              type="button"
              className={`anomaly-card anomaly-card--${status}`}
              key={candidate.code}
              onClick={() => onSelect(candidate)}
            >
              <header>
                <span>{candidate.code}</span>
                <strong>{candidate.name}</strong>
                <em>
                  {status === "abnormal" ? (
                    <AlertTriangle size={12} />
                  ) : status === "watch" ? (
                    <TrendingUp size={12} />
                  ) : (
                    <ShieldCheck size={12} />
                  )}
                  {statusText(status)}
                </em>
              </header>
              <div className="anomaly-card-metrics">
                <div><span>10日涨幅</span><strong>{pct(candidate.ret10)}</strong></div>
                <div><span>30日涨幅</span><strong>{pct(candidate.ret30)}</strong></div>
                <div>
                  <span>3日累计 / 阈值</span>
                  <strong>
                    {pct(anomaly?.threeDayReturn)} / {pct(anomaly?.threshold, 0)}
                  </strong>
                </div>
                <div>
                  <span>距阈值</span>
                  <strong>
                    {anomaly?.distanceToThreshold === 0
                      ? "已达到"
                      : pct(anomaly?.distanceToThreshold)}
                  </strong>
                </div>
              </div>
              <div className="anomaly-card-foot">
                <span>
                  最近异动：
                  {anomaly?.lastAbnormalDate
                    ? `${anomaly.lastAbnormalDate}${
                        anomaly.daysSinceLastAbnormal != null
                          ? `（${anomaly.daysSinceLastAbnormal}个交易日前）`
                          : ""
                      }`
                    : "30日未触发"}
                </span>
                <span>
                  下一阈值价：
                  {anomaly?.nextTriggerPrice
                    ? anomaly.nextTriggerPrice.toFixed(2)
                    : "—"}
                </span>
              </div>
              {!!anomaly?.regulatoryLabels.length && (
                <p>{anomaly.regulatoryLabels.join(" · ")}</p>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
