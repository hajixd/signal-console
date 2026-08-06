import json
import sys

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp


def main() -> None:
    payload = json.load(sys.stdin)
    entries = payload["entries"]
    development_target = float(payload["developmentTargetPf"])
    full_target = float(payload["fullTargetPf"])
    holdout_target = float(payload["holdoutTargetPf"])
    annual_target = float(payload["annualTargetPf"])
    development_edge = np.array(
        [entry["grossProfit"] - development_target * entry["grossLoss"] for entry in entries],
        dtype=float,
    )
    full_edge = np.array(
        [entry["fullGrossProfit"] - full_target * entry["fullGrossLoss"] for entry in entries],
        dtype=float,
    )
    holdout_edge = np.array(
        [entry["holdoutGrossProfit"] - holdout_target * entry["holdoutGrossLoss"] for entry in entries],
        dtype=float,
    )
    years = sorted({year for entry in entries for year in entry["annualGrossProfit"]})
    annual_edges = [
        np.array(
            [
                entry["annualGrossProfit"].get(year, 0.0)
                - annual_target * entry["annualGrossLoss"].get(year, 0.0)
                for entry in entries
            ],
            dtype=float,
        )
        for year in years
    ]
    constraint_rows = [development_edge, full_edge, holdout_edge, *annual_edges]
    trades = np.array([entry["tradeCount"] for entry in entries], dtype=float)
    result = milp(
        c=-trades,
        integrality=np.ones(len(entries)),
        bounds=Bounds(np.zeros(len(entries)), np.ones(len(entries))),
        constraints=LinearConstraint(
            np.vstack(constraint_rows),
            np.zeros(len(constraint_rows)),
            np.full(len(constraint_rows), np.inf),
        ),
        options={"mip_rel_gap": 0.0},
    )
    if not result.success or result.x is None:
        raise RuntimeError(result.message)
    selected = [entry["id"] for entry, value in zip(entries, result.x) if value >= 0.5]
    json.dump({"selectedStrategyIds": selected}, sys.stdout)


if __name__ == "__main__":
    main()
