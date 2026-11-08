import { Activity, Landmark, ShieldAlert, TrendingUp } from "lucide-react";
import type { ReviewMaps, RiskLevel } from "../types";

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

export function ReviewMapsPanel({ maps }: { maps?: ReviewMaps }) {
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
            <div><span>强势板块晋级率</span><strong>{ratioPct(maps.capital.strongSectorPromotion)}</strong></div>
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
        <TrendingUp size={15} />
        <span>候选排序同时参考三图：情绪顺风、资金接力与风险安全垫；高风险环境自动压缩仓位和追涨条件。</span>
      </div>
    </section>
  );
}
