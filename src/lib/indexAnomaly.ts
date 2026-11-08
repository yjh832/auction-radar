import type {
  HoldingAnomalyRisk,
  HoldingBenchmark,
  HistoryPoint,
  StockQuoteDetail
} from "../types";

const TEN_DAY_TARGET = 1;
const THIRTY_DAY_TARGET = 2;

function quoteSessionDate(quote: StockQuoteDetail) {
  const compact = quote.updatedAt.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function withCurrentSession(
  history: HistoryPoint[],
  quote: StockQuoteDetail
): HistoryPoint[] {
  const clean = history
    .filter((item) => item.date && Number(item.close) > 0)
    .map((item) => ({ date: item.date, close: Number(item.close) }));
  if (!Number.isFinite(quote.price) || quote.price <= 0) return clean;
  const sessionDate = quoteSessionDate(quote);
  const last = clean.at(-1);
  if (last?.date === sessionDate) {
    return [...clean.slice(0, -1), { date: sessionDate, close: quote.price }];
  }
  if (!last || last.date < sessionDate) {
    return [...clean, { date: sessionDate, close: quote.price }];
  }
  return clean;
}

interface AlignedDeviation {
  date: string;
  deviation: number;
  stockReturn: number;
  benchmarkReturn: number;
  stockPreClose: number;
  benchmarkPreClose: number;
}

function alignDailyDeviations(
  stockHistory: HistoryPoint[],
  stockQuote: StockQuoteDetail,
  benchmarkHistory: HistoryPoint[],
  benchmarkQuote: StockQuoteDetail
): AlignedDeviation[] {
  const stock = withCurrentSession(stockHistory, stockQuote);
  const benchmark = withCurrentSession(benchmarkHistory, benchmarkQuote);
  const benchmarkMap = new Map(benchmark.map((item) => [item.date, item.close]));
  const shared = stock.filter((item) => benchmarkMap.has(item.date));
  const rows: AlignedDeviation[] = [];
  for (let index = 1; index < shared.length; index += 1) {
    const previous = shared[index - 1];
    const current = shared[index];
    const benchmarkPrevious = benchmarkMap.get(previous.date);
    const benchmarkCurrent = benchmarkMap.get(current.date);
    if (
      !benchmarkPrevious ||
      !benchmarkCurrent ||
      previous.close <= 0 ||
      benchmarkPrevious <= 0
    ) {
      continue;
    }
    const stockReturn = current.close / previous.close - 1;
    const benchmarkReturn = benchmarkCurrent / benchmarkPrevious - 1;
    rows.push({
      date: current.date,
      deviation: stockReturn - benchmarkReturn,
      stockReturn,
      benchmarkReturn,
      stockPreClose: previous.close,
      benchmarkPreClose: benchmarkPrevious
    });
  }
  return rows;
}

function sumTail(rows: AlignedDeviation[], count: number) {
  if (rows.length < count) return null;
  return rows.slice(-count).reduce((sum, row) => sum + row.deviation, 0);
}

function redLinePrice(
  latest: AlignedDeviation | undefined,
  previousDeviations: number,
  target: number
) {
  if (!latest || latest.stockPreClose <= 0) return null;
  const allowedStockReturn =
    target - previousDeviations + latest.benchmarkReturn;
  return latest.stockPreClose * (1 + allowedStockReturn);
}

function pctPoints(value: number | null) {
  return value == null ? "—" : `${(value * 100).toFixed(2)}%`;
}

export function buildHoldingAnomalyRisk(
  stockQuote: StockQuoteDetail,
  stockHistory: HistoryPoint[],
  benchmark: HoldingBenchmark | null | undefined
): HoldingAnomalyRisk | null {
  if (!benchmark?.history.length) return null;
  const rows = alignDailyDeviations(
    stockHistory,
    stockQuote,
    benchmark.history,
    benchmark.quote
  );
  if (!rows.length) return null;

  const latest = rows.at(-1);
  const tenWindow = rows.slice(-10);
  const thirtyWindow = rows.slice(-30);
  const tenDayDeviation = sumTail(rows, 10);
  const thirtyDayDeviation = sumTail(rows, 30);
  const tenDayRemaining =
    tenDayDeviation == null ? null : TEN_DAY_TARGET - tenDayDeviation;
  const thirtyDayRemaining =
    thirtyDayDeviation == null ? null : THIRTY_DAY_TARGET - thirtyDayDeviation;
  const tenDayRedLinePrice =
    tenWindow.length >= 10 && latest
      ? redLinePrice(
          latest,
          tenWindow.slice(0, -1).reduce((sum, row) => sum + row.deviation, 0),
          TEN_DAY_TARGET
        )
      : null;
  const thirtyDayRedLinePrice =
    thirtyWindow.length >= 30 && latest
      ? redLinePrice(
          latest,
          thirtyWindow
            .slice(0, -1)
            .reduce((sum, row) => sum + row.deviation, 0),
          THIRTY_DAY_TARGET
        )
      : null;
  const recentNineDeviation =
    tenWindow.length >= 10
      ? tenWindow.slice(1).reduce((sum, row) => sum + row.deviation, 0)
      : null;
  const nextDayTenDayRedLinePrice =
    recentNineDeviation == null
      ? null
      : stockQuote.price * (1 + TEN_DAY_TARGET - recentNineDeviation);

  const breached =
    (tenDayDeviation != null && tenDayDeviation >= TEN_DAY_TARGET) ||
    (thirtyDayDeviation != null &&
      thirtyDayDeviation >= THIRTY_DAY_TARGET);
  const near =
    !breached &&
    ((tenDayRemaining != null && tenDayRemaining <= 0.1) ||
      (thirtyDayRemaining != null && thirtyDayRemaining <= 0.2));
  const watch =
    !breached &&
    !near &&
    ((tenDayRemaining != null && tenDayRemaining <= 0.25) ||
      (thirtyDayRemaining != null && thirtyDayRemaining <= 0.5));
  const status = breached ? "breached" : near ? "near" : watch ? "watch" : "clear";
  const benchmarkLabel = benchmark.name;
  const tenDayClose =
    tenDayRemaining != null && tenDayRemaining <= 0.1;
  const label = breached
    ? "10日/30日偏离红线已触发"
    : near
      ? tenDayClose
        ? "接近10日100%偏离红线"
        : "接近30日200%偏离红线"
      : watch
        ? "异动偏离进入观察区"
        : "距异动红线尚远";
  const action = breached
    ? `相对${benchmarkLabel}的累计偏离值已达到监管预警阈值。若封单减弱、炸板或跌破分时均价，优先分批减仓，不把“卡异动”当作继续持有的理由。`
    : near
      ? tenDayClose
        ? `相对${benchmarkLabel}的10日偏离仅剩${pctPoints(tenDayRemaining)}到100%红线。尾盘不能维持强势或出现冲高回落时，优先减仓并设置跌破分时均价的退出条件，防止异动失败后次日补跌。`
        : `相对${benchmarkLabel}的30日偏离仅剩${pctPoints(thirtyDayRemaining)}到200%红线。继续上涨可能触发更高级别异动，冲高回落或跌破分时均价时优先减仓。`
      : watch
        ? `相对${benchmarkLabel}的10日偏离距100%红线还有${pctPoints(tenDayRemaining)}。保留持有观察，但不追高，临近红线时提前降低仓位。`
        : `相对${benchmarkLabel}的10日偏离距100%红线还有${pctPoints(tenDayRemaining)}，暂未触发异动风险信号。`;

  return {
    benchmarkCode: benchmark.code,
    benchmarkName: benchmark.name,
    tenDayDeviation,
    thirtyDayDeviation,
    currentDayDeviation: latest?.deviation ?? null,
    tenDayRemaining,
    thirtyDayRemaining,
    tenDayRedLinePrice,
    thirtyDayRedLinePrice,
    nextDayTenDayRedLinePrice,
    status,
    label,
    action
  };
}
