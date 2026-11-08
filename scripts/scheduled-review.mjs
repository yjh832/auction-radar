import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STRATEGY_PATH = path.join(ROOT, "data", "strategy.json");
const PUBLIC_PATH = path.join(ROOT, "public", "strategy.json");
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Referer: "https://finance.sina.com.cn/"
};

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

async function fetchText(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return new TextDecoder("gbk").decode(await response.arrayBuffer());
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

const strategy = JSON.parse(await fs.readFile(STRATEGY_PATH, "utf8"));
const stocks = await fetchAllStocks();
const date = chinaToday();
const universe = strategy.reviewUniverse ?? strategy.candidates;
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
      ...(candidate.history ?? []).slice(-19),
      { date, close: current }
    ];
    const ret5 =
      history.length >= 5
        ? current / history[Math.max(0, history.length - 5)].close - 1
        : candidate.ret5;
    const sectorHeat =
      clamp(candidate.sectorStrongCount / 5, 0, 1) * 0.55 +
      clamp(candidate.sectorLimitCount / 3, 0, 1) * 0.45;
    const reviewScore =
      candidate.compositeScore * 0.35 +
      closePosition * 0.2 +
      clamp((dayReturn + 0.03) / 0.13, 0, 1) * 0.15 +
      clamp(amountRatio / 0.18, 0, 1) * 0.15 +
      turnoverQuality * 0.1 +
      sectorHeat * 0.05 -
      candidate.riskPenalty * 0.25;
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
      history,
      closePos: closePosition,
      nearHigh20: high ? current / high : candidate.nearHigh20,
      reviewScore,
      compositeScore: reviewScore,
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
picks.forEach((candidate, index) => {
  candidate.rank = index + 1;
});

strategy.generatedAt = new Date().toISOString();
strategy.asOf = date;
strategy.nextTradingDate = nextWeekday(date);
strategy.reviewUniverse = reviewed;
strategy.candidates = picks;
strategy.recommendation = picks[0];
strategy.market.indices = await fetchIndices();
strategy.market.breadthNote = `收盘快照：${stocks.size}只股票，其中${afterCloseCount}只上涨`;

const serialized = JSON.stringify(strategy, null, 2);
await fs.writeFile(STRATEGY_PATH, serialized);
await fs.writeFile(PUBLIC_PATH, serialized);
console.log(
  `Daily review ${date}: ${picks.length} picks, top=${picks[0]?.code} ${picks[0]?.name}`
);
