import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, Search, X } from "lucide-react";
import { searchStocks } from "../lib/research";
import type { StockSearchResult } from "../types";

export function StockSearch({
  onSelect
}: {
  onSelect: (result: StockSearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      searchStocks(normalized)
        .then((items) => {
          if (cancelled) return;
          setResults(items);
          setActiveIndex(0);
          setOpen(true);
        })
        .catch((reason: unknown) => {
          if (!cancelled) {
            setError(reason instanceof Error ? reason.message : "搜索失败");
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  function choose(result: StockSearchResult) {
    onSelect(result);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="stock-search" ref={rootRef}>
      <div className={`stock-search-field ${open ? "is-open" : ""}`}>
        <Search size={17} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(Boolean(query.trim()))}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) =>
                Math.min(index + 1, Math.max(results.length - 1, 0))
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && results[activeIndex]) {
              event.preventDefault();
              choose(results[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="搜索股票名称或6位代码"
          aria-label="搜索全市场股票"
          aria-expanded={open}
          aria-controls="stock-search-results"
          autoComplete="off"
        />
        {loading ? (
          <LoaderCircle size={16} className="stock-search-spinner" />
        ) : query ? (
          <button
            type="button"
            className="stock-search-clear"
            aria-label="清空搜索"
            onClick={() => {
              setQuery("");
              setResults([]);
              setOpen(false);
            }}
          >
            <X size={15} />
          </button>
        ) : (
          <span className="stock-search-shortcut">⌘K</span>
        )}
      </div>

      {open && (
        <div className="stock-search-dropdown" id="stock-search-results">
          {error ? (
            <div className="stock-search-state is-error">{error}</div>
          ) : loading && !results.length ? (
            <div className="stock-search-state">正在搜索全市场股票…</div>
          ) : results.length ? (
            <>
              <div className="stock-search-caption">
                全市场搜索结果
                <span>{results.length} 只</span>
              </div>
              {results.map((result, index) => (
                <button
                  type="button"
                  className={`stock-search-result ${index === activeIndex ? "is-active" : ""}`}
                  key={`${result.symbol}-${result.code}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(result)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="stock-search-market">{result.market}</span>
                  <span>
                    <strong>{result.name}</strong>
                    <small>{result.code} · {result.symbol.toUpperCase()}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </>
          ) : (
            <div className="stock-search-state">
              未找到A股标的，请换一个简称或输入6位代码。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
