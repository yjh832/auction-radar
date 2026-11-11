export type RiskLevel = "low" | "medium" | "high";

export interface HistoryPoint {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
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
  reviewMaps?: ReviewMaps;
  sectorPulses?: SectorAuctionPulse[];
  strongestSector?: SectorAuctionPulse | null;
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
  bid1Price?: number;
  bid1Lots?: number;
  updatedAt: string;
}

export interface HoldingPosition {
  id: string;
  code: string;
  name: string;
  cost: number;
  shares: number;
  stopLossPct: number;
  takeProfitPct: number;
  createdAt: string;
  updatedAt?: string;
}

export type HoldingTradeSide = "buy" | "sell";
export type HoldingTradeSource = "recommendation" | "manual";
export type HoldingTradeSaleKind = "t" | "clear";

export interface HoldingTradeRecord {
  id: string;
  code: string;
  name: string;
  side: HoldingTradeSide;
  price: number;
  shares: number;
  fee: number;
  tradeDate: string;
  source: HoldingTradeSource;
  saleKind?: HoldingTradeSaleKind;
  costBasis?: number;
  recommendationRank?: 1 | 2;
  recommendationDate?: string;
  note?: string;
  createdAt: string;
}

export interface CapitalFlowSettlement {
  tradeId: string;
  code: string;
  name: string;
  date: string;
  shares: number;
  proceeds: number;
  costBasis: number;
  pnl: number;
  pnlPct: number;
  matched: boolean;
  saleKind: HoldingTradeSaleKind;
  recommendationRank?: 1 | 2;
}

export interface CapitalFlowPoint {
  id: string;
  label: string;
  date: string;
  netInvested: number;
  realizedPnl: number;
  profit: number;
}

export interface CapitalFlowAnalysis {
  points: CapitalFlowPoint[];
  settlements: CapitalFlowSettlement[];
  totalBuyCost: number;
  totalSellNet: number;
  netInvested: number;
  openCost: number;
  openMarketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  returnPct: number;
  tTradePnl: number;
  tTradeCount: number;
  clearPnl: number;
  clearCount: number;
  recommendationSamples: number;
  recommendationWins: number;
  recommendationWinRate: number;
}

export type HoldingSignalKind =
  | "add"
  | "breakout"
  | "limit_seal"
  | "reduce"
  | "distribution"
  | "washout"
  | "stop"
  | "take_profit"
  | "watch"
  | "hold";

export interface HoldingSignal {
  kind: HoldingSignalKind;
  title: string;
  detail: string;
  triggered: boolean;
}

export type AuctionSealLevel =
  | "none"
  | "watch"
  | "sealed"
  | "strong"
  | "extreme";

export interface AuctionSealStrength {
  sealed: boolean;
  level: AuctionSealLevel;
  score: number;
  label: string;
  limitPrice: number;
  gapPct: number;
  bid1Price: number;
  bid1Lots: number;
  sealAmount: number;
  floatCapRatio: number;
  turnoverRate: number;
  observedAt: string;
}

export interface HoldingTechnicalProfile {
  ma5: number;
  ma20: number;
  high20: number;
  low20: number;
  ret5: number;
  ret10: number;
  ret30: number;
  history: HistoryPoint[];
}

export interface HoldingBenchmark {
  code: string;
  name: string;
  symbol: string;
  history: HistoryPoint[];
  quote: StockQuoteDetail;
}

export interface HoldingAnomalyRisk {
  benchmarkCode: string;
  benchmarkName: string;
  tenDayDeviation: number | null;
  thirtyDayDeviation: number | null;
  currentDayDeviation: number | null;
  tenDayRemaining: number | null;
  thirtyDayRemaining: number | null;
  tenDayRedLinePrice: number | null;
  thirtyDayRedLinePrice: number | null;
  nextDayTenDayRedLinePrice: number | null;
  status: "clear" | "watch" | "near" | "breached";
  label: string;
  action: string;
}

export interface HoldingSnapshot {
  position: HoldingPosition;
  quote: StockQuoteDetail;
  avgPrice: number;
  marketValue: number;
  pnl: number;
  pnlPct: number;
  dayPct: number;
  drawdownFromHigh: number;
  stopPrice: number;
  takeProfitPrice: number;
  takeProfitStretch: number | null;
  signal: HoldingSignal;
  signals: HoldingSignal[];
  anomalyRisk?: HoldingAnomalyRisk | null;
  reviewAdvice?: HoldingSignal;
  auctionSeal?: AuctionSealStrength | null;
  technical?: HoldingTechnicalProfile | null;
  benchmark?: HoldingBenchmark | null;
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
  analysisKline?: DailyBar[];
  dragonTiger: DragonTigerRecord[];
}

export interface GlobalIndexDefinition {
  symbol: string;
  name: string;
  shortName: string;
  region: "中国" | "香港" | "美国" | "韩国";
  provider?: "tencent" | "eastmoney";
  klineFile?: string;
}

export interface GlobalIndexQuote extends GlobalIndexDefinition {
  quote: StockQuoteDetail;
}

export interface GlobalSectorPulse {
  symbol: string;
  name: string;
  changePct: number;
  mappedSectors: string[];
}

export interface GlobalMarketContext {
  indices: GlobalIndexQuote[];
  usSectors: GlobalSectorPulse[];
  strongestUsSectors: GlobalSectorPulse[];
  fetchedAt: string;
}

export interface IndexDetailData {
  definition: GlobalIndexDefinition;
  quote: StockQuoteDetail;
  kline: DailyBar[];
  ret5: number;
  ret10: number;
  ret30: number;
  ma5: number;
  ma20: number;
  score: number;
  stance: "强势" | "偏强" | "震荡" | "偏弱";
  summary: string;
}

export interface StockSearchResult {
  code: string;
  name: string;
  symbol: string;
  market: string;
  pinyin: string;
}

export type StockNewsTone = "positive" | "risk" | "neutral";

export interface StockNewsItem {
  id: string;
  date: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  kind: "news" | "announcement";
  tone: StockNewsTone;
  tags: string[];
}

export interface StockInsight {
  score: number;
  stance: "强势" | "偏强" | "观察" | "谨慎";
  title: string;
  summary: string;
  positives: string[];
  risks: string[];
  action: string;
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
  ret30?: number;
  anomaly?: CandidateAnomaly | null;
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
  mapScores?: {
    emotion: number;
    capital: number;
    risk: number;
    total: number;
  };
  reviewTags?: string[];
  reviewMetrics?: {
    dayReturn: number;
    closePosition: number;
    amountRatio: number;
    turnover: number;
    current: number;
    amount: number;
  } | null;
  auctionSeal?: AuctionSealStrength | null;
  boardScore?: number;
  recommendationScore?: number;
  qualityScore?: number;
  executionScore?: number;
  actionabilityScore?: number;
  actionabilityLabel?: string;
  recentPosition?: {
    status: "low" | "middle" | "high" | "unavailable";
    label: string;
    percentile: number | null;
    currentPercentile: number | null;
    rangeLow: number | null;
    rangeHigh: number | null;
    baseClose: number | null;
    return15: number | null;
  };
  leaderSimilarity?: number;
  matchedLeader?: string;
  matchedLeaderIndustry?: string;
  leaderRelationType?: "name" | "sector" | "concept" | "none";
  leaderRelationLabel?: string;
  leaderRelationScore?: number;
  leaderRelationQualified?: boolean;
  leaderRotationEligible?: boolean;
  leaderRelationReasons?: string[];
  leaderPatternTags?: string[];
  scoreCoverage?: number;
  scoreBreakdown?: {
    model: number;
    review: number;
    auction: number;
    seal: number;
    sector: number;
    liquidity: number;
    momentum: number;
    risk: number;
    lhb: number;
  };
}

export interface CandidateAnomaly {
  threshold: number;
  threeDayReturn: number;
  distanceToThreshold: number;
  tenDayReturn: number | null;
  thirtyDayReturn: number | null;
  distanceToTenDayLimit: number | null;
  distanceToThirtyDayLimit: number | null;
  nextTriggerPrice: number | null;
  lastAbnormalDate: string | null;
  daysSinceLastAbnormal: number | null;
  abnormalCount30: number;
  regulatoryStatus: "clear" | "watch" | "abnormal";
  regulatoryLabels: string[];
  method?: "price_return" | "index_deviation";
  benchmarkCode?: string;
  benchmarkName?: string;
  currentDayDeviation?: number | null;
  tenDayDeviation?: number | null;
  thirtyDayDeviation?: number | null;
  tenDayRemaining?: number | null;
  thirtyDayRemaining?: number | null;
  tenDayRedLinePrice?: number | null;
  thirtyDayRedLinePrice?: number | null;
  nextDayTenDayRedLinePrice?: number | null;
  riskAction?: string;
}

export interface LimitUpSeed {
  code: string;
  name: string;
  sector: string;
  streak: number;
  close: number;
  open?: number;
  preClose?: number;
  gap?: number;
  amount?: number;
  volumeRatio?: number;
  turnoverRate?: number;
  auctionSeal?: AuctionSealStrength | null;
  boardScore?: number;
}

export interface LimitLadderEntry {
  streak: number;
  count: number;
}

export interface SectorPulse {
  name: string;
  limitUpCount: number;
  maxStreak: number;
  previousCount: number;
  promotedCount: number;
  promotionRate: number;
}

export interface MapConclusion {
  stance: "support" | "neutral" | "defensive";
  title: string;
  action: string;
}

export interface EmotionMap {
  score: number;
  limitUpCount: number;
  limitDownCount: number;
  touchedLimitCount: number;
  failedBoardCount: number;
  failedBoardRate: number;
  yesterdayLimitCount: number;
  yesterdayPremium: number;
  yesterdayWinRate: number;
  yesterdayLimitDownCount: number;
  maxStreak: number;
  ladder: LimitLadderEntry[];
  ladderGapCount: number;
  ladderComplete: boolean;
  strongSectors: SectorPulse[];
  summary: string;
  conclusion: MapConclusion;
}

export interface CapitalMap {
  score: number;
  top20AvgReturn: number;
  top20UpRate: number;
  largeCapStrength: number;
  lhbNetBuyCount: number;
  lhbNetSellCount: number;
  lhbNetAmount: number;
  promotionRate: number;
  promotedCount: number;
  strongSectorPromotion: number;
  summary: string;
  conclusion: MapConclusion;
}

export interface LhbPulseStock {
  code: string;
  name: string;
  netAmount: number;
}

export interface RiskMap {
  score: number;
  level: RiskLevel;
  bigLossCount: number;
  highOpenFadeCount: number;
  limitDownCount: number;
  failedBoardRate: number;
  crowdedCount: number;
  summary: string;
  conclusion: MapConclusion;
}

export interface ReviewOverallConclusion {
  stance: "attack" | "watch" | "defend";
  score: number;
  title: string;
  action: string;
  reasons: string[];
}

export interface StrongestSector {
  name: string;
  score: number;
  limitUpCount: number;
  maxStreak: number;
  previousCount: number;
  promotedCount: number;
  promotionRate: number;
  reason: string;
  auctionWatch: string;
}

export interface SectorAuctionPulse {
  name: string;
  candidateCount: number;
  positiveOpenCount: number;
  avgGap: number;
  totalAuctionAmount: number;
  avgAuctionRatio: number;
  score: number;
  reason: string;
}

export interface ReviewMaps {
  date: string;
  previousDate: string;
  generatedAt: string;
  emotion: EmotionMap;
  capital: CapitalMap;
  risk: RiskMap;
  limitUps: LimitUpSeed[];
  previousLimitUps: LimitUpSeed[];
  lhbStocks: LhbPulseStock[];
  conclusion: ReviewOverallConclusion;
  strongestSector: StrongestSector | null;
}

export interface ModelMetrics {
  n: number;
  days?: number;
  touch_rate: number;
  close_limit_rate: number;
  avg_next_open_to_close: number;
}

export interface ModelAdaptationRecord {
  date: string;
  sampleDate: string;
  sampleSize: number;
  hitRate: number;
  avgReturn: number;
  touchedLimitRate: number;
  closedLimitRate: number;
  factorCorrelations: Record<string, number>;
  weightChanges: Record<string, number>;
  evaluated: Array<{
    code: string;
    name: string;
    return: number;
    touchedLimit: boolean;
    closedLimit: boolean;
  }>;
  note: string;
}

export interface ModelAdaptation {
  method: string;
  latest: ModelAdaptationRecord;
  history: ModelAdaptationRecord[];
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
  reviewMaps?: ReviewMaps;
  globalReference?: {
    usSectors: GlobalSectorPulse[];
    strongestUsSectors: GlobalSectorPulse[];
    fetchedAt: string;
  };
  model: {
    weights: Record<string, number>;
    trainEnd: string;
    validationStart: string;
    train: ModelMetrics;
    validation: ModelMetrics;
    top3Validation: ModelMetrics;
    baselineValidation: ModelMetrics;
    adaptation?: ModelAdaptation | null;
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
