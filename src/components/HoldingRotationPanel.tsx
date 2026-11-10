import {
  ArrowRightLeft,
  Clock3,
  ShieldAlert,
  Target,
  TrendingUp
} from "lucide-react";
import {
  buildHoldingSwapPlans
} from "../lib/holdingSwap";
import type {
  HoldingSwapMarket,
  HoldingSwapPlan
} from "../lib/holdingSwap";
import type {
  Candidate,
  HoldingPosition,
  HoldingSnapshot
} from "../types";

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function riskLabel(plan: HoldingSwapPlan) {
  if (plan.holdingRisk === "high") return "高";
  if (plan.holdingRisk === "medium") return "中";
  return "低";
}

function actionTone(action: HoldingSwapPlan["action"]) {
  if (action === "switch_partial") return "is-switch";
  if (action === "observe_switch") return "is-observe";
  if (action === "reduce") return "is-defend";
  return "is-hold";
}

function stageLabel(market: HoldingSwapMarket) {
  if (market.liveEligible) return "集合竞价动态比较";
  if (market.key === "trading") return "开盘承接比较";
  if (market.key === "closed") return "收盘复盘比较";
  return "盘前计划比较";
}

export function HoldingRotationPanel({
  positions,
  snapshots,
  candidates,
  market,
  dataDate,
  lastUpdated
}: {
  positions: HoldingPosition[];
  snapshots: HoldingSnapshot[];
  candidates: Candidate[];
  market: HoldingSwapMarket;
  dataDate: string;
  lastUpdated: string | null;
}) {
  if (!positions.length) return null;
  const plans = buildHoldingSwapPlans(snapshots, candidates, market);
  const switchCount = plans.filter(
    (plan) => plan.action === "switch_partial"
  ).length;
  const observeCount = plans.filter(
    (plan) => plan.action === "observe_switch"
  ).length;
  const defendCount = plans.filter(
    (plan) => plan.action === "reduce"
  ).length;
  const missingQuotes = positions.length - snapshots.length;

  return (
    <section className="holding-rotation-panel" aria-label="持仓与推荐票换股比较">
      <header className="holding-rotation-head">
        <div>
          <span>HOLDING × DAILY PICKS</span>
          <h3>持仓与推荐票对比</h3>
          <p>
            量化比较持仓强度、止损风险与未持有推荐票优势，给出条件式置换计划。
          </p>
        </div>
        <div className="holding-rotation-status">
          <Clock3 size={15} />
          <strong>{stageLabel(market)}</strong>
          <small>
            推荐基准 {dataDate}
            {lastUpdated ? ` · 持仓行情 ${lastUpdated}` : ""}
          </small>
        </div>
      </header>

      <div className="holding-rotation-summary">
        <div><span>对比持仓</span><strong>{plans.length}</strong><small>只</small></div>
        <div><span>确认后分批换</span><strong>{switchCount}</strong><small>只</small></div>
        <div><span>换股观察</span><strong>{observeCount}</strong><small>只</small></div>
        <div><span>风险优先</span><strong>{defendCount}</strong><small>只</small></div>
      </div>

      {missingQuotes > 0 && (
        <div className="holding-rotation-missing">
          <ShieldAlert size={15} />
          {missingQuotes} 只持仓尚未取得有效行情，暂不参与置换评分。
        </div>
      )}

      <div className="holding-rotation-plans">
        {plans.map((plan, index) => {
          const candidate = plan.candidate;
          return (
            <article
              className={`holding-swap-card ${actionTone(plan.action)}`}
              key={plan.holdingCode}
            >
              <header>
                <div>
                  <span>持仓 {String(index + 1).padStart(2, "0")}</span>
                  <h4>{plan.holdingName}</h4>
                  <small>{plan.holdingCode}</small>
                </div>
                <strong className={`holding-swap-action ${actionTone(plan.action)}`}>
                  {plan.actionLabel}
                </strong>
              </header>

              <div className="holding-swap-compare">
                <section className="holding-swap-side is-holding">
                  <div className="holding-swap-side-head">
                    <span>持仓质量</span>
                    <strong>{plan.holdingScore.toFixed(0)}</strong>
                  </div>
                  <div className="holding-swap-metrics">
                    <div><span>持仓盈亏</span><strong>{pct(plan.holdingPnlPct)}</strong></div>
                    <div><span>当日涨跌</span><strong>{pct(plan.holdingDayPct)}</strong></div>
                    <div><span>风险</span><strong>{riskLabel(plan)}</strong></div>
                    <div><span>止损 / 止盈</span><strong>{plan.holdingStop.toFixed(2)} / {plan.holdingTakeProfit.toFixed(2)}</strong></div>
                  </div>
                  <div className="holding-swap-tags">
                    {plan.holdingRisks.slice(0, 3).map((risk) => (
                      <span key={risk}>{risk}</span>
                    ))}
                  </div>
                </section>

                <div className="holding-swap-arrow">
                  <ArrowRightLeft size={18} />
                  <strong>{plan.edge >= 0 ? "+" : ""}{plan.edge.toFixed(0)}</strong>
                  <span>强度差</span>
                </div>

                <section className="holding-swap-side is-candidate">
                  <div className="holding-swap-side-head">
                    <span>{candidate ? `${candidate.rankLabel}推荐` : "未持有推荐"}</span>
                    <strong>{candidate ? candidate.score.toFixed(0) : "—"}</strong>
                  </div>
                  {candidate ? (
                    <>
                      <div className="holding-swap-candidate-name">
                        <strong>{candidate.candidate.name}</strong>
                        <span>{candidate.candidate.code} · {candidate.candidate.industry}</span>
                      </div>
                      <div className="holding-swap-metrics">
                        <div><span>观察区间</span><strong>{candidate.entryLow.toFixed(2)}—{candidate.entryHigh.toFixed(2)}</strong></div>
                        <div><span>防守 / 目标</span><strong>{candidate.stop.toFixed(2)} / {candidate.target.toFixed(2)}</strong></div>
                        <div><span>风险</span><strong>{candidate.candidate.riskLevel === "high" ? "高" : candidate.candidate.riskLevel === "medium" ? "中" : "低"}</strong></div>
                        <div>
                          <span>确认状态</span>
                          <strong className={candidate.rejection ? "is-down" : ""}>
                            {market.liveEligible
                              ? candidate.rejection
                                ? "竞价否决"
                                : "竞价通过"
                              : "待9:25确认"}
                          </strong>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="holding-swap-no-candidate">
                      当前推荐票均已在持仓中，或没有未持有候选，不需要为了换股而换股。
                    </p>
                  )}
                </section>
              </div>

              <div className="holding-swap-score">
                <div>
                  <span>置换指数</span>
                  <strong>{plan.swapScore.toFixed(0)}</strong>
                  <small>/ 100</small>
                </div>
                <div className="holding-swap-score-track" aria-hidden="true">
                  <i style={{ width: `${plan.swapScore}%` }} />
                </div>
                <span>0—57 维持 · 58—75 观察 · 76+ 确认后分批换</span>
              </div>

              <div className="holding-swap-factor-grid">
                {plan.dimensions.map((dimension) => {
                  const difference = dimension.candidate - dimension.holding;
                  return (
                    <div key={dimension.key}>
                      <span>{dimension.label}</span>
                      <strong>
                        持仓 {dimension.holding.toFixed(0)}
                        <i> / </i>
                        候选 {dimension.candidate.toFixed(0)}
                      </strong>
                      <em className={difference >= 0 ? "is-up" : "is-down"}>
                        候选{difference >= 0 ? "领先" : "落后"} {Math.abs(difference).toFixed(0)}
                      </em>
                    </div>
                  );
                })}
              </div>
              <p className="holding-swap-coverage">
                持仓数据覆盖 {Math.round(plan.holdingCoverage * 100)}% · 候选数据覆盖{" "}
                {candidate
                  ? `${Math.round((candidate.candidate.scoreCoverage ?? 1) * 100)}%`
                  : "—"}
              </p>

              <div className="holding-swap-decision">
                <Target size={16} />
                <div>
                  <strong>{plan.decision}</strong>
                  <p>{plan.timing}。未通过确认条件时，不执行置换。</p>
                </div>
              </div>

              <ul className="holding-swap-conditions">
                {plan.conditions.map((condition) => (
                  <li key={condition}>{condition}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <footer className="holding-rotation-note">
        <TrendingUp size={15} />
        <p>
          比较基于价格、量能、候选模型分、止损止盈与异动风险，不包含基本面判断。
          集合竞价和开盘承接任一条件失败时，结论自动降级为维持持仓或先控制风险。
        </p>
        <strong>⚠️ 以上分析仅供参考，不构成投资建议。股市有风险，投资需谨慎。</strong>
      </footer>
    </section>
  );
}
