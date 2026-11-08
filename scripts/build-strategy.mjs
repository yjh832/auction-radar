import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReviewMaps,
  fetchIndustryMap,
  fetchLhbStocks,
  fetchLimitPools,
  scoreCandidateWithMaps
} from "./review-model.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(appRoot, "..");
async function latestModelOutput() {
  if (process.env.MODEL_OUTPUT) return path.resolve(process.env.MODEL_OUTPUT);
  const files = (await fs.readdir(path.join(workspaceRoot, "outputs")))
    .filter((file) =>
      /^optimized_monday_watchlist_(\d{4}-\d{2}-\d{2}|\d{8})\.json$/.test(file)
    )
    .sort();
  if (!files.length) {
    throw new Error("No optimized_monday_watchlist_YYYYMMDD.json file found");
  }
  return path.join(workspaceRoot, "outputs", files.at(-1));
}

function nextWeekday(dateString) {
  const date = new Date(`${dateString}T12:00:00+08:00`);
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() === 0 || date.getDay() === 6);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

const sourcePath = await latestModelOutput();
const dailyCache = path.join(workspaceRoot, "work", "daily_cache_20261106");
const outputPath = path.join(appRoot, "data", "strategy.json");
const publicOutputPath = path.join(appRoot, "public", "strategy.json");

const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));

const riskProfiles = {
  "002086": {
    level: "high",
    penalty: 0.09,
    notes: ["10日涨幅约90%", "异常波动及风险提示", "换手约42.6%，拥挤"]
  },
  "600261": {
    level: "high",
    penalty: 0.08,
    notes: ["10日涨幅约56%", "已多次发布异常波动公告"]
  },
  "603657": {
    level: "high",
    penalty: 0.08,
    notes: ["三连板", "周五盘后异常波动公告", "高位分歧可能放大"]
  },
  "601595": {
    level: "medium",
    penalty: 0.03,
    notes: ["5日涨幅约30%", "首板后需确认传媒板块延续"]
  },
  "002712": {
    level: "high",
    penalty: 0.08,
    notes: ["5日涨幅约33%", "近期存在股份司法冻结与担保事项"]
  },
  "002696": {
    level: "medium",
    penalty: 0.04,
    notes: ["周五未封板", "属于板块内补涨候选", "近期管理层职务调整"]
  },
  "603366": {
    level: "medium",
    penalty: 0.04,
    notes: ["首板", "存在历史减持计划", "需要竞价主动转强"]
  },
  "600371": {
    level: "high",
    penalty: 0.07,
    notes: ["周五发布异常波动公告", "高位换手放大"]
  },
  "002088": {
    level: "high",
    penalty: 0.08,
    notes: ["四连板", "异常波动及风险提示", "5日与10日涨幅较高"]
  },
  "600327": {
    level: "low",
    penalty: 0.01,
    notes: ["首板", "换手与成交额同步放大"]
  }
};

const knownLastAuction = {
  "600261": { price: 5.16, amount: 79_660_000, ratio: 0.094, first5Ret: 0.0174 },
  "603657": { price: 32, amount: 7_901_000, ratio: 0.0493, first5Ret: 0.0588 },
  "601595": { price: 31, amount: 6_711_000, ratio: 0.0112, first5Ret: 0.039 },
  "002712": { price: 5.31, amount: 2_642_000, ratio: 0.0124, first5Ret: 0.0132 },
  "002696": { price: 10.39, amount: 11_570_000, ratio: 0.0123, first5Ret: -0.0029 },
  "603366": { price: 8.99, amount: 5_100_000, ratio: 0.0102, first5Ret: 0.0479 },
  "002086": { price: 3.67, amount: 147_175_000, ratio: 0.0896, first5Ret: 0.0218 }
};

function boardLimit(code) {
  return code.startsWith("300") || code.startsWith("301") || code.startsWith("688") || code.startsWith("689")
    ? 0.2
    : 0.1;
}

function symbolFor(code) {
  return `${code.startsWith("6") ? "sh" : "sz"}${code}`;
}

async function readHistory(code) {
  try {
    const payload = JSON.parse(
      await fs.readFile(path.join(dailyCache, `${code}.json`), "utf8")
    );
    return payload.rows;
  } catch {
    return [];
  }
}

async function readDailyUniverse() {
  const files = (await fs.readdir(dailyCache)).filter((file) =>
    /^\d{6}\.json$/.test(file)
  );
  const result = new Map();
  for (let index = 0; index < files.length; index += 120) {
    const batch = files.slice(index, index + 120);
    const payloads = await Promise.all(
      batch.map(async (file) => {
        try {
          return JSON.parse(
            await fs.readFile(path.join(dailyCache, file), "utf8")
          );
        } catch {
          return null;
        }
      })
    );
    for (const payload of payloads) {
      if (payload?.code && Array.isArray(payload.rows)) {
        result.set(String(payload.code), payload);
      }
    }
  }
  return result;
}

function rowForDate(payload, date) {
  const index = payload.rows.findIndex((row) => row[0] === date);
  return index > 0 ? { index, row: payload.rows[index] } : null;
}

function isLimitRow(row, previousRow, code) {
  const previousClose = Number(previousRow[2]);
  const close = Number(row[2]);
  return (
    previousClose > 0 &&
    close / previousClose - 1 >= boardLimit(code) - 0.005
  );
}

function streakAt(payload, index, code) {
  let streak = 0;
  for (let cursor = index; cursor > 0; cursor -= 1) {
    if (!isLimitRow(payload.rows[cursor], payload.rows[cursor - 1], code)) break;
    streak += 1;
  }
  return streak;
}

function buildDailySnapshot(dailyUniverse, date) {
  return [...dailyUniverse.values()].flatMap((payload) => {
    const found = rowForDate(payload, date);
    if (!found) return [];
    const previous = payload.rows[found.index - 1];
    const volume = Number(found.row[5]);
    const close = Number(found.row[2]);
    return [{
      code: String(payload.code),
      name: String(payload.name),
      open: Number(found.row[1]),
      preClose: Number(previous[2]),
      current: close,
      high: Number(found.row[3]),
      low: Number(found.row[4]),
      volume,
      amount: volume * 100 * close,
      turnover: 0
    }];
  });
}

function dailyLimitSeeds(dailyUniverse, date, sectorMap) {
  return [...dailyUniverse.values()].flatMap((payload) => {
    const found = rowForDate(payload, date);
    if (!found) return [];
    const streak = streakAt(payload, found.index, String(payload.code));
    if (!streak) return [];
    return [{
      code: String(payload.code),
      name: String(payload.name),
      sector: sectorMap.get(String(payload.code)) ?? "未分类",
      streak,
      close: Number(found.row[2])
    }];
  });
}

async function readMinute(code) {
  try {
    const response = await fetch(
      `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbolFor(code)}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const payload = await response.json();
    return payload.data[symbolFor(code)].data.data;
  } catch {
    return [];
  }
}

function normalizeCandidate(item) {
  const risk =
    riskProfiles[item.code] ??
    ({ level: "medium", penalty: 0.04, notes: ["未收录额外风险标签"] });
  return {
    modelRank: item.rank,
    code: item.code,
    symbol: symbolFor(item.code),
    name: item.name,
    industry: item.industry,
    modelScore: item.model_score,
    close: item.close,
    dayRet: item.day_ret,
    gap: item.gap,
    limit: boardLimit(item.code),
    limitToday: item.limit_today === 1,
    limit20: item.limit20,
    limit60: item.limit60,
    limitStreak: item.limit_streak,
    volRatio: item.vol_ratio,
    ret5: item.ret5,
    ret10: item.ret10,
    closePos: item.close_pos,
    nearHigh20: item.near_high20,
    turnoverEst: item.turnover_est,
    amountEst: item.amount_est,
    sectorN: item.sector_n,
    sectorLimitCount: item.sector_limit_count,
    sectorStrongCount: item.sector_strong_count,
    floatCap: item.float_cap,
    riskLevel: risk.level,
    riskPenalty: risk.penalty,
    riskNotes: risk.notes,
    compositeScore: item.model_score - risk.penalty
  };
}

const all = source.top.map(normalizeCandidate);
all.sort((a, b) => b.compositeScore - a.compositeScore);
all.forEach((candidate, index) => {
  candidate.rank = index + 1;
});

for (const candidate of all) {
  const history = await readHistory(candidate.code);
  const minute = await readMinute(candidate.code);
  const last20 = history.slice(-20);
  const prior5 = history.slice(-6, -1);
  const avg5Amount =
    prior5.reduce(
      (sum, row) => sum + Number(row[5]) * 100 * Number(row[2]),
      0
    ) / Math.max(prior5.length, 1);

  candidate.avg5Amount = avg5Amount;
  candidate.history = last20.map((row) => ({
    date: row[0],
    close: Number(row[2])
  }));

  if (minute.length >= 6) {
    const auction = minute[0].split(" ");
    const first5 = minute[5].split(" ");
    const auctionAmount = Number(auction[3]);
    const auctionPrice = Number(auction[1]);
    candidate.lastAuction = {
      price: auctionPrice,
      amount: auctionAmount,
      ratio: avg5Amount ? auctionAmount / avg5Amount : 0,
      first5Ret: auctionPrice ? Number(first5[1]) / auctionPrice - 1 : 0
    };
  } else {
    candidate.lastAuction = knownLastAuction[candidate.code] ?? {
      price: candidate.close,
      amount: 0,
      ratio: 0,
      first5Ret: 0
    };
  }
}

const dailyUniverse = await readDailyUniverse();
const dailySnapshot = buildDailySnapshot(dailyUniverse, source.as_of);
const [pools, industryMap, lhbStocks] = await Promise.all([
  fetchLimitPools(source.as_of),
  fetchIndustryMap(),
  fetchLhbStocks(source.as_of)
]);
const sectorMap = new Map(industryMap);
for (const item of pools?.items ?? []) {
  sectorMap.set(item.code, item.sector);
}
const previousDate =
  [...new Set(
    [...dailyUniverse.values()].flatMap((payload) => {
      const found = rowForDate(payload, source.as_of);
      const priorDate = found ? payload.rows[found.index - 1]?.[0] : "";
      return priorDate ? [priorDate] : [];
    })
  )]
    .filter((date) => date < source.as_of)
    .sort()
    .at(-1) ?? "";
const previousLimitUps = dailyLimitSeeds(
  dailyUniverse,
  previousDate,
  sectorMap
);
const reviewMaps = buildReviewMaps({
  snapshot: dailySnapshot,
  pools,
  lhbStocks,
  previousLimitUps,
  previousDate,
  date: source.as_of
});
const dailySnapshotMap = new Map(
  dailySnapshot.map((stock) => [stock.code, stock])
);

for (const candidate of all) {
  const quote = dailySnapshotMap.get(candidate.code);
  if (!quote) continue;
  const amountRatio = candidate.amountEst / Math.max(candidate.avg5Amount || 1, 1);
  const turnoverQuality =
    1 - Math.min(1, Math.abs(candidate.turnoverEst - 12) / 24);
  const sectorHeat =
    Math.min(1, candidate.sectorStrongCount / 5) * 0.55 +
    Math.min(1, candidate.sectorLimitCount / 3) * 0.45;
  const baseSignal =
    (candidate.modelScore - candidate.riskPenalty) * 0.53 +
    candidate.closePos * 0.2 +
    Math.max(0, Math.min(1, (candidate.dayRet + 0.03) / 0.13)) * 0.15 +
    Math.max(0, Math.min(1, amountRatio / 0.18)) * 0.15 +
    turnoverQuality * 0.05 +
    sectorHeat * 0.04;
  const mapped = scoreCandidateWithMaps(
    candidate,
    {
      ...quote,
      amount: candidate.amountEst,
      turnover: candidate.turnoverEst
    },
    reviewMaps,
    baseSignal
  );
  candidate.reviewScore = mapped.reviewScore;
  candidate.mapScores = mapped.mapScores;
  candidate.reviewTags = mapped.reviewTags;
}

const reviewed = [...all.slice(0, 30)].sort(
  (a, b) => (b.reviewScore ?? b.compositeScore) - (a.reviewScore ?? a.compositeScore)
);
reviewed.forEach((candidate, index) => {
  candidate.rank = index + 1;
});
const top = reviewed.slice(0, 6);
const recommendation = top[0];
const sourceMetrics = source.metrics;
const validation = source.k_sensitivity.k3.validation;
const baseRate = source.validation_universe_base_rate;

const strategy = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  asOf: source.as_of,
  nextTradingDate:
    process.env.NEXT_TRADE_DATE ?? nextWeekday(source.as_of),
  source:
    "Sina 全市场快照、Tencent 日线/分钟线、Eastmoney 公告；模型窗口 2026-10-09 至 2026-11-06",
  recommendation,
  candidates: top,
  reviewUniverse: reviewed,
  rawModelLeader: all.find((item) => item.modelRank === 1),
  reviewMaps,
  model: {
    weights: source.weights,
    trainEnd: source.train_end,
    validationStart: source.validation_start,
    train: sourceMetrics.optimized_train,
    validation: sourceMetrics.optimized_validation,
    top3Validation: validation,
    baselineValidation: sourceMetrics.baseline_validation,
    baseRate
  },
  market: {
    indices: [
      { name: "上证指数", value: 3649.1774, changePct: -0.011 },
      { name: "深证成指", value: 11175.78, changePct: -0.0257 },
      { name: "创业板指", value: 2465.23, changePct: -0.0396 }
    ],
    breadthNote: "周五全市场仅112只高开，属于极端弱开盘环境"
  },
  riskPolicy: {
    maxRet5: 0.45,
    maxRet10: 0.5,
    maxTurnover: 30,
    riskPenalties: { high: 0.08, medium: 0.04, low: 0.01 }
  },
  disclaimer:
    "仅供盘前研究与交易辅助，不构成投资建议。集合竞价可能诱多，必须等待9:25价格与成交额、9:35承接共同确认。"
};

await fs.writeFile(outputPath, JSON.stringify(strategy, null, 2));
await fs.writeFile(publicOutputPath, JSON.stringify(strategy, null, 2));
console.log(
  `wrote ${outputPath} and ${publicOutputPath}: ${top.length} review picks ` +
    `from ${reviewed.length} candidates, ` +
    `recommendation=${recommendation.code} ${recommendation.name}`
);
