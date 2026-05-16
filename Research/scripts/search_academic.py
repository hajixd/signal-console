from __future__ import annotations

import subprocess
import sys
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent


def main() -> None:
    subprocess.run(
        [
            sys.executable,
            str(SCRIPT_ROOT / "search_internet.py"),
            "--topic",
            "session_effects",
            "--topic",
            "academic_futures",
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
