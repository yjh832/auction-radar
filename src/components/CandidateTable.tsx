import { AlertTriangle, ArrowUpRight, CircleDot } from "lucide-react";
import type { Candidate } from "../types";

interface CandidateTableProps {
  candidates: Candidate[];
  onSelect: (candidate: Candidate) => void;
}

function pct(value: number, digits = 2) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function riskLabel(level: Candidate["riskLevel"]) {
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}

export function CandidateTable({ candidates, onSelect }: CandidateTableProps) {
  return (
    <div className="candidate-table-wrap">
      <table className="candidate-table">
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
            <th>风险</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr
              key={candidate.code}
              className={candidate.rank === 1 ? "is-top is-clickable" : "is-clickable"}
              role="button"
              tabIndex={0}
              aria-label={`查看${candidate.name}股票详情`}
              onClick={() => onSelect(candidate)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(candidate);
                }
              }}
            >
              <td data-label="综合位次">
                <span className="rank-index">{String(candidate.rank).padStart(2, "0")}</span>
              </td>
              <td data-label="标的">
                <div className="stock-cell">
                  <strong>{candidate.name}</strong>
                  <span>
                    {candidate.code}
                    {candidate.limitToday && (
                      <span className="limit-tag">
                        <CircleDot size={11} />
                        周五封板
                      </span>
                    )}
                  </span>
                </div>
              </td>
              <td data-label="板块">{candidate.industry}</td>
              <td data-label="动态分">
                <div className="score-cell">
                  <strong>
                    {(
                      (candidate.live?.liveScore ??
                        candidate.reviewScore ??
                        candidate.compositeScore) * 100
                    ).toFixed(1)}
                  </strong>
                  <span>{candidate.live ? "竞价分" : candidate.reviewScore != null ? "复盘分" : "风险调整"}</span>
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
              <td data-label="风险">
                <span className={`risk-badge risk-${candidate.riskLevel}`}>
                  {candidate.riskLevel === "high" ? (
                    <AlertTriangle size={12} />
                  ) : (
                    <ArrowUpRight size={12} />
                  )}
                  {riskLabel(candidate.riskLevel)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
