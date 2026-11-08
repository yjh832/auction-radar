#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import baostock as bs


ROOT = Path(__file__).resolve().parent.parent
STRATEGY_PATH = ROOT / "data" / "strategy.json"
OUTPUT_DIR = ROOT / "public" / "intraday"


def baostock_symbol(code: str) -> str:
    return f"{'sh' if code.startswith('6') else 'sz'}.{code}"


def parse_time(value: str) -> str:
    return f"{value[8:10]}:{value[10:12]}"


def main() -> None:
    strategy = json.loads(STRATEGY_PATH.read_text())
    candidates = strategy.get("reviewUniverse") or strategy.get("candidates") or []
    as_of = datetime.strptime(strategy["asOf"], "%Y-%m-%d")
    start = (as_of - timedelta(days=75)).strftime("%Y-%m-%d")
    end = as_of.strftime("%Y-%m-%d")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    login = bs.login()
    if login.error_code != "0":
        raise RuntimeError(f"Baostock login failed: {login.error_msg}")

    try:
        for candidate in candidates:
            code = candidate["code"]
            rs = bs.query_history_k_data_plus(
                baostock_symbol(code),
                "date,time,open,high,low,close,volume,amount",
                start_date=start,
                end_date=end,
                frequency="5",
                adjustflag="3",
            )
            if rs.error_code != "0":
                print(f"[warn] {code}: {rs.error_msg}")
                continue
            rows = []
            while rs.next():
                rows.append(rs.get_row_data())
            by_date: dict[str, list[list[str]]] = defaultdict(list)
            for row in rows:
                by_date[row[0]].append(row)

            dates = sorted(by_date)[-30:]
            output: dict[str, dict] = {}
            for index, date in enumerate(dates):
                bars = sorted(by_date[date], key=lambda row: row[1])
                if not bars:
                    continue
                previous_date = dates[index - 1] if index > 0 else None
                if previous_date is None:
                    earlier = sorted(d for d in by_date if d < date)
                    previous_date = earlier[-1] if earlier else None
                pre_close = (
                    float(by_date[previous_date][-1][5])
                    if previous_date
                    else float(bars[0][2])
                )
                cumulative_volume = 0.0
                cumulative_amount = 0.0
                points = []
                total_volume = 0.0
                total_amount = 0.0
                for bar in bars:
                    volume = float(bar[6] or 0)
                    amount = float(bar[7] or 0)
                    cumulative_volume += volume
                    cumulative_amount += amount
                    total_volume += volume
                    total_amount += amount
                    avg_price = (
                        cumulative_amount / cumulative_volume
                        if cumulative_volume > 0
                        else float(bar[5])
                    )
                    points.append(
                        [
                            parse_time(bar[1]),
                            float(bar[5]),
                            round(avg_price, 4),
                            volume,
                        ]
                    )
                output[date] = {
                    "date": date,
                    "preClose": pre_close,
                    "open": float(bars[0][2]),
                    "close": float(bars[-1][5]),
                    "high": max(float(bar[3]) for bar in bars),
                    "low": min(float(bar[4]) for bar in bars),
                    "amount": total_amount,
                    "volume": total_volume,
                    "points": points,
                }
            target = OUTPUT_DIR / f"{code}.json"
            target.write_text(
                json.dumps(output, ensure_ascii=False, separators=(",", ":"))
            )
            print(f"{code}: {len(output)} days -> {target.relative_to(ROOT)}")
    finally:
        bs.logout()


if __name__ == "__main__":
    main()
