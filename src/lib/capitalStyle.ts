import type { Candidate } from "../types";

export type CapitalStyle =
  | "hot_money"
  | "institution"
  | "mixed"
  | "unknown";

export type LeaderRelationType =
  | "name"
  | "sector"
  | "concept"
  | "none";

export interface CapitalStyleProfile {
  style: CapitalStyle;
  label: string;
  confidence: number;
  hotMoneyScore: number;
  institutionScore: number;
  rotationFriendly: boolean;
  reasons: string[];
}

export interface LeaderRelationProfile {
  qualified: boolean;
  type: LeaderRelationType;
  label: string;
  score: number;
  reasons: string[];
}

interface SectorConcept {
  key: string;
  label: string;
  members: string[];
  hotMoneyFriendly: boolean;
}

interface LeaderDescriptor {
  name: string;
  industry: string;
}

const SECTOR_CONCEPTS: SectorConcept[] = [
  {
    key: "nonferrous",
    label: "有色资源",
    members: ["工业金属", "小金属", "贵金属", "能源金属", "金属新材"],
    hotMoneyFriendly: true
  },
  {
    key: "steel",
    label: "钢铁材料",
    members: ["普钢", "特钢", "冶钢原料"],
    hotMoneyFriendly: true
  },
  {
    key: "chemical",
    label: "化工材料",
    members: ["化学原料", "化学制品", "化学纤维", "塑料", "橡胶", "农化制品"],
    hotMoneyFriendly: true
  },
  {
    key: "auto",
    label: "汽车产业链",
    members: ["汽车整车", "汽车零部", "汽车服务", "摩托车", "商用车"],
    hotMoneyFriendly: true
  },
  {
    key: "equipment",
    label: "设备制造",
    members: ["通用设备", "专用设备", "工程机械", "自动化设", "仪器仪表"],
    hotMoneyFriendly: true
  },
  {
    key: "power",
    label: "电力能源",
    members: ["电力", "电网设备", "光伏设备", "风电设备", "电池", "燃气Ⅱ"],
    hotMoneyFriendly: true
  },
  {
    key: "consumer",
    label: "大消费",
    members: [
      "食品加工",
      "饮料乳品",
      "小家电",
      "厨卫电器",
      "家居用品",
      "服装家纺",
      "饰品"
    ],
    hotMoneyFriendly: true
  },
  {
    key: "retail",
    label: "商业零售",
    members: ["一般零售", "专业连锁", "贸易Ⅱ", "旅游零售"],
    hotMoneyFriendly: true
  },
  {
    key: "property",
    label: "地产基建",
    members: ["房地产开", "基础建设", "专业工程", "装修装饰", "水泥"],
    hotMoneyFriendly: true
  },
  {
    key: "media",
    label: "传媒消费",
    members: ["影视院线", "出版", "游戏Ⅱ", "广告营销", "数字媒体", "教育"],
    hotMoneyFriendly: true
  },
  {
    key: "tech_hardware",
    label: "科技硬件",
    members: [
      "半导体",
      "元件",
      "光学光电",
      "消费电子",
      "通信设备",
      "计算机设",
      "电子化学品"
    ],
    hotMoneyFriendly: false
  },
  {
    key: "software",
    label: "软件信息",
    members: ["软件开发", "IT服务Ⅱ", "通信服务"],
    hotMoneyFriendly: false
  },
  {
    key: "finance",
    label: "金融权重",
    members: ["银行", "证券Ⅱ", "保险Ⅱ", "多元金融"],
    hotMoneyFriendly: false
  }
];

const GENERIC_NAME_WORDS =
  /股份|集团|控股|实业|发展|科技|新材|新材料|智能|光电|电子|精密|中国|国际/g;

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSector(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/[ⅡⅢ]/g, "")
    .replace(/行业$/g, "");
}

function normalizeName(value: string) {
  return value
    .replace(/[\s*]/g, "")
    .replace(/ST/g, "")
    .replace(GENERIC_NAME_WORDS, "");
}

function sectorsOverlap(left: string, right: string) {
  const a = normalizeSector(left);
  const b = normalizeSector(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function sectorConcept(industry: string) {
  const normalized = normalizeSector(industry);
  return (
    SECTOR_CONCEPTS.find((group) =>
      group.members.some((member) => {
        const item = normalizeSector(member);
        return (
          normalized === item ||
          normalized.includes(item) ||
          item.includes(normalized)
        );
      })
    ) ?? null
  );
}

function commonNamePhrase(left: string, right: string) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return "";
  if (a === b) return a;
  if (Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a))) {
    return a.length <= b.length ? a : b;
  }
  let best = "";
  for (let start = 0; start < a.length; start += 1) {
    for (let end = start + 2; end <= a.length; end += 1) {
      const candidate = a.slice(start, end);
      if (b.includes(candidate) && candidate.length > best.length) {
        best = candidate;
      }
    }
  }
  return best;
}

function formatCap(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value >= 100_000_000
    ? `${(value / 100_000_000).toFixed(1)}亿`
    : `${(value / 10_000).toFixed(0)}万`;
}

export function analyzeCapitalStyle(candidate: Candidate): CapitalStyleProfile {
  const turnover =
    candidate.reviewMetrics?.turnover ?? candidate.turnoverEst ?? 0;
  const amount =
    candidate.reviewMetrics?.amount ?? candidate.amountEst ?? 0;
  const concept = sectorConcept(candidate.industry);
  const capText = formatCap(candidate.floatCap);

  let hotMoneyScore = 8;
  if (candidate.limitStreak >= 2) {
    hotMoneyScore += 24 + Math.min(candidate.limitStreak, 5) * 4;
  }
  if (candidate.limit20 >= 2) hotMoneyScore += 10;
  if (candidate.limit60 >= 4) hotMoneyScore += 6;
  if (turnover >= 12) hotMoneyScore += 20;
  else if (turnover >= 6) hotMoneyScore += 15;
  else if (turnover >= 3) hotMoneyScore += 8;
  if (candidate.volRatio >= 2.5) hotMoneyScore += 11;
  else if (candidate.volRatio >= 1.4) hotMoneyScore += 7;
  if (amount >= 1_000_000_000) hotMoneyScore += 12;
  else if (amount >= 400_000_000) hotMoneyScore += 8;
  else if (amount >= 150_000_000) hotMoneyScore += 4;
  if (candidate.floatCap > 0 && candidate.floatCap <= 8_000_000_000) {
    hotMoneyScore += 14;
  } else if (
    candidate.floatCap > 0 &&
    candidate.floatCap <= 20_000_000_000
  ) {
    hotMoneyScore += 9;
  } else if (
    candidate.floatCap > 0 &&
    candidate.floatCap <= 50_000_000_000
  ) {
    hotMoneyScore += 4;
  }
  if (concept?.hotMoneyFriendly) hotMoneyScore += 5;
  if (concept?.key === "tech_hardware") hotMoneyScore -= 13;
  if (concept?.key === "software") hotMoneyScore -= 10;

  let institutionScore = 9;
  if (candidate.floatCap >= 100_000_000_000) institutionScore += 31;
  else if (candidate.floatCap >= 50_000_000_000) institutionScore += 24;
  else if (candidate.floatCap >= 20_000_000_000) institutionScore += 15;
  if (turnover > 0 && turnover <= 4) institutionScore += 18;
  else if (turnover <= 8) institutionScore += 8;
  if (candidate.limitStreak <= 1) institutionScore += 9;
  if (amount >= 1_500_000_000) institutionScore += 10;
  else if (amount >= 500_000_000) institutionScore += 6;
  if (candidate.volRatio > 0 && candidate.volRatio <= 1.3) {
    institutionScore += 8;
  }
  if (concept?.key === "tech_hardware") institutionScore += 10;
  if (concept?.key === "software" || concept?.key === "finance") {
    institutionScore += 8;
  }
  if (candidate.limitStreak >= 2) institutionScore -= 20;

  hotMoneyScore = Math.round(clamp(hotMoneyScore));
  institutionScore = Math.round(clamp(institutionScore));
  const spread = hotMoneyScore - institutionScore;
  let style: CapitalStyle = "unknown";
  if (hotMoneyScore >= 58 && spread >= 10) style = "hot_money";
  else if (institutionScore >= 58 && spread <= -8) style = "institution";
  else if (Math.max(hotMoneyScore, institutionScore) >= 42) style = "mixed";

  const label =
    style === "hot_money"
      ? "游资票"
      : style === "institution"
        ? "机构票"
        : style === "mixed"
          ? "混合票"
          : "资金属性待确认";
  const reasons = [
    candidate.limitStreak > 0 ? `${candidate.limitStreak}板` : "非连板",
    turnover > 0 ? `换手${turnover.toFixed(1)}%` : null,
    capText ? `流通${capText}` : null,
    concept ? `${concept.label}属性` : null
  ].filter((item): item is string => Boolean(item));

  return {
    style,
    label,
    confidence: Math.round(clamp(Math.abs(spread) + 26)),
    hotMoneyScore,
    institutionScore,
    rotationFriendly:
      style === "hot_money" ||
      (style === "mixed" && hotMoneyScore >= 45),
    reasons
  };
}

export function assessLeaderRelation(
  leader: LeaderDescriptor,
  candidate: LeaderDescriptor
): LeaderRelationProfile {
  const reasons: string[] = [];
  let type: LeaderRelationType = "none";
  let score = 0;
  let label = "无明确补涨属性";

  if (sectorsOverlap(leader.industry, candidate.industry)) {
    type = "sector";
    score = 100;
    label = `同板块 · ${candidate.industry}`;
    reasons.push(`与${leader.name}同属${candidate.industry}板块`);
  } else {
    const leaderConcept = sectorConcept(leader.industry);
    const candidateConcept = sectorConcept(candidate.industry);
    if (leaderConcept && leaderConcept.key === candidateConcept?.key) {
      type = "concept";
      score = 76;
      label = `同概念 · ${leaderConcept.label}`;
      reasons.push(
        `${leader.industry}与${candidate.industry}同属${leaderConcept.label}`
      );
    }
  }

  const phrase = commonNamePhrase(leader.name, candidate.name);
  if (phrase.length >= 2) {
    const nameScore = Math.min(92, 54 + phrase.length * 8);
    reasons.push(`名称共同关键词“${phrase}”`);
    if (nameScore > score) {
      type = "name";
      score = nameScore;
      label = `名称关联 · ${phrase}`;
    }
  }

  const qualified = score >= 58;
  return {
    qualified,
    type,
    label,
    score,
    reasons: qualified
      ? reasons
      : ["名称、板块与概念均未形成有效补涨关联"]
  };
}
