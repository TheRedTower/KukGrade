"""The one place the application's version is written in code.

`pyproject.toml` and `frontend/package.json` carry the same number for the
tools that read them; `test_about.py` fails if any of the three drift. The
API description, the About page and the sidebar all take it from here.
"""

from __future__ import annotations

VERSION = "0.1.0"
