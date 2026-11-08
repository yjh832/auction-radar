import { Activity, ArrowRight, Landmark, ShieldAlert, TrendingUp } from "lucide-react";
import type {
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
  auctionSector
}: {
  maps?: ReviewMaps;
  auctionSector?: SectorAuctionPulse | null;
}) {
  if (!maps) return null;

  const maxLadder = Math.max(1, ...maps.emotion.ladder.map((item) => item.count));

  return (
    <section className="review-maps reveal reveal-3" aria-label="收盘复盘三张地图">
      <div className="review-maps-heading">
        <div>
          <p>THREE-MAP REVIEW</p>
          <h2>收盘三张地图</h2>
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
          <span>次日竞价动态</span>
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

      <div className="review-maps-foot">
        {auctionSector ? <ArrowRight size={15} /> : <TrendingUp size={15} />}
        <span>
          {auctionSector
            ? `9:25动态更新：当前竞价最强板块为${auctionSector.name}，候选排序已同步刷新。`
            : "候选排序同时参考三图：情绪顺风、资金接力与风险安全垫；9:25后按竞价数据动态更新。"}
        </span>
      </div>
    </section>
  );
}
