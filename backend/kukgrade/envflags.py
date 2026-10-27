"""Reading a yes/no environment variable, in one place.

Shared by the settings and by the container's start-up (kukgrade/serve.py),
which must agree on what counts as "on": the settings decide how the app runs,
and the start-up decides what is run beside it.
"""

from __future__ import annotations

import os


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}
