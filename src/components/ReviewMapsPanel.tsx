import {
  Activity,
  ArrowRight,
  ChevronDown,
  Landmark,
  ShieldAlert,
  TrendingUp
} from "lucide-react";
import type {
  Candidate,
  ReviewMaps,
  RiskLevel,
  SectorAuctionPulse
} from "../types";

function pct(value: number, digits = 1) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function ratioPct(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function riskText(level: RiskLevel) {
  if (level === "low") return "低风险";
  if (level === "medium") return "中风险";
  return "高风险";
}

function money(value: number) {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(0)}万`;
  return value.toFixed(0);
}

function overallStanceText(stance: ReviewMaps["conclusion"]["stance"]) {
  if (stance === "attack") return "进攻";
  if (stance === "defend") return "防守";
  return "观察";
}

export function ReviewMapsPanel({
  maps,
  auctionSector,
  auctionCandidates
}: {
  maps?: ReviewMaps;
  auctionSector?: SectorAuctionPulse | null;
  auctionCandidates?: Candidate[] | null;
}) {
  if (!maps) return null;

  const maxLadder = Math.max(1, ...maps.emotion.ladder.map((item) => item.count));
  const liveSamples = (auctionCandidates ?? []).flatMap((candidate) =>
    candidate.live
      ? [{
          gapStrength: candidate.live.gapStrength,
          auctionRatio: candidate.live.auctionRatio,
          eligible: candidate.liveEligible === true
        }]
      : []
  );
  const average = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  const averageGapStrength = average(
    liveSamples.map((item) => item.gapStrength)
  );
  const averageAuctionRatio = average(
    liveSamples.map((item) => item.auctionRatio)
  );
  const eligibleRate = liveSamples.length
    ? liveSamples.filter((item) => item.eligible).length / liveSamples.length
    : 0;
  const liveQuality = liveSamples.length
    ? Math.min(1, averageGapStrength / 0.5) * 0.35 +
      Math.min(1, averageAuctionRatio / 0.04) * 0.4 +
      eligibleRate * 0.25
    : 0.5;
  const liveAdjustment = liveSamples.length
    ? Math.round((liveQuality - 0.5) * 14)
    : 0;
  const attackScore = Math.max(
    0,
    Math.min(100, Math.round(maps.conclusion.score * 100) + liveAdjustment)
  );
  const attackState =
    attackScore >= 75 ? "attack" : attackScore >= 55 ? "watch" : "defend";
  const attackTitle =
    attackState === "attack"
      ? "进攻窗口"
      : attackState === "watch"
        ? "轻仓观察窗口"
        : "防守窗口";
  const attackAdvice =
    attackState === "attack"
      ? "优先执行两只候选中止跌与竞价更强的标的；高开超过计划上沿时仍不追。"
      : attackState === "watch"
        ? "只允许轻仓试错，等9:35站稳开盘价和分时均价后再考虑提高仓位。"
        : "以防守为主，不新开进攻仓位；已有持仓优先执行止盈止损纪律。";

  return (
    <section className="review-maps reveal reveal-3" aria-label="收盘复盘三张地图">
      <div className="review-maps-heading">
        <div>
          <p><span className="eyebrow-index">04</span> MARKET REVIEW</p>
          <h2>三图复盘</h2>
        </div>
        <span>{maps.date} · 情绪 · 资金 · 风险</span>
      </div>

      <div className={`review-overall-conclusion review-overall-conclusion--${maps.conclusion.stance}`}>
        <div className="review-overall-copy">
          <span>三图联合结论</span>
          <h3>{maps.conclusion.title}</h3>
          <p>{maps.conclusion.action}</p>
          <div className="review-overall-reasons">
            {maps.conclusion.reasons.map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </div>
        </div>
        <div className="review-overall-score">
          <small>联合决策分</small>
          <strong>{Math.round(maps.conclusion.score * 100)}</strong>
          <em>{overallStanceText(maps.conclusion.stance)}</em>
        </div>
      </div>

      <section className={`attack-window-panel attack-window-panel--${attackState}`}>
        <div className="attack-window-score">
          <span>进攻窗口分</span>
          <strong>{attackScore}</strong>
          <small>/ 100</small>
        </div>
        <div className="attack-window-copy">
          <span>
            {liveSamples.length ? "9:25竞价实时修正" : "次日盘前基准"}
          </span>
          <h3>{attackTitle}</h3>
          <p>{attackAdvice}</p>
        </div>
        <div className="attack-window-rules">
          <span className="is-attack">75—100 进攻</span>
          <span className="is-watch">55—74 轻仓观察</span>
          <span className="is-defend">0—54 防守</span>
        </div>
        <div className="attack-window-live">
          {liveSamples.length ? (
            <>
              <span>竞价修正 {liveAdjustment >= 0 ? "+" : ""}{liveAdjustment}</span>
              <span>高开强度 {ratioPct(averageGapStrength)}</span>
              <span>量额比 {ratioPct(averageAuctionRatio)}</span>
              <span>通过率 {ratioPct(eligibleRate)}</span>
            </>
          ) : (
            <span>集合竞价开始后，将结合两只最佳标的的高开、竞价量额比与通过率实时更新分数。</span>
          )}
        </div>
      </section>

      <div className="review-sector-verdict">
        <article>
          <span>复盘最强板块</span>
          {maps.strongestSector ? (
            <>
              <strong>{maps.strongestSector.name}</strong>
              <p>{maps.strongestSector.reason}</p>
              <small>{maps.strongestSector.auctionWatch}</small>
            </>
          ) : (
            <p>当前没有满足三只以上涨停的强势板块。</p>
          )}
        </article>
        <article className={auctionSector ? "is-live" : ""}>
          <span>竞价候选板块动态</span>
          {auctionSector ? (
            <>
              <strong>{auctionSector.name}</strong>
              <p>{auctionSector.reason}</p>
              <small>
                竞价成交额 {money(auctionSector.totalAuctionAmount)} · 板块动态分{" "}
                {Math.round(auctionSector.score * 100)}
              </small>
            </>
          ) : (
            <>
              <strong>等待 9:25 更新</strong>
              <p>竞价开始后按候选板块的平均涨幅、成交额、竞价量额比和红盘比例动态重排。</p>
            </>
          )}
        </article>
      </div>

      <details className="review-map-details">
        <summary>
          <div>
            <strong>查看三张地图完整分析</strong>
            <span>
              情绪 {Math.round(maps.emotion.score * 100)} · 资金{" "}
              {Math.round(maps.capital.score * 100)} · 风险安全垫{" "}
              {Math.round(maps.risk.score * 100)}
            </span>
          </div>
          <ChevronDown size={18} />
        </summary>
        <div className="review-map-grid">
        <article className="review-map-card review-map-card--emotion">
          <header>
            <span className="review-map-icon"><Activity size={20} /></span>
            <div>
              <small>01 / EMOTION</small>
              <h3>情绪地图</h3>
            </div>
            <strong>{Math.round(maps.emotion.score * 100)}</strong>
          </header>
          <div className="review-map-stats">
            <div><span>涨停 / 跌停</span><strong>{maps.emotion.limitUpCount} / {maps.emotion.limitDownCount}</strong></div>
            <div><span>炸板率</span><strong>{ratioPct(maps.emotion.failedBoardRate)}</strong></div>
            <div><span>昨日涨停溢价</span><strong className={maps.emotion.yesterdayPremium >= 0 ? "is-up" : "is-down"}>{pct(maps.emotion.yesterdayPremium)}</strong></div>
            <div><span>昨日红盘率</span><strong>{ratioPct(maps.emotion.yesterdayWinRate)}</strong></div>
          </div>
          <div className={`map-conclusion map-conclusion--${maps.emotion.conclusion.stance}`}>
            <span>地图结论</span>
            <strong>{maps.emotion.conclusion.title}</strong>
            <p>{maps.emotion.conclusion.action}</p>
          </div>
          <div className="ladder-block">
            <span>连板梯队 · 最高 {maps.emotion.maxStreak} 板</span>
            <div className="ladder-list">
              {maps.emotion.ladder.map((item) => (
                <div key={item.streak}>
                  <strong>{item.streak}板</strong>
                  <i style={{ width: `${Math.max(8, item.count / maxLadder * 100)}%` }} />
                  <small>{item.count}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="review-sector-list">
            {maps.emotion.strongSectors.length ? (
              maps.emotion.strongSectors.slice(0, 3).map((sector) => (
                <span key={sector.name}>
                  {sector.name} · {sector.limitUpCount}只
                </span>
              ))
            ) : (
              <span>暂无三只以上涨停的强势板块</span>
            )}
          </div>
          <p>{maps.emotion.summary}</p>
        </article>

        <article className="review-map-card review-map-card--capital">
          <header>
            <span className="review-map-icon"><Landmark size={20} /></span>
            <div>
              <small>02 / CAPITAL</small>
              <h3>资金地图</h3>
            </div>
            <strong>{Math.round(maps.capital.score * 100)}</strong>
          </header>
          <div className="review-map-stats">
            <div><span>成交额前20均涨</span><strong className={maps.capital.top20AvgReturn >= 0 ? "is-up" : "is-down"}>{pct(maps.capital.top20AvgReturn)}</strong></div>
            <div><span>前20上涨占比</span><strong>{ratioPct(maps.capital.top20UpRate)}</strong></div>
            <div><span>龙虎榜净买</span><strong>{maps.capital.lhbNetBuyCount} 家</strong></div>
            <div><span>龙虎榜净卖</span><strong>{maps.capital.lhbNetSellCount} 家</strong></div>
            <div><span>昨日涨停晋级率</span><strong>{ratioPct(maps.capital.promotionRate)}</strong></div>
            <div>
              <span>最强板块晋级率</span>
              <strong>
                {ratioPct(maps.capital.strongSectorPromotion)}
                {maps.strongestSector && (
                  <small>
                    {" "}
                    {maps.strongestSector.promotedCount}/{maps.strongestSector.previousCount}
                  </small>
                )}
              </strong>
            </div>
          </div>
          <div className={`map-conclusion map-conclusion--${maps.capital.conclusion.stance}`}>
            <span>地图结论</span>
            <strong>{maps.capital.conclusion.title}</strong>
            <p>{maps.capital.conclusion.action}</p>
          </div>
          <div className="capital-flow">
            <div>
              <span>大票动能</span>
              <strong>{maps.capital.largeCapStrength >= 0.58 ? "主导" : maps.capital.largeCapStrength >= 0.36 ? "平衡" : "偏弱"}</strong>
            </div>
            <div>
              <span>接力资金</span>
              <strong>{maps.capital.promotionRate >= 0.35 ? "愿意接力" : maps.capital.promotionRate >= 0.18 ? "局部接力" : "谨慎"}</strong>
            </div>
            <div>
              <span>晋级数量</span>
              <strong>{maps.capital.promotedCount} 只</strong>
            </div>
          </div>
          <p>{maps.capital.summary}</p>
        </article>

        <article className="review-map-card review-map-card--risk">
          <header>
            <span className="review-map-icon"><ShieldAlert size={20} /></span>
            <div>
              <small>03 / RISK</small>
              <h3>风险地图</h3>
            </div>
            <strong>{Math.round(maps.risk.score * 100)}</strong>
          </header>
          <div className="review-map-stats">
            <div><span>风险等级</span><strong className={`risk-${maps.risk.level}`}>{riskText(maps.risk.level)}</strong></div>
            <div><span>大面股</span><strong>{maps.risk.bigLossCount} 只</strong></div>
            <div><span>高开低走</span><strong>{maps.risk.highOpenFadeCount} 只</strong></div>
            <div><span>拥挤换手</span><strong>{maps.risk.crowdedCount} 只</strong></div>
          </div>
          <div className={`map-conclusion map-conclusion--${maps.risk.conclusion.stance}`}>
            <span>地图结论</span>
            <strong>{maps.risk.conclusion.title}</strong>
            <p>{maps.risk.conclusion.action}</p>
          </div>
          <div className="risk-gauge">
            <span>风险安全垫</span>
            <div>
              <i style={{ width: `${Math.round(maps.risk.score * 100)}%` }} />
            </div>
            <strong>{Math.round(maps.risk.score * 100)}</strong>
          </div>
          <div className="review-risk-tags">
            <span>跌停 {maps.risk.limitDownCount} 只</span>
            <span>炸板率 {ratioPct(maps.risk.failedBoardRate)}</span>
            <span>{maps.emotion.ladderGapCount ? `梯队缺 ${maps.emotion.ladderGapCount} 档` : "梯队无断层"}</span>
          </div>
          <p>{maps.risk.summary}</p>
        </article>
        </div>
      </details>

      <div className="review-maps-foot">
        {auctionSector ? <ArrowRight size={15} /> : <TrendingUp size={15} />}
        <span>
          {auctionSector
            ? `9:25动态更新：当前候选池竞价最强板块为${auctionSector.name}，候选排序已同步刷新。`
            : "候选排序同时参考三图：情绪顺风、资金接力与风险安全垫；9:25后按竞价数据动态更新。"}
        </span>
      </div>
    </section>
  );
}
