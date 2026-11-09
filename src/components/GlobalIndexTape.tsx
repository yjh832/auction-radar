import { useState } from "react";
import { Check, ChevronDown, Globe2, RefreshCw, X } from "lucide-react";
import {
  GLOBAL_INDEX_OPTIONS
} from "../lib/market";
import type {
  GlobalIndexDefinition,
  GlobalIndexQuote,
  GlobalSectorPulse
} from "../types";

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function GlobalIndexTape({
  selectedSymbols,
  indices,
  strongestUsSectors,
  loading,
  onSelectionChange,
  onOpen,
  onRefresh
}: {
  selectedSymbols: string[];
  indices: GlobalIndexQuote[];
  strongestUsSectors: GlobalSectorPulse[];
  loading: boolean;
  onSelectionChange: (symbols: string[]) => void;
  onOpen: (definition: GlobalIndexDefinition) => void;
  onRefresh: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const quoteMap = new Map(
    indices.map((item) => [item.symbol, item])
  );

  function toggle(symbol: string) {
    if (selectedSymbols.includes(symbol)) {
      if (selectedSymbols.length <= 1) return;
      onSelectionChange(selectedSymbols.filter((item) => item !== symbol));
      return;
    }
    if (selectedSymbols.length >= 6) return;
    onSelectionChange([...selectedSymbols, symbol]);
  }

  return (
    <section className="global-index-tape" aria-label="可自定义全球指数">
      <header className="global-index-head">
        <div>
          <span><Globe2 size={15} />GLOBAL MARKET</span>
          <strong>全球指数温度</strong>
        </div>
        <div>
          <button
            type="button"
            className="global-index-refresh"
            onClick={onRefresh}
            disabled={loading}
            aria-label="刷新全球指数"
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
          </button>
          <button
            type="button"
            className="global-index-picker-button"
            onClick={() => setPickerOpen((value) => !value)}
          >
            选择指数
            <span>{selectedSymbols.length}/6</span>
            <ChevronDown size={14} />
          </button>
        </div>
      </header>

      <div className="global-index-card-grid">
        {selectedSymbols.map((symbol) => {
          const item = quoteMap.get(symbol);
          const definition =
            item ??
            GLOBAL_INDEX_OPTIONS.find((option) => option.symbol === symbol);
          if (!definition) return null;
          const change = item?.quote.changePct ?? 0;
          return (
            <button
              type="button"
              className={`global-index-card ${change >= 0 ? "is-up" : "is-down"} ${definition.region === "美国" ? "is-us" : ""}`}
              key={symbol}
              onClick={() => onOpen(definition)}
            >
              <span className="global-index-region">{definition.region}</span>
              <strong>{definition.name}</strong>
              {item ? (
                <>
                  <em>{item.quote.price.toFixed(2)}</em>
                  <small>{pct(change)}</small>
                </>
              ) : (
                <small>{loading ? "读取中…" : "等待联网"}</small>
              )}
            </button>
          );
        })}
      </div>

      <div className="us-sector-strip">
        <span className="us-sector-label">
          <b>US</b> 美股参考
        </span>
        {strongestUsSectors.length ? (
          strongestUsSectors.map((sector, index) => (
            <span
              className={`us-sector-pill ${sector.changePct >= 0 ? "is-up" : "is-down"}`}
              key={sector.symbol}
            >
              {index === 0 ? "领先 " : ""}
              {sector.name} {pct(sector.changePct)}
            </span>
          ))
        ) : (
          <span className="us-sector-pill">等待美股行情</span>
        )}
        <small>美股行业仅作映射参考，A股执行仍以本地量价和竞价确认为准。</small>
      </div>

      {pickerOpen && (
        <div className="global-index-picker">
          <header>
            <div>
              <span>INDEX WATCHLIST</span>
              <strong>选择6个指数</strong>
            </div>
            <button
              type="button"
              aria-label="关闭指数选择"
              onClick={() => setPickerOpen(false)}
            >
              <X size={17} />
            </button>
          </header>
          <div>
            {GLOBAL_INDEX_OPTIONS.map((option) => {
              const active = selectedSymbols.includes(option.symbol);
              return (
                <button
                  type="button"
                  className={`${active ? "is-selected" : ""} ${option.region === "美国" ? "is-us-option" : ""}`}
                  key={option.symbol}
                  onClick={() => toggle(option.symbol)}
                >
                  <span>
                    <b>{option.region}</b>
                    {option.name}
                  </span>
                  {active && <Check size={15} />}
                </button>
              );
            })}
          </div>
          <p>最多选择6个；A股、港股、美股指数均可组合观察。</p>
        </div>
      )}
    </section>
  );
}
