import type {
  CapitalFlowAnalysis,
  CapitalFlowPoint,
  CapitalFlowSettlement,
  HoldingSnapshot,
  HoldingTradeRecord
} from "../types";
import { capitalFlowTradeTime } from "./capitalFlow";

interface OpenLot {
  shares: number;
  unitCost: number;
  recommendationRank?: 1 | 2;
}

export function analyzeCapitalFlow(
  trades: HoldingTradeRecord[],
  snapshots: HoldingSnapshot[]
): CapitalFlowAnalysis {
  const sorted = [...trades].sort(
    (a, b) => capitalFlowTradeTime(a) - capitalFlowTradeTime(b)
  );
  const lots = new Map<string, OpenLot[]>();
  const settlements: CapitalFlowSettlement[] = [];
  const points: CapitalFlowPoint[] = [];
  let totalBuyCost = 0;
  let totalSellNet = 0;
  let realizedPnl = 0;

  if (sorted.length) {
    points.push({
      id: "starting-point",
      label: "建仓前",
      date: sorted[0].tradeDate,
      netInvested: 0,
      realizedPnl: 0,
      profit: 0
    });
  }

  for (const trade of sorted) {
    const gross = trade.price * trade.shares;
    if (trade.side === "buy") {
      totalBuyCost += gross + trade.fee;
      const queue = lots.get(trade.code) ?? [];
      queue.push({
        shares: trade.shares,
        unitCost: (gross + trade.fee) / trade.shares,
        recommendationRank: trade.recommendationRank
      });
      lots.set(trade.code, queue);
    } else {
      totalSellNet += Math.max(0, gross - trade.fee);
      let remaining = trade.shares;
      const queue = lots.get(trade.code) ?? [];
      let matchedShares = 0;
      let matchedCost = 0;
      let recommendationRank: 1 | 2 | undefined;

      while (remaining > 0 && queue.length) {
        const lot = queue[0];
        const shares = Math.min(remaining, lot.shares);
        matchedShares += shares;
        matchedCost += lot.unitCost * shares;
        recommendationRank ??= lot.recommendationRank;
        remaining -= shares;
        lot.shares -= shares;
        if (lot.shares <= 0.000001) queue.shift();
      }
      lots.set(trade.code, queue);

      const proceedsPerShare = trade.shares > 0
        ? Math.max(0, gross - trade.fee) / trade.shares
        : 0;
      const matchedProceeds = proceedsPerShare * matchedShares;
      const pnl = matchedProceeds - matchedCost;
      realizedPnl += pnl;
      settlements.push({
        tradeId: trade.id,
        code: trade.code,
        name: trade.name,
        date: trade.tradeDate,
        shares: trade.shares,
        proceeds: Math.max(0, gross - trade.fee),
        costBasis: matchedCost,
        pnl,
        pnlPct: matchedCost > 0 ? pnl / matchedCost : 0,
        matched: matchedShares >= trade.shares - 0.000001,
        recommendationRank
      });
    }

    const netInvested = totalBuyCost - totalSellNet;
    points.push({
      id: trade.id,
      label: `${trade.side === "buy" ? "买入" : "卖出"} ${trade.name}`,
      date: trade.tradeDate,
      netInvested,
      realizedPnl,
      profit: realizedPnl
    });
  }

  const openCost = snapshots.reduce(
    (sum, item) => sum + item.position.cost * item.position.shares,
    0
  );
  const openMarketValue = snapshots.reduce(
    (sum, item) => sum + item.marketValue,
    0
  );
  const unrealizedPnl = snapshots.reduce((sum, item) => sum + item.pnl, 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const netInvested = totalBuyCost - totalSellNet;

  if (sorted.length || snapshots.length) {
    points.push({
      id: "current-position",
      label: "当前持仓",
      date: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date()),
      netInvested,
      realizedPnl,
      profit: totalPnl
    });
  }

  const recommendationSamples = settlements.filter(
    (item) => item.matched && item.recommendationRank
  );
  const recommendationWins = recommendationSamples.filter(
    (item) => item.pnl > 0
  ).length;

  return {
    points,
    settlements,
    totalBuyCost,
    totalSellNet,
    netInvested,
    openCost,
    openMarketValue,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    returnPct: totalBuyCost > 0 ? totalPnl / totalBuyCost : 0,
    recommendationSamples: recommendationSamples.length,
    recommendationWins,
    recommendationWinRate:
      recommendationSamples.length > 0
        ? recommendationWins / recommendationSamples.length
        : 0
  };
}
