from __future__ import annotations

import argparse

import runner
import materialize_cross_market_candidates as helpers


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Materialize opposite-signal clones of existing strategies")
    parser.add_argument(
        "--strategy",
        action="append",
        required=True,
        help="Strategy id/folder to clone as an opposite variant. Repeat to include multiple.",
    )
    parser.add_argument("--backtest-only", action="store_true", help="Mark generated strategies as backtest-only in the app")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    live_enabled = not args.backtest_only
    strategies = runner.load_backtest_strategies()
    requested = [item.strip() for item in args.strategy if item and item.strip()]
    selected_by_id = {
        strategy.id: strategy
        for strategy in strategies
        if any(runner.strategy_matches_filter(strategy, item) for item in requested)
    }
    selected = list(selected_by_id.values())
    if not selected:
        raise ValueError(f"No strategies matched filter(s): {', '.join(requested)}")

    created_folders: list[str] = []
    for strategy in selected:
        source_dir = helpers.STRATEGY_ROOT / strategy.folder
        if not source_dir.exists():
            raise FileNotFoundError(f"Missing source strategy folder: {source_dir}")

        folder = f"{strategy.id}_opposite"
        label = f"{strategy.label} Opposite"
        target_dir = helpers.STRATEGY_ROOT / folder

        helpers.copy_strategy_scaffold(source_dir, target_dir)
        helpers.rewrite_metadata(
            helpers.find_metadata_path(target_dir),
            folder,
            label,
            folder,
            strategy.asset_key,
            True,
        )
        helpers.rewrite_strategy_ts(
            target_dir / "strategy.ts",
            folder,
            label,
            folder,
            strategy.asset_key,
            live_enabled,
            True,
        )
        created_folders.append(folder)

    helpers.rewrite_strategy_loader()

    print(f"Materialized {len(created_folders)} opposite strategies")
    for folder in created_folders:
        print(folder)


if __name__ == "__main__":
    main()
