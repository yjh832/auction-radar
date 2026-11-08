import { useEffect } from "react";
import { Layers3, X } from "lucide-react";
import { CandidateTable } from "./CandidateTable";
import type { Candidate } from "../types";

interface CandidateUniverseDrawerProps {
  candidates: Candidate[];
  onClose: () => void;
  onSelect: (candidate: Candidate) => void;
}

export function CandidateUniverseDrawer({
  candidates,
  onClose,
  onSelect
}: CandidateUniverseDrawerProps) {
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

  return (
    <div className="candidate-universe-root" role="presentation">
      <button
        className="candidate-universe-backdrop"
        type="button"
        aria-label="关闭30支完整候选池"
        onClick={onClose}
      />
      <aside
        className="candidate-universe-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="30支完整候选池"
      >
        <header className="candidate-universe-header">
          <div>
            <span>FULL REVIEW UNIVERSE</span>
            <h2>完整候选池</h2>
            <p>
              共 {candidates.length} 只，按三图复核分排序；点击股票查看详情，点击“完整字段”展开全部数据。
            </p>
          </div>
          <div className="candidate-universe-actions">
            <span><Layers3 size={16} /> {candidates.length} 支</span>
            <button type="button" onClick={onClose} aria-label="关闭">
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="candidate-universe-body">
          <CandidateTable
            candidates={candidates}
            onSelect={onSelect}
            defaultExpanded={false}
          />
        </div>
      </aside>
    </div>
  );
}
