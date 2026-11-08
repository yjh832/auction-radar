export type RiskLevel = "low" | "medium" | "high";

export interface HistoryPoint {
  date: string;
  close: number;
}

export interface LastAuction {
  price: number;
  amount: number;
  ratio: number;
  first5Ret: number;
}

export interface LiveQuote {
  open: number;
  preClose: number;
  current: number;
  gap: number;
  gapStrength: number;
  auctionAmount: number;
  auctionRatio: number;
  liveScore: number;
}

export interface LiveResult {
  recommendation: Candidate | null;
  noPickReason: string | null;
  candidates: Candidate[];
  fetchedAt: string;
  quoteCount: number;
  positiveOpenCount: number;
  mode: "auction" | "review" | "off_hours";
  marketStatus: {
    key: string;
    label: string;
    liveEligible: boolean;
    clock: {
      date: string;
      time: string;
      hour: number;
      minute: number;
      weekday: string;
      minutes: number;
    };
  };
}

export interface DailyBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  ma5: number | null;
  preClose: number;
}

export interface IntradayPoint {
  time: string;
  price: number;
  avgPrice: number;
  volume: number;
}

export interface IntradaySeries {
  date: string;
  preClose: number;
  open: number;
  close: number;
  high: number;
  low: number;
  amount: number;
  volume: number;
  points: IntradayPoint[];
}

export interface StockQuoteDetail {
  symbol: string;
  name: string;
  price: number;
  preClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volumeLots: number;
  amount: number;
  turnoverRate: number;
  amplitude: number;
  marketCap: number;
  floatCap: number;
  volumeRatio: number;
  updatedAt: string;
}

export interface DragonTigerRecord {
  date: string;
  reason: string;
  note: string;
  changePct: number;
  turnoverRate: number;
  buyAmount: number;
  sellAmount: number;
  netAmount: number;
  boardAmount: number;
  boardAmountRatio: number;
  after1d: number | null;
  after5d: number | null;
  changeType: string;
}

export type SeatStyle =
  | "hot_money"
  | "institution"
  | "northbound"
  | "quant"
  | "general";

export interface SeatRecord {
  name: string;
  side: "buy" | "sell";
  buyAmount: number;
  sellAmount: number;
  netAmount: number;
  activity3d: number;
  riseProbability3d: number | null;
  amountRatio: number | null;
  profile: {
    style: SeatStyle;
    label: string;
    habit: string;
    followBias: number;
  };
}

export interface DragonTigerSeatAnalysis {
  date: string;
  buyTotal: number;
  sellTotal: number;
  netAmount: number;
  netRatio: number;
  buyConcentration: number;
  seatScore: number;
  verdict: "跟随" | "谨慎跟随" | "观察" | "回避";
  nextDayAction: string;
  reasons: string[];
  risks: string[];
  buyers: SeatRecord[];
  sellers: SeatRecord[];
}

export interface StockDetailData {
  quote: StockQuoteDetail;
  kline: DailyBar[];
  dragonTiger: DragonTigerRecord[];
}

export interface Candidate {
  rank: number;
  modelRank: number;
  code: string;
  symbol: string;
  name: string;
  industry: string;
  modelScore: number;
  compositeScore: number;
  close: number;
  dayRet: number;
  gap: number;
  limit: number;
  limitToday: boolean;
  limit20: number;
  limit60: number;
  limitStreak: number;
  volRatio: number;
  ret5: number;
  ret10: number;
  closePos: number;
  nearHigh20: number;
  turnoverEst: number;
  amountEst: number;
  avg5Amount: number;
  sectorN: number;
  sectorLimitCount: number;
  sectorStrongCount: number;
  floatCap: number;
  riskLevel: RiskLevel;
  riskPenalty: number;
  riskNotes: string[];
  history: HistoryPoint[];
  lastAuction: LastAuction;
  liveEligible?: boolean;
  liveReason?: string;
  live?: LiveQuote;
  reviewScore?: number;
  reviewMetrics?: {
    dayReturn: number;
    closePosition: number;
    amountRatio: number;
    turnover: number;
    current: number;
    amount: number;
  } | null;
}

export interface ModelMetrics {
  n: number;
  days?: number;
  touch_rate: number;
  close_limit_rate: number;
  avg_next_open_to_close: number;
}

export interface StrategyDashboard {
  schemaVersion: number;
  generatedAt: string;
  asOf: string;
  nextTradingDate: string;
  source: string;
  recommendation: Candidate;
  candidates: Candidate[];
  reviewUniverse?: Candidate[];
  rawModelLeader: Candidate;
  model: {
    weights: Record<string, number>;
    trainEnd: string;
    validationStart: string;
    train: ModelMetrics;
    validation: ModelMetrics;
    top3Validation: ModelMetrics;
    baselineValidation: ModelMetrics;
    baseRate: {
      n: number;
      touch_rate: number;
      close_limit_rate: number;
    };
  };
  market: {
    indices: Array<{ name: string; value: number; changePct: number }>;
    breadthNote: string;
  };
  riskPolicy: {
    maxRet5: number;
    maxRet10: number;
    maxTurnover: number;
    riskPenalties: Record<RiskLevel, number>;
  };
  disclaimer: string;
  serverTime?: string;
  marketStatus?: {
    key: string;
    label: string;
    liveEligible: boolean;
    clock: {
      date: string;
      time: string;
      hour: number;
      minute: number;
      weekday: string;
      minutes: number;
    };
  };
  live?: LiveResult | null;
}
