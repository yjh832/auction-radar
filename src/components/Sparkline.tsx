import { useId } from "react";
import type { HistoryPoint } from "../types";

interface SparklineProps {
  points: HistoryPoint[];
}

export function Sparkline({ points }: SparklineProps) {
  const id = useId().replace(/:/g, "");
  if (points.length < 2) {
    return <div className="sparkline-empty">暂无足够历史走势</div>;
  }

  const width = 480;
  const height = 118;
  const padding = 8;
  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.01);
  const coordinates = points.map((point, index) => {
    const x = padding + (index / (points.length - 1)) * (width - padding * 2);
    const y =
      padding + ((max - point.close) / span) * (height - padding * 2 - 10);
    return [x, y] as const;
  });
  const line = coordinates.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="sparkline">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近20日收盘走势">
        <defs>
          <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2F75B5" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#2F75B5" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#spark-${id})`} />
        <polyline points={line} fill="none" stroke="#2F75B5" strokeWidth="2.2" />
        <circle
          cx={coordinates.at(-1)?.[0]}
          cy={coordinates.at(-1)?.[1]}
          r="4"
          fill="#EEF4FB"
          stroke="#2F75B5"
          strokeWidth="2.5"
        />
      </svg>
      <div className="sparkline__axis">
        <span>{first.date.slice(5)}</span>
        <span>{last.date.slice(5)}</span>
      </div>
    </div>
  );
}
