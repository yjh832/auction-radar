import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildReviewMaps,
  buildAnomalyProfile,
  fetchLhbStocks,
  fetchLimitPools,
  scoreCandidateWithMaps
} from "./review-model.mjs";
import {
  adaptModelWeights,
  weightedFactorScore
} from "./adaptive-model.mjs";
import {
  filterMainBoard,
  isMainBoardCode
} from "./main-board.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STRATEGY_PATH = path.join(ROOT, "data", "strategy.json");
const PUBLIC_PATH = path.join(ROOT, "public", "strategy.json");
const DRY_RUN = process.env.DRY_RUN === "1";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Referer: "https://finance.sina.com.cn/"
};
const US_SECTOR_ETFS = [
  ["usXLK", "科技", ["电子", "计算机", "通信", "传媒", "半导体", "软件"]],
  ["usXLF", "金融", ["银行", "证券", "保险", "多元金融"]],
  ["usXLE", "能源", ["石油", "煤炭", "能源", "电力"]],
  ["usXLV", "医疗", ["医药", "医疗", "生物", "中药"]],
  ["usXLI", "工业", ["机械", "军工", "电力设备", "自动化", "工程", "运输"]],
  ["usXLY", "可选消费", ["汽车", "家电", "商贸零售", "旅游", "酒店"]],
  ["usXLP", "必选消费", ["食品", "饮料", "酿酒", "农林牧渔"]],
  ["usXLU", "公用事业", ["电力", "燃气", "水务", "公用事业"]],
  ["usXLB", "材料", ["有色", "钢铁", "化工", "建材", "材料"]],
  ["usXLRE", "房地产", ["房地产", "地产"]],
  ["usXLC", "通信服务", ["传媒", "通信", "游戏", "广告"]]
];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function boardLimit(code) {
  return code.startsWith("300") ||
    code.startsWith("301") ||
    code.startsWith("688") ||
    code.startsWith("689")
    ? 0.2
    : 0.1;
}

function chinaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
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

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return new TextDecoder("gbk").decode(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      }
    }
  }
  throw lastError;
}

async function fetchPage(page) {
  const url = new URL(
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("num", "100");
  url.searchParams.set("sort", "symbol");
  url.searchParams.set("asc", "1");
  url.searchParams.set("node", "hs_a");
  url.searchParams.set("symbol", "");
  url.searchParams.set("_s_r_a", "page");
  return JSON.parse(await fetchText(url));
}

async function fetchAllStocks() {
  const stocks = [];
  let page = 1;
  while (true) {
    const rows = await fetchPage(page);
    if (!Array.isArray(rows) || rows.length === 0) break;
    stocks.push(...rows);
    if (rows.length < 100) break;
    page += 1;
  }
  return new Map(stocks.map((stock) => [String(stock.code), stock]));
}

async function fetchIndices() {
  const text = await fetchText(
    "https://hq.sinajs.cn/list=s_sh000001,s_sz399001,s_sz399006"
  );
  const names = {
    s_sh000001: "上证指数",
    s_sz399001: "深证成指",
    s_sz399006: "创业板指"
  };
  return [...text.matchAll(/hq_str_(s_(?:sh|sz)\d+)="([^"]*)"/g)].map(
    (match) => {
      const fields = match[2].split(",");
      return {
        name: names[match[1]],
        value: number(fields[1]),
        changePct: number(fields[3]) / 100
      };
    }
  );
}

async function fetchUSSectorPulses() {
  const text = await fetchText(
    `https://qt.gtimg.cn/q=${US_SECTOR_ETFS.map(([symbol]) => symbol).join(",")}`
  );
  const sectors = [...text.matchAll(/v_(us[A-Z]+)="([^"]*)"/g)].flatMap(
    (match) => {
      const definition = US_SECTOR_ETFS.find(([symbol]) => symbol === match[1]);
      const fields = match[2].split("~");
      if (!definition || fields.length < 35) return [];
      return [{
        symbol: definition[0],
        name: definition[1],
        mappedSectors: definition[2],
        changePct: number(fields[32])
      }];
    }
  ).sort((a, b) => b.changePct - a.changePct);
  return sectors;
}

function usSectorForIndustry(industry, sectors) {
  return sectors.find((sector) =>
    sector.mappedSectors.some(
      (keyword) => industry.includes(keyword) || keyword.includes(industry)
    )
  );
}

const strategy = JSON.parse(await fs.readFile(STRATEGY_PATH, "utf8"));
const adaptationSource = process.env.PREVIOUS_STRATEGY_REF
  ? JSON.parse(
      execFileSync(
        "git",
        ["show", process.env.PREVIOUS_STRATEGY_REF],
        { cwd: ROOT, encoding: "utf8" }
      )
    )
  : strategy;
const stocks = await fetchAllStocks();
const date = process.env.REVIEW_DATE || chinaToday();
const universe = filterMainBoard(
  strategy.reviewUniverse ?? strategy.candidates
);
const snapshot = [...stocks.values()].map((stock) => ({
  code: String(stock.code),
  name: String(stock.name),
  open: number(stock.open),
  preClose: number(stock.settlement),
  current: number(stock.trade),
  high: number(stock.high),
  low: number(stock.low),
  volume: number(stock.volume),
  amount: number(stock.amount),
  turnover: number(stock.turnoverratio)
}));
const quoteMap = new Map(snapshot.map((stock) => [stock.code, stock]));
const adaptationResult = adaptModelWeights({
  previousCandidates: filterMainBoard(adaptationSource.candidates ?? []),
  quotes: quoteMap,
  previousWeights: adaptationSource.model?.weights,
  previousDate: adaptationSource.asOf,
  date,
  previousAdaptation:
    strategy.model?.adaptation ?? adaptationSource.model?.adaptation
});
const adaptiveWeights = adaptationResult.weights;
const [pools, lhbStocks, usSectors] = await Promise.all([
  fetchLimitPools(date),
  fetchLhbStocks(date),
  fetchUSSectorPulses().catch(() => [])
]);
if (pools?.date && pools.date !== date) {
  console.log(
    `No fresh close session for ${date}; market pools still show ${pools.date}. Skip review.`
  );
  process.exit(0);
}
const fallbackPreviousLimitUps = universe
  .filter(
    (candidate) => isMainBoardCode(candidate.code) && candidate.limitToday
  )
  .map((candidate) => ({
    code: candidate.code,
    name: candidate.name,
    sector: candidate.industry,
    streak: candidate.limitStreak,
    close: candidate.close
  }));
const reviewMaps = buildReviewMaps({
  snapshot,
  pools,
  lhbStocks,
  previousLimitUps:
    strategy.reviewMaps?.date === date
      ? strategy.reviewMaps.previousLimitUps
      : strategy.reviewMaps?.limitUps ?? fallbackPreviousLimitUps,
  previousDate: strategy.asOf,
  date
});
const afterCloseCount = [...stocks.values()].filter(
  (stock) => number(stock.trade) > number(stock.settlement)
).length;

const reviewed = universe
  .map((candidate) => {
    const quote = stocks.get(candidate.code);
    if (!quote) return null;
    const current = number(quote.trade);
    const preClose = number(quote.settlement);
    const open = number(quote.open);
    const high = number(quote.high);
    const low = number(quote.low);
    const amount = number(quote.amount);
    const turnover = number(quote.turnoverratio);
    const dayReturn = preClose ? current / preClose - 1 : 0;
    const gap = preClose ? open / preClose - 1 : 0;
    const closePosition =
      high > low ? (current - low) / (high - low) : 0.5;
    const amountRatio = amount / Math.max(candidate.avg5Amount || 1, 1);
    const turnoverQuality = 1 - Math.min(1, Math.abs(turnover - 12) / 24);
    const limit = boardLimit(candidate.code);
    const limitToday = current >= preClose * (1 + limit) - 0.011;
    const history = [
      ...(candidate.history ?? []).slice(-39),
      { date, close: current }
    ];
    const ret5 =
      history.length >= 5
        ? current / history[Math.max(0, history.length - 5)].close - 1
        : candidate.ret5;
    const ret30 =
      history.length >= 31
        ? current / history[history.length - 31].close - 1
        : candidate.ret30 ?? candidate.ret10;
    const anomaly = buildAnomalyProfile(
      candidate.code,
      history,
      candidate.riskNotes
    );
    const sectorHeat =
      clamp(candidate.sectorStrongCount / 5, 0, 1) * 0.55 +
      clamp(candidate.sectorLimitCount / 3, 0, 1) * 0.45;
    const factorSignal = weightedFactorScore(candidate, adaptiveWeights);
    const adaptiveModelScore =
      candidate.modelScore * 0.58 + factorSignal * 0.42;
    const baseSignal =
      (adaptiveModelScore - candidate.riskPenalty) * 0.53 +
      closePosition * 0.2 +
      clamp((dayReturn + 0.03) / 0.13, 0, 1) * 0.15 +
      clamp(amountRatio / 0.18, 0, 1) * 0.15 +
      turnoverQuality * 0.05 +
      sectorHeat * 0.04;
    const quoteSnapshot = quoteMap.get(candidate.code);
    const mapped = quoteSnapshot
      ? scoreCandidateWithMaps(candidate, quoteSnapshot, reviewMaps, baseSignal)
      : {
          reviewScore: 0,
          mapScores: undefined,
          reviewTags: ["行情缺失"]
        };
    const usSector = usSectorForIndustry(candidate.industry, usSectors);
    const usBoost = usSector
      ? clamp((usSector.changePct / 100) * 1.8, -0.06, 0.06)
      : 0;
    const usTag = usSector
      ? `美股${usSector.name}${usSector.changePct >= 0 ? "走强" : "走弱"} ${usSector.changePct.toFixed(2)}%`
      : null;
    return {
      ...candidate,
      close: current,
      dayRet: dayReturn,
      gap,
      limitToday,
      limit20: candidate.limit20 + (limitToday ? 1 : 0),
      limit60: candidate.limit60 + (limitToday ? 1 : 0),
      volRatio: amountRatio,
      turnoverEst: turnover,
      amountEst: amount,
      ret5,
      ret30,
      anomaly,
      history,
      closePos: closePosition,
      nearHigh20: high ? current / high : candidate.nearHigh20,
      reviewScore: clamp(mapped.reviewScore + usBoost, 0, 1),
      mapScores: mapped.mapScores,
      reviewTags: usTag
        ? [usTag, ...mapped.reviewTags].slice(0, 5)
        : mapped.reviewTags,
      compositeScore: mapped.reviewScore,
      reviewMetrics: {
        dayReturn,
        closePosition,
        amountRatio,
        turnover,
        current,
        amount
      }
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.reviewScore - a.reviewScore);

const picks = reviewed.slice(0, 6);
reviewed.forEach((candidate, index) => {
  candidate.rank = index + 1;
});

strategy.generatedAt = new Date().toISOString();
strategy.asOf = date;
strategy.nextTradingDate = nextWeekday(date);
strategy.reviewUniverse = reviewed;
strategy.candidates = picks;
strategy.recommendation = picks[0];
strategy.reviewMaps = reviewMaps;
strategy.globalReference = {
  usSectors,
  strongestUsSectors: usSectors.slice(0, 3),
  fetchedAt: new Date().toISOString()
};
strategy.model = {
  ...strategy.model,
  weights: adaptiveWeights,
  adaptation: adaptationResult.adaptation ?? strategy.model?.adaptation ?? null
};
strategy.market.indices = await fetchIndices();
strategy.market.breadthNote =
  `收盘快照：${stocks.size}只股票，其中${afterCloseCount}只上涨；` +
  `情绪${Math.round(reviewMaps.emotion.score * 100)} / ` +
  `资金${Math.round(reviewMaps.capital.score * 100)} / ` +
  `风险${Math.round(reviewMaps.risk.score * 100)}`;
strategy.source =
  "Sina 全市场快照、Eastmoney 涨停/炸板/跌停池、Tencent 日线/分钟线与龙虎榜；三图复盘模型";

const serialized = JSON.stringify(strategy, null, 2);
if (!DRY_RUN) {
  await fs.writeFile(STRATEGY_PATH, serialized);
  await fs.writeFile(PUBLIC_PATH, serialized);
}
console.log(
  `${DRY_RUN ? "Dry-run" : "Daily review"} ${date}: ${picks.length} picks, ` +
    `top=${picks[0]?.code} ${picks[0]?.name}, ` +
    `maps=${Math.round(reviewMaps.emotion.score * 100)}/` +
    `${Math.round(reviewMaps.capital.score * 100)}/` +
    `${Math.round(reviewMaps.risk.score * 100)}, ` +
    `adaptationSamples=${adaptationResult.samples.length}, ` +
    `weightsUpdated=${adaptationResult.updated ? "yes" : "no"}`
);
