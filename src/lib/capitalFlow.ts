import type {
  HoldingPosition,
  HoldingTradeRecord
} from "../types";

const TRADES_KEY = "auction-radar:holding-trades:v1";

interface RecommendationMarker {
  code: string;
  name: string;
  rank: 1 | 2;
  date: string;
}

function isRecommendationRank(value: unknown): value is 1 | 2 {
  return value === 1 || value === 2;
}

function isSaleKind(value: unknown) {
  return value === "t" || value === "clear";
}

function isTradeRecord(value: unknown): value is HoldingTradeRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.code === "string" &&
    typeof row.name === "string" &&
    (row.side === "buy" || row.side === "sell") &&
    typeof row.price === "number" &&
    row.price > 0 &&
    typeof row.shares === "number" &&
    row.shares > 0 &&
    typeof row.fee === "number" &&
    typeof row.tradeDate === "string" &&
    (row.source === "recommendation" || row.source === "manual") &&
    (!("costBasis" in row) ||
      row.costBasis == null ||
      (typeof row.costBasis === "number" && row.costBasis >= 0)) &&
    (!("saleKind" in row) ||
      row.saleKind == null ||
      isSaleKind(row.saleKind)) &&
    typeof row.createdAt === "string" &&
    (!("recommendationRank" in row) ||
      row.recommendationRank == null ||
      isRecommendationRank(row.recommendationRank))
  );
}

export function capitalFlowTradeTime(trade: HoldingTradeRecord) {
  return new Date(`${trade.tradeDate}T12:00:00+08:00`).getTime() ||
    new Date(trade.createdAt).getTime();
}

function chinaDateFromIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function loadHoldingTrades(): HoldingTradeRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TRADES_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTradeRecord).sort(
      (a, b) => capitalFlowTradeTime(a) - capitalFlowTradeTime(b)
    );
  } catch {
    return [];
  }
}

export function saveHoldingTrades(trades: HoldingTradeRecord[]) {
  try {
    localStorage.setItem(TRADES_KEY, JSON.stringify(trades));
  } catch {
    // The current session can still show the unsaved ledger.
  }
}

export function createHoldingTrade(
  input: Omit<HoldingTradeRecord, "id" | "createdAt">
): HoldingTradeRecord {
  const createdAt = new Date().toISOString();
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${input.code}-${input.side}-${Date.now()}`;
  return { ...input, id, createdAt };
}

export function ensureOpeningTrades(
  trades: HoldingTradeRecord[],
  positions: HoldingPosition[],
  recommendations: RecommendationMarker[]
) {
  const netShares = new Map<string, number>();
  for (const trade of trades) {
    const current = netShares.get(trade.code) ?? 0;
    netShares.set(
      trade.code,
      current + (trade.side === "buy" ? trade.shares : -trade.shares)
    );
  }
  const additions = positions
    .flatMap((position) => {
      const missingShares = position.shares - (netShares.get(position.code) ?? 0);
      if (missingShares <= 0.000001) return [];
      const recommendation = recommendations.find(
        (item) => item.code === position.code
      );
      const tradeDate = chinaDateFromIso(position.createdAt);
      return [
        createHoldingTrade({
          code: position.code,
          name: position.name,
          side: "buy",
          price: position.cost,
          shares: missingShares,
          fee: 0,
          tradeDate,
          source: recommendation ? "recommendation" : "manual",
          recommendationRank: recommendation?.rank,
          recommendationDate: recommendation?.date,
          note: "由现有持仓补记"
        })
      ];
    });
  if (!additions.length) return trades;
  return [...trades, ...additions].sort(
    (a, b) => capitalFlowTradeTime(a) - capitalFlowTradeTime(b)
  );
}
