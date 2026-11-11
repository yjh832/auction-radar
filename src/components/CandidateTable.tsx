import { Fragment, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Info
} from "lucide-react";
import type { Candidate } from "../types";
import { analyzeCapitalStyle } from "../lib/capitalStyle";

interface CandidateTableProps {
  candidates: Candidate[];
  onSelect: (candidate: Candidate) => void;
  defaultExpanded?: boolean;
  preferredCodes?: string[];
  preferredLabels?: string[];
}

function pct(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(0)}万`;
  return value.toFixed(0);
}

function riskLabel(level: Candidate["riskLevel"]) {
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}

function anomalyStatusLabel(
  status: "clear" | "watch" | "abnormal" | undefined
) {
  if (status === "abnormal") return "异动提示";
  if (status === "watch") return "接近阈值";
  return "公开提示未命中";
}

function directionClass(value: number | null | undefined) {
  if (value == null || value === 0) return "";
  return value > 0 ? "is-up" : "is-down";
}

function Field({
  label,
  value,
  tone
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="candidate-field">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function FieldGroup({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="candidate-field-group">
      <h4>{title}</h4>
      <div>{children}</div>
    </section>
  );
}

function CandidateFullFields({ candidate }: { candidate: Candidate }) {
  const current = candidate.reviewMetrics?.current ?? candidate.close;
  const dayReturn = candidate.reviewMetrics?.dayReturn ?? candidate.dayRet;
  const turnover = candidate.reviewMetrics?.turnover ?? candidate.turnoverEst;
  const amount = candidate.reviewMetrics?.amount ?? candidate.amountEst;
  const amountRatio =
    candidate.reviewMetrics?.amountRatio ??
    amount / Math.max(candidate.avg5Amount || 1, 1);
  const closePosition =
    candidate.reviewMetrics?.closePosition ?? candidate.closePos;
  const dynamicScore =
    candidate.live?.liveScore ??
    candidate.reviewScore ??
    candidate.compositeScore;
  const distanceToHigh20 = Math.max(0, 1 - candidate.nearHigh20);
  const capitalStyle = analyzeCapitalStyle(candidate);

  return (
    <div className="candidate-full-fields">
      <FieldGroup title="行情与流动性">
        <Field label="收盘 / 现价" value={current.toFixed(2)} />
        <Field label="当日涨跌" value={pct(dayReturn)} tone={directionClass(dayReturn)} />
        <Field label="开盘缺口" value={pct(candidate.gap)} tone={directionClass(candidate.gap)} />
        <Field label="实际换手" value={`${turnover.toFixed(2)}%`} />
        <Field label="成交额" value={money(amount)} />
        <Field label="量能倍数" value={`${candidate.volRatio.toFixed(2)}x`} />
        <Field label="成交额 / 5日均额" value={`${amountRatio.toFixed(2)}x`} />
        <Field label="前5日平均成交额" value={money(candidate.avg5Amount)} />
        <Field label="流通市值" value={money(candidate.floatCap)} />
      </FieldGroup>

      <FieldGroup title="涨停基因与动量">
        <Field label="今日封板" value={candidate.limitToday ? "是" : "否"} />
        <Field label="连板高度" value={`${candidate.limitStreak} 板`} />
        <Field label="20日涨停" value={`${candidate.limit20} 次`} />
        <Field label="60日涨停" value={`${candidate.limit60} 次`} />
        <Field label="5日涨幅" value={pct(candidate.ret5)} tone={directionClass(candidate.ret5)} />
        <Field label="10日涨幅" value={pct(candidate.ret10)} tone={directionClass(candidate.ret10)} />
        <Field label="收盘位置" value={pct(closePosition)} />
        <Field label="距20日高点" value={pct(distanceToHigh20)} />
        <Field label="涨停阈值" value={pct(candidate.limit, 0)} />
      </FieldGroup>

      <FieldGroup title="板块结构">
        <Field label="所属板块" value={candidate.industry} />
        <Field label="板块股票数" value={`${candidate.sectorN} 只`} />
        <Field label="板块涨停数" value={`${candidate.sectorLimitCount} 只`} />
        <Field label="板块强势股" value={`${candidate.sectorStrongCount} 只`} />
        <Field
          label="涨停占比"
          value={pct(candidate.sectorLimitCount / Math.max(candidate.sectorN, 1))}
        />
      </FieldGroup>

      <FieldGroup title="资金属性与补涨关系">
        <Field label="资金风格" value={capitalStyle.label} />
        <Field label="游资评分" value={capitalStyle.hotMoneyScore} />
        <Field label="机构评分" value={capitalStyle.institutionScore} />
        <Field
          label="连板适配"
          value={capitalStyle.rotationFriendly ? "适合游资接力筛选" : "不优先按连板补涨"}
        />
        <Field label="断板龙头" value={candidate.matchedLeader ?? "当前未形成模板"} />
        <Field label="龙头板块" value={candidate.matchedLeaderIndustry ?? "—"} />
        <Field label="补涨关联" value={candidate.leaderRelationLabel ?? "待断板模板确认"} />
        <Field
          label="关联强度"
          value={
            candidate.leaderRelationScore == null
              ? "—"
              : `${candidate.leaderRelationScore.toFixed(0)}%`
          }
        />
        <Field
          label="补涨资格"
          value={
            candidate.leaderRelationQualified == null
              ? "非打板池"
              : candidate.leaderRelationQualified
                ? "通过属性硬约束"
                : "属性关联不足"
          }
          tone={
            candidate.leaderRelationQualified === false ? "risk-high" : "risk-low"
          }
        />
        <div className="candidate-field candidate-field--wide">
          <span>资金风格依据</span>
          <div className="candidate-tag-list">
            {capitalStyle.reasons.map((reason) => (
              <em key={reason}>{reason}</em>
            ))}
          </div>
        </div>
        <div className="candidate-field candidate-field--wide">
          <span>龙头关联依据</span>
          <div className="candidate-tag-list">
            {(candidate.leaderRelationReasons?.length
              ? candidate.leaderRelationReasons
              : ["等待最高连板断板后生成"]
            ).map((reason) => (
              <em key={reason}>{reason}</em>
            ))}
          </div>
        </div>
        <div className="candidate-field candidate-field--wide">
          <span>判断口径</span>
          <strong>
            游资/机构为连板高度、换手率、流通市值、成交额与板块属性的量化风格推断，
            不等同于龙虎榜席位已确认。
          </strong>
        </div>
      </FieldGroup>

      <FieldGroup title="三图评分">
        <Field label="动态分" value={(dynamicScore * 100).toFixed(1)} />
        <Field label="综合精选分" value={candidate.recommendationScore?.toFixed(1) ?? "—"} />
        <Field label="选股质量分" value={candidate.qualityScore?.toFixed(1) ?? "—"} />
        <Field label="竞价执行分" value={candidate.executionScore?.toFixed(1) ?? "—"} />
        <Field label="次日可参与值" value={candidate.actionabilityScore?.toFixed(1) ?? "—"} />
        <Field label="次日参与评级" value={candidate.actionabilityLabel ?? "—"} />
        <Field label="近半月启动位置" value={candidate.recentPosition?.label ?? "—"} />
        <Field label="启动前15日分位" value={candidate.recentPosition?.percentile == null ? "—" : `${candidate.recentPosition.percentile.toFixed(0)}%`} />
        <Field label="当前15日分位" value={candidate.recentPosition?.currentPercentile == null ? "—" : `${candidate.recentPosition.currentPercentile.toFixed(0)}%`} />
        <Field label="15日区间低 / 高" value={candidate.recentPosition?.rangeLow == null || candidate.recentPosition.rangeHigh == null ? "—" : `${candidate.recentPosition.rangeLow.toFixed(2)} / ${candidate.recentPosition.rangeHigh.toFixed(2)}`} />
        <Field label="断板龙头模板" value={candidate.matchedLeader ?? "—"} />
        <Field label="龙头启动相似度" value={candidate.leaderSimilarity == null ? "—" : `${candidate.leaderSimilarity.toFixed(1)}%`} />
        <Field label="数据覆盖" value={candidate.scoreCoverage == null ? "—" : `${Math.round(candidate.scoreCoverage * 100)}%`} />
        <Field label="基因模型" value={candidate.scoreBreakdown?.model.toFixed(1) ?? "—"} />
        <Field label="三图复核" value={candidate.scoreBreakdown?.review.toFixed(1) ?? "—"} />
        <Field label="竞价质量" value={candidate.scoreBreakdown?.auction.toFixed(1) ?? "—"} />
        <Field label="封单质量" value={candidate.scoreBreakdown?.seal.toFixed(1) ?? "—"} />
        <Field label="板块质量" value={candidate.scoreBreakdown?.sector.toFixed(1) ?? "—"} />
        <Field label="流动性" value={candidate.scoreBreakdown?.liquidity.toFixed(1) ?? "—"} />
        <Field label="动量质量" value={candidate.scoreBreakdown?.momentum.toFixed(1) ?? "—"} />
        <Field label="风险质量" value={candidate.scoreBreakdown?.risk.toFixed(1) ?? "—"} />
        <Field label="龙虎榜方向" value={candidate.scoreBreakdown?.lhb.toFixed(1) ?? "—"} />
        <Field label="模型原始分" value={(candidate.modelScore * 100).toFixed(1)} />
        <Field label="综合风险调整" value={(candidate.compositeScore * 100).toFixed(1)} />
        <Field label="三图总分" value={candidate.mapScores ? `${Math.round(candidate.mapScores.total * 100)}` : "—"} />
        <Field label="情绪适配" value={candidate.mapScores ? `${Math.round(candidate.mapScores.emotion * 100)}` : "—"} />
        <Field label="资金适配" value={candidate.mapScores ? `${Math.round(candidate.mapScores.capital * 100)}` : "—"} />
        <Field label="风险安全垫" value={candidate.mapScores ? `${Math.round(candidate.mapScores.risk * 100)}` : "—"} />
        <Field label="模型原始排名" value={`#${candidate.modelRank}`} />
      </FieldGroup>

      <FieldGroup title="异动与公开监管">
        <Field label="10日涨幅" value={pct(candidate.ret10)} tone={directionClass(candidate.ret10)} />
        <Field label="30日涨幅" value={pct(candidate.ret30)} tone={directionClass(candidate.ret30)} />
        <Field label="距10日100%红线" value={candidate.anomaly?.distanceToTenDayLimit == null ? "—" : candidate.anomaly.distanceToTenDayLimit <= 0 ? "已达到" : pct(candidate.anomaly.distanceToTenDayLimit)} tone={candidate.anomaly?.distanceToTenDayLimit != null && candidate.anomaly.distanceToTenDayLimit <= 0 ? "risk-high" : undefined} />
        <Field label="距30日200%红线" value={candidate.anomaly?.distanceToThirtyDayLimit == null ? "—" : candidate.anomaly.distanceToThirtyDayLimit <= 0 ? "已达到" : pct(candidate.anomaly.distanceToThirtyDayLimit)} tone={candidate.anomaly?.distanceToThirtyDayLimit != null && candidate.anomaly.distanceToThirtyDayLimit <= 0 ? "risk-high" : undefined} />
        <Field label="3日累计" value={pct(candidate.anomaly?.threeDayReturn)} tone={directionClass(candidate.anomaly?.threeDayReturn)} />
        <Field label="异动阈值" value={pct(candidate.anomaly?.threshold, 0)} />
        <Field label="距阈值" value={candidate.anomaly?.distanceToThreshold === 0 ? "已达到" : pct(candidate.anomaly?.distanceToThreshold)} />
        <Field label="下一阈值价" value={candidate.anomaly?.nextTriggerPrice?.toFixed(2) ?? "—"} />
        <Field label="最近异动" value={candidate.anomaly?.lastAbnormalDate ?? "30日未触发"} />
        <Field label="距最近异动" value={candidate.anomaly?.daysSinceLastAbnormal != null ? `${candidate.anomaly.daysSinceLastAbnormal}个交易日` : "—"} />
        <Field label="近30日异动次数" value={`${candidate.anomaly?.abnormalCount30 ?? 0}次`} />
        <Field label="公开提示状态" value={anomalyStatusLabel(candidate.anomaly?.regulatoryStatus)} tone={candidate.anomaly?.regulatoryStatus === "abnormal" ? "risk-high" : candidate.anomaly?.regulatoryStatus === "watch" ? "risk-medium" : "risk-low"} />
        <div className="candidate-field candidate-field--wide">
          <span>异动/监管标签</span>
          <div className="candidate-tag-list">
            {candidate.anomaly?.regulatoryLabels.length
              ? candidate.anomaly.regulatoryLabels.map((label) => <em key={label}>{label}</em>)
              : <em>公开数据未命中明确提示</em>}
          </div>
        </div>
      </FieldGroup>

      <FieldGroup title="上日竞价记忆">
        <Field label="竞价价格" value={candidate.lastAuction.price.toFixed(2)} />
        <Field label="竞价成交额" value={money(candidate.lastAuction.amount)} />
        <Field label="占5日均额" value={pct(candidate.lastAuction.ratio)} />
        <Field label="首5分钟" value={pct(candidate.lastAuction.first5Ret)} tone={directionClass(candidate.lastAuction.first5Ret)} />
        <Field label="竞价复核" value={candidate.live ? (candidate.liveEligible ? "通过" : "未通过") : "等待次日"} />
        <Field label="复核说明" value={candidate.liveReason ?? "—"} />
        <Field label="打板推荐值" value={candidate.boardScore == null ? "—" : candidate.boardScore.toFixed(1)} />
        <Field label="封单状态" value={candidate.auctionSeal?.label ?? "等待9:25封单"} />
        <Field label="买一价格" value={candidate.auctionSeal?.bid1Price?.toFixed(2) ?? "—"} />
        <Field label="封单量" value={candidate.auctionSeal?.bid1Lots ? `${(candidate.auctionSeal.bid1Lots / 10_000).toFixed(2)}万手` : "—"} />
        <Field label="封单金额" value={candidate.auctionSeal?.sealAmount ? money(candidate.auctionSeal.sealAmount) : "—"} />
        <Field label="封单占流通" value={candidate.auctionSeal ? pct(candidate.auctionSeal.floatCapRatio) : "—"} />
        <Field label="封单强度" value={candidate.auctionSeal ? candidate.auctionSeal.score.toFixed(1) : "—"} />
        {candidate.live && (
          <>
            <Field label="竞价动态分" value={(candidate.live.liveScore * 100).toFixed(1)} />
            <Field label="竞价高开" value={pct(candidate.live.gap)} tone={directionClass(candidate.live.gap)} />
            <Field label="竞价成交额" value={money(candidate.live.auctionAmount)} />
            <Field label="竞价量额比" value={pct(candidate.live.auctionRatio)} />
            <Field label="高开强度" value={pct(candidate.live.gapStrength)} />
            <Field label="竞价现价" value={candidate.live.current.toFixed(2)} />
          </>
        )}
      </FieldGroup>

      <FieldGroup title="风险与标签">
        <Field label="风险等级" value={riskLabel(candidate.riskLevel)} tone={`risk-${candidate.riskLevel}`} />
        <Field label="风险扣分" value={candidate.riskPenalty.toFixed(2)} />
        <Field label="股票代码" value={candidate.code} />
        <Field label="行情标识" value={candidate.symbol} />
        <div className="candidate-field candidate-field--wide">
          <span>模型标签</span>
          <div className="candidate-tag-list">
            {candidate.reviewTags?.length
              ? candidate.reviewTags.map((tag) => <em key={tag}>{tag}</em>)
              : <em>暂无标签</em>}
          </div>
        </div>
        <div className="candidate-field candidate-field--wide">
          <span>风险提示</span>
          <ul className="candidate-risk-notes">
            {candidate.riskNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
      </FieldGroup>
    </div>
  );
}

export function CandidateTable({
  candidates,
  onSelect,
  defaultExpanded = false,
  preferredCodes = [],
  preferredLabels = []
}: CandidateTableProps) {
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(
    () =>
      new Set(
        defaultExpanded ? candidates.map((candidate) => candidate.code) : []
      )
  );

  useEffect(() => {
    setExpandedCodes(
      new Set(
        defaultExpanded ? candidates.map((candidate) => candidate.code) : []
      )
    );
  }, [candidates, defaultExpanded]);

  const allExpanded =
    candidates.length > 0 &&
    candidates.every((candidate) => expandedCodes.has(candidate.code));

  function toggleCandidate(code: string) {
    setExpandedCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleAll() {
    setExpandedCodes(
      allExpanded ? new Set() : new Set(candidates.map((candidate) => candidate.code))
    );
  }

  return (
    <div className="candidate-table-wrap">
      <div className="candidate-table-toolbar">
        <div>
          <Info size={15} />
          <span>
            共 {candidates.length} 只候选；打板值综合封单、高开、竞价量能与风险，
            可执行性单独判断。完整字段默认收起。
          </span>
        </div>
        <button type="button" onClick={toggleAll}>
          {allExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {allExpanded ? "收起全部字段" : "展开全部字段"}
        </button>
      </div>
      <table className="candidate-table">
        <colgroup>
          <col className="col-rank" />
          <col className="col-stock" />
          <col className="col-sector" />
          <col className="col-dynamic" />
          <col className="col-model" />
          <col className="col-limit" />
          <col className="col-volume" />
          <col className="col-return" />
          <col className="col-board" />
          <col className="col-risk" />
        </colgroup>
        <thead>
          <tr>
            <th>综合位次</th>
            <th>标的</th>
            <th>板块</th>
            <th>动态分</th>
            <th>模型分</th>
            <th>涨停记忆</th>
            <th>量能</th>
            <th>5日 / 10日</th>
            <th>打板值</th>
            <th>风险 / 字段</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate, index) => {
            const expanded = expandedCodes.has(candidate.code);
            const displayRank = index + 1;
            const preferredIndex = preferredCodes.indexOf(candidate.code);
            const isFirstPick =
              preferredCodes.length > 0
                ? preferredIndex === 0
                : index === 0;
            const isSecondPick =
              preferredCodes.length > 0
                ? preferredIndex === 1
                : index === 1;
            const usReference = candidate.reviewTags?.find((tag) =>
              tag.startsWith("美股")
            );
            const capitalStyle = analyzeCapitalStyle(candidate);
            return (
              <Fragment key={candidate.code}>
                <tr
                  className={[
                    "is-clickable",
                    isFirstPick ? "is-top is-pick-one" : "",
                    isSecondPick ? "is-pick-two" : "",
                    (candidate.actionabilityScore ?? 100) < 55
                      ? "is-hard-to-enter"
                      : ""
                  ].filter(Boolean).join(" ")}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看${candidate.name}股票详情`}
                  onClick={() => onSelect(candidate)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(candidate);
                    }
                  }}
                >
                  <td data-label="综合位次">
                    <span className="rank-index">{String(displayRank).padStart(2, "0")}</span>
                  </td>
                  <td data-label="标的">
                    <div className="stock-cell">
                      <strong>{candidate.name}</strong>
                      <span>
                        {candidate.code}
                        {isFirstPick && (
                          <span className="pick-list-badge pick-list-badge--one">
                            {preferredLabels[0] ?? "首选"}
                          </span>
                        )}
                        {isSecondPick && (
                          <span className="pick-list-badge pick-list-badge--two">
                            {preferredLabels[1] ?? "备选"}
                          </span>
                        )}
                        {usReference && (
                          <span className="us-reference-badge" title={usReference}>
                            美股参考
                          </span>
                        )}
                        {candidate.limitToday && (
                          <span className="limit-tag">
                            <CircleDot size={11} />
                            封板
                          </span>
                        )}
                        <span
                          className={`capital-style-badge is-${capitalStyle.style}`}
                          title={`游资评分 ${capitalStyle.hotMoneyScore}，机构评分 ${capitalStyle.institutionScore}`}
                        >
                          {capitalStyle.label}
                        </span>
                        {candidate.leaderRelationLabel && (
                          <span
                            className={`leader-relation-badge ${
                              candidate.leaderRelationQualified
                                ? "is-linked"
                                : "is-unlinked"
                            }`}
                          >
                            {candidate.leaderRelationLabel}
                          </span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td data-label="板块">{candidate.industry}</td>
                  <td data-label="动态分">
                    <div className="score-cell">
                      <strong>
                        {(candidate.recommendationScore ??
                          (candidate.live?.liveScore ??
                            candidate.reviewScore ??
                            candidate.compositeScore) *
                            100
                        ).toFixed(1)}
                      </strong>
                      <span>
                        {candidate.recommendationScore != null
                          ? candidate.live
                            ? "实时精选"
                            : "综合精选"
                          : candidate.live
                            ? "竞价分"
                            : candidate.mapScores
                              ? `三图 ${Math.round(candidate.mapScores.total * 100)}`
                              : candidate.reviewScore != null
                                ? "复盘分"
                                : "风险调整"}
                        {candidate.actionabilityScore != null
                          ? ` · 参与${Math.round(candidate.actionabilityScore)}`
                          : ""}
                      </span>
                    </div>
                  </td>
                  <td data-label="模型分">{(candidate.modelScore * 100).toFixed(1)}</td>
                  <td data-label="涨停记忆">
                    {candidate.limit20} / {candidate.limit60}
                    <span className="mobile-label">20日 / 60日</span>
                  </td>
                  <td data-label="量能">{candidate.volRatio.toFixed(2)}x</td>
                  <td className="return-cell" data-label="5日 / 10日">
                    <span className={candidate.ret5 >= 0 ? "is-up" : "is-down"}>
                      {pct(candidate.ret5)}
                    </span>
                    <span className={candidate.ret10 >= 0 ? "is-up" : "is-down"}>
                      {pct(candidate.ret10)}
                    </span>
                  </td>
                  <td data-label="打板值">
                    <div className="board-score-cell">
                      <strong>
                        {candidate.boardScore == null
                          ? "—"
                          : Math.round(candidate.boardScore)}
                      </strong>
                      <span>
                        <span
                          title={
                            candidate.auctionSeal?.label ??
                            "等待9:25封单"
                          }
                        >
                          {candidate.auctionSeal?.sealed
                            ? candidate.auctionSeal.label
                            : "等待9:25封单"}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td data-label="风险 / 字段">
                    <div className="candidate-row-actions">
                      <span className={`risk-badge risk-${candidate.riskLevel}`}>
                        {candidate.riskLevel === "high" ? (
                          <AlertTriangle size={12} />
                        ) : (
                          <ArrowUpRight size={12} />
                        )}
                        {riskLabel(candidate.riskLevel)}
                      </span>
                      <button
                        type="button"
                        className="field-toggle"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "收起" : "展开"}${candidate.name}全部字段`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCandidate(candidate.code);
                        }}
                      >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        完整字段
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr className="candidate-field-row">
                    <td colSpan={10}>
                      <CandidateFullFields candidate={candidate} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
