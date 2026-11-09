import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "public", "index-kline", "100.KS11.json");
const SYMBOL = "100.KS11";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/142 Safari/537.36",
  Referer: "https://quote.eastmoney.com/"
};

function number(value) {
  const parsed = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchEastmoneyBars() {
  const params = new URLSearchParams({
    secid: SYMBOL,
    klt: "101",
    fqt: "0",
    lmt: "65",
    end: "20500101",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
  });
  const response = await fetch(
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
    { headers: HEADERS, signal: AbortSignal.timeout(15_000) }
  );
  if (!response.ok) throw new Error(`Eastmoney HTTP ${response.status}`);
  const payload = await response.json();
  const bars = (payload?.data?.klines ?? []).flatMap((line) => {
    const values = String(line).split(",");
    const bar = {
      date: values[0],
      open: number(values[1]),
      close: number(values[2]),
      high: number(values[3]),
      low: number(values[4]),
      volume: number(values[5])
    };
    return bar.date && bar.open > 0 && bar.close > 0 ? [bar] : [];
  });
  if (bars.length < 30) throw new Error("Eastmoney returned too few bars");
  return bars;
}

async function fetchNaverBars() {
  const rows = [];
  for (let page = 1; page <= 4; page += 1) {
    const response = await fetch(
      `https://m.stock.naver.com/api/index/KOSPI/price?periodType=day&count=20&page=${page}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
        },
        signal: AbortSignal.timeout(15_000)
      }
    );
    if (!response.ok) throw new Error(`Naver HTTP ${response.status}`);
    const pageRows = await response.json();
    if (!Array.isArray(pageRows) || !pageRows.length) break;
    rows.push(...pageRows);
  }
  const byDate = new Map(
    rows.map((row) => [
      String(row.localTradedAt ?? ""),
      {
        date: String(row.localTradedAt ?? ""),
        open: number(row.openPrice),
        close: number(row.closePrice),
        high: number(row.highPrice),
        low: number(row.lowPrice),
        volume: 0
      }
    ])
  );
  const bars = [...byDate.values()]
    .filter((bar) => bar.date && bar.open > 0 && bar.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (bars.length < 30) throw new Error("Naver returned too few bars");
  return bars;
}

let source = "eastmoney";
let bars;
try {
  bars = await fetchEastmoneyBars();
} catch (eastmoneyError) {
  console.warn(`Eastmoney unavailable: ${eastmoneyError.message}`);
  source = "naver";
  bars = await fetchNaverBars();
}

bars = bars.slice(-65);
await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(
  OUTPUT,
  `${JSON.stringify(
    {
      symbol: SYMBOL,
      name: "韩国KOSPI",
      source,
      updatedAt: new Date().toISOString(),
      bars
    },
    null,
    2
  )}\n`,
  "utf8"
);
console.log(
  `Saved ${bars.length} KOSPI bars through ${bars.at(-1)?.date} (${source}) to ${OUTPUT}`
);
