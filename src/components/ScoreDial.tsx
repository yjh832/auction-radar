interface ScoreDialProps {
  value: number;
  label: string;
}

export function ScoreDial({ value, label }: ScoreDialProps) {
  const normalized = Math.max(0, Math.min(1, value));
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalized);

  return (
    <div className="score-dial" aria-label={`${label} ${Math.round(normalized * 100)}分`}>
      <svg viewBox="0 0 112 112" role="img">
        <circle className="score-dial__track" cx="56" cy="56" r={radius} />
        <circle
          className="score-dial__value"
          cx="56"
          cy="56"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="score-dial__copy">
        <strong>{Math.round(normalized * 100)}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}
