import type {
  Candidate,
  CandidateAnomaly,
  DailyBar,
  StockInsight,
  StockNewsItem,
  StockNewsTone,
  StockQuoteDetail,
  StockSearchResult
} from "../types";
import { fetchHoldingQuotes } from "./market";

let suggestionQueue: Promise<unknown> = Promise.resolve();

function loadGlobalScript(
  url: string,
  globalName: string,
  charset = "utf-8"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = window as typeof window & Record<string, unknown>;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("股票搜索超时"));
    }, 8_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.remove();
    };
    try {
      delete target[globalName];
    } catch {
      target[globalName] = undefined;
    }
    script.charset = charset;
    script.async = true;
    script.src = url;
    script.onload = () => {
      const value = target[globalName];
      cleanup();
      resolve(typeof value === "string" ? value : "");
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("股票搜索服务暂不可用"));
    };
    document.head.appendChild(script);
  });
}

function isAShare(code: string, symbol: string) {
  if (!/^\d{6}$/.test(code)) return false;
  if (symbol.startsWith("sh")) return /^(60|68)\d{4}$/.test(code);
  if (symbol.startsWith("sz")) return /^(00|30)\d{4}$/.test(code);
  if (symbol.startsWith("bj")) return /^(4|8)\d{5}$/.test(code);
  return false;
}

function marketName(symbol: string) {
  if (symbol.startsWith("sh")) return "沪A";
  if (symbol.startsWith("sz")) return "深A";
  return "北A";
}

async function searchSinaStocks(query: string): Promise<StockSearchResult[]> {
  const task = suggestionQueue.then(() =>
    loadGlobalScript(
      "https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&key=" +
        `${encodeURIComponent(query)}&_=${Date.now()}`,
      "suggestvalue",
      "gbk"
    )
  );
  suggestionQueue = task.catch(() => "");
  const raw = await task;
  if (!raw || raw === "N") return [];
  return raw
    .split(";")
    .flatMap((entry) => {
      const fields = entry.split(",");
      const name = String(fields[4] || fields[0] || "").trim();
      const code = String(fields[2] ?? "").trim();
      const symbol = String(fields[3] ?? "").trim();
      const pinyin = String(fields[5] ?? fields[4] ?? "").trim();
      if (!name || !isAShare(code, symbol)) return [];
      return [{ code, name, symbol, market: marketName(symbol), pinyin }];
    })
    .filter(
      (item, index, list) =>
        list.findIndex((other) => other.code === item.code) === index
    )
    .slice(0, 8);
}

export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const results = await searchSinaStocks(normalized);
  if (results.length || !/^\d{6}$/.test(normalized)) return results;
  try {
    const quotes = await fetchHoldingQuotes([normalized]);
    const quote = quotes.get(normalized);
    if (!quote) return [];
    return [{
      code: normalized,
      name: quote.name,
      symbol: quote.symbol,
      market: marketName(quote.symbol),
      pinyin: ""
    }];
  } catch {
    return [];
  }
}

interface NewsSearchPayload {
  result?: {
    cmsArticleWebOld?: Array<{
      date?: string;
      title?: string;
      content?: string;
      mediaName?: string;
      url?: string;
      code?: string;
    }>;
  };
}

interface AnnouncementPayload {
  data?: {
    list?: Array<{
      art_code?: string;
      display_time?: string;
      notice_date?: string;
      title?: string;
      title_ch?: string;
      columns?: Array<{ column_name?: string }>;
    }>;
  };
}

function loadJsonp<T>(url: string, callbackName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const target = window as typeof window & Record<string, unknown>;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("资讯加载超时"));
    }, 10_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.remove();
      try {
        delete target[callbackName];
      } catch {
        target[callbackName] = undefined;
      }
    };
    target[callbackName] = (payload: T) => {
      cleanup();
      resolve(payload);
    };
    script.async = true;
    script.src = url;
    script.onerror = () => {
      cleanup();
      reject(new Error("资讯服务暂不可用"));
    };
    document.head.appendChild(script);
  });
}

function stripMarkup(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const positiveKeywords = [
  "回购",
  "增持",
  "净买入",
  "中标",
  "预增",
  "扭亏",
  "签订",
  "合同",
  "获批",
  "注册",
  "专利",
  "分红",
  "派息",
  "股权激励",
  "员工持股",
  "战略合作",
  "收购",
  "重大资产",
  "产能",
  "投产",
  "业绩增长",
  "同比增长",
  "涨停",
  "上涨"
];

const riskKeywords = [
  "减持",
  "亏损",
  "预亏",
  "终止",
  "诉讼",
  "立案",
  "问询",
  "风险提示",
  "异常波动",
  "同比下降",
  "下滑",
  "质押",
  "退市",
  "处罚",
  "担保"
];

function classifyNews(text: string): { tone: StockNewsTone; tags: string[] } {
  const tags = positiveKeywords.filter((keyword) => text.includes(keyword));
  const risks = riskKeywords.filter((keyword) => text.includes(keyword));
  if (risks.length && risks.length >= tags.length) {
    return { tone: "risk", tags: risks.slice(0, 3) };
  }
  if (tags.length) return { tone: "positive", tags: tags.slice(0, 3) };
  return { tone: "neutral", tags: [] };
}

async function fetchCompanyArticles(
  code: string,
  name: string
): Promise<StockNewsItem[]> {
  const callback = `__auctionRadarNews_${Date.now()}_${Math.floor(
    Math.random() * 10_000
  )}`;
  const param = {
    uid: "",
    keyword: name,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientType: "web",
    clientVersion: "curr",
    param: {
      cmsArticleWebOld: {
        searchScope: "default",
        sort: "time",
        pageIndex: 1,
        pageSize: 12
      }
    }
  };
  const payload = await loadJsonp<NewsSearchPayload>(
    "https://search-api-web.eastmoney.com/search/jsonp?" +
      `cb=${encodeURIComponent(callback)}` +
      `&param=${encodeURIComponent(JSON.stringify(param))}`,
    callback
  );
  return (payload.result?.cmsArticleWebOld ?? []).flatMap((item, index) => {
    const title = stripMarkup(String(item.title ?? ""));
    if (!title) return [];
    const summary = stripMarkup(String(item.content ?? "")).slice(0, 180);
    const tone = classifyNews(`${title} ${summary}`);
    return [{
      id: `news-${code}-${item.code ?? index}`,
      date: String(item.date ?? "").slice(0, 16),
      title,
      summary,
      source: String(item.mediaName ?? "东方财富资讯"),
      url: String(item.url ?? "").replace(/^http:\/\//, "https://"),
      kind: "news" as const,
      ...tone
    }];
  });
}

async function fetchCompanyAnnouncements(code: string): Promise<StockNewsItem[]> {
  const params = new URLSearchParams({
    sr: "-1",
    page_size: "16",
    page_index: "1",
    ann_type: "A",
    client_source: "web",
    stock_list: code
  });
  const response = await fetch(
    `https://np-anotice-stock.eastmoney.com/api/security/ann?${params}`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error("公司公告加载失败");
  const payload = (await response.json()) as AnnouncementPayload;
  return (payload.data?.list ?? []).flatMap((item, index) => {
    const title = stripMarkup(
      String(item.title_ch ?? item.title ?? "").replace(/^[^:：]+[:：]/, "")
    );
    if (!title) return [];
    const tags = (item.columns ?? [])
      .map((column) => String(column.column_name ?? ""))
      .filter(Boolean);
    const tone = classifyNews(`${title} ${tags.join(" ")}`);
    return [{
      id: `announcement-${code}-${item.art_code ?? index}`,
      date: String(item.display_time ?? item.notice_date ?? "").slice(0, 16),
      title,
      summary: tags.length ? `公告分类：${tags.join("、")}` : "公司最新公告",
      source: "公司公告",
      url: item.art_code
        ? `https://data.eastmoney.com/notices/detail/${code}/${item.art_code}.html`
        : "",
      kind: "announcement" as const,
      tone: tone.tone,
      tags: tags.length ? tags.slice(0, 3) : tone.tags
    }];
  });
}

export async function fetchStockNews(
  code: string,
  name: string
): Promise<StockNewsItem[]> {
  const [articles, announcements] = await Promise.allSettled([
    fetchCompanyArticles(code, name),
    fetchCompanyAnnouncements(code)
  ]);
  const items = [
    ...(articles.status === "fulfilled" ? articles.value : []),
    ...(announcements.status === "fulfilled" ? announcements.value : [])
  ];
  const unique = new Map<string, StockNewsItem>();
  for (const item of items) {
    unique.set(`${item.title}-${item.date.slice(0, 10)}`, item);
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        Number(b.tone === "positive") * 2 +
          Number(b.kind === "announcement") * 0.5 -
          Number(a.tone === "positive") * 2 -
          Number(a.kind === "announcement") * 0.5 ||
        b.date.localeCompare(a.date)
    )
    .slice(0, 8);
}

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function buildStockInsight({
  candidate,
  quote,
  bars,
  anomaly,
  news
}: {
  candidate: Candidate;
  quote: StockQuoteDetail;
  bars: DailyBar[];
  anomaly?: CandidateAnomaly | null;
  news: StockNewsItem[];
}): StockInsight {
  const closes = bars.map((bar) => bar.close).filter((value) => value > 0);
  const ret5 = closes.length >= 6 ? quote.price / closes.at(-6)! - 1 : candidate.ret5;
  const ret10 =
    closes.length >= 11 ? quote.price / closes.at(-11)! - 1 : candidate.ret10;
  const ret30 =
    closes.length >= 31 ? quote.price / closes.at(-31)! - 1 : candidate.ret30 ?? 0;
  const ma5 = closes.length
    ? closes.slice(-5).reduce((sum, value) => sum + value, 0) /
      Math.min(5, closes.length)
    : quote.price;
  const closePosition =
    quote.high > quote.low
      ? (quote.price - quote.low) / (quote.high - quote.low)
      : 0.5;
  const positiveNews = news.filter((item) => item.tone === "positive").length;
  const riskNews = news.filter((item) => item.tone === "risk").length;
  let score = 52;
  const positives: string[] = [];
  const risks: string[] = [];

  if (ret5 > 0) {
    score += 7;
    positives.push(`5日走势${pct(ret5)}，短线动量仍在`);
  } else {
    score -= 4;
    risks.push(`5日走势${pct(ret5)}，短线动量不足`);
  }
  if (ret10 > 0.08) {
    score += 8;
    positives.push(`10日${pct(ret10)}，资金持续推动`);
  } else if (ret10 < 0) {
    score -= 5;
    risks.push(`10日${pct(ret10)}，中期结构尚未修复`);
  }
  if (ret30 > 0.15) {
    score += 5;
    positives.push(`30日${pct(ret30)}，仍处于上升波段`);
  }
  if (quote.price >= ma5) {
    score += 5;
    positives.push(`现价站上5日均线${ma5.toFixed(2)}`);
  } else {
    score -= 6;
    risks.push(`现价低于5日均线${ma5.toFixed(2)}`);
  }
  if (closePosition >= 0.72) {
    score += 6;
    positives.push(`收在日内高位，收盘位置${pct(closePosition)}`);
  } else if (closePosition <= 0.35) {
    score -= 7;
    risks.push(`收在日内低位，冲高承接偏弱`);
  }
  if (quote.volumeRatio >= 1.15) {
    score += 4;
    positives.push(`量比${quote.volumeRatio.toFixed(2)}，成交活跃`);
  }
  if (positiveNews) {
    score += Math.min(10, positiveNews * 3);
    positives.push(`自动识别到${positiveNews}条利好线索，需核对原文`);
  }
  if (riskNews) {
    score -= Math.min(12, riskNews * 4);
    risks.push(`识别到${riskNews}条风险或走弱信息`);
  }
  if (anomaly?.method === "index_deviation") {
    if (anomaly.tenDayRemaining != null && anomaly.tenDayRemaining <= 0.1) {
      score -= 13;
      risks.push(`距10日100%偏离红线仅${pct(anomaly.tenDayRemaining)}`);
    } else if (anomaly.tenDayRemaining != null && anomaly.tenDayRemaining <= 0.25) {
      score -= 5;
      risks.push(`10日异动偏离进入观察区`);
    }
  } else if (anomaly?.regulatoryStatus === "abnormal") {
    score -= 9;
    risks.push(`短线价格波动已进入异动提示区`);
  }
  const latestLhb = candidate.riskNotes.find((note) => note.includes("龙虎榜"));
  if (latestLhb) positives.push(latestLhb);
  if (candidate.mapScores) {
    score += (candidate.mapScores.total - 0.5) * 18;
    positives.push(
      `三图模型综合适配度${Math.round(candidate.mapScores.total * 100)}`
    );
  }
  if (!risks.length) risks.push("未识别到明确负面公告，仍需防范板块退潮与指数走弱");
  score = Math.round(clamp(score, 0, 100));

  const stance: StockInsight["stance"] =
    score >= 78 ? "强势" : score >= 64 ? "偏强" : score >= 45 ? "观察" : "谨慎";
  const title =
    anomaly?.tenDayRemaining != null && anomaly.tenDayRemaining <= 0.1
      ? "价格仍强，但异动红线已进入交易纪律区"
      : positiveNews && ret5 > 0
        ? "事件线索与量价结构形成共振"
        : ret5 > 0 && closePosition > 0.7
          ? "短线趋势偏强，等待承接确认"
          : "信号分歧，优先等待价格确认";
  const summary =
    `${candidate.name}当前${stance}倾向：5日${pct(ret5)}、10日${pct(ret10)}，` +
    `量比${quote.volumeRatio.toFixed(2)}，收盘位置${pct(closePosition)}。` +
    (positiveNews
      ? `资讯侧有${positiveNews}条利好关键词线索，但不能替代公告原文核验。`
      : "目前未识别到足够明确的正向事件催化。");
  const action =
    score >= 64
      ? "已有仓位可按开盘价、分时均价和5日均线分层管理；空仓不追一致高开，等待回踩不破后再确认。"
      : score >= 45
        ? "以观察为主，只有放量站上分时均价且板块同步转强时才提高关注度。"
        : "优先控制风险，弱开、跌破分时均价或放量回落时不急于抄底。";

  return {
    score,
    stance,
    title,
    summary,
    positives: positives.slice(0, 5),
    risks: risks.slice(0, 4),
    action
  };
}
