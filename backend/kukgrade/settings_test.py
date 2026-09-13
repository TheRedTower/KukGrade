"""Test settings for KukGrade.

The production settings module deliberately fails closed: `DEBUG` defaults to
false and a missing `DJANGO_SECRET_KEY` raises `ImproperlyConfigured`. Under
test that would either refuse to start or, worse, turn on `SECURE_SSL_REDIRECT`
so that every request in the suite is answered with a 301 to https.

A root `conftest.py` cannot fix this: pytest imports Django settings before it
loads conftest, so anything set there arrives too late. Setting the environment
here, before the star import below executes, is what makes it work.

The real settings module is still the one under test. Its production branch is
covered explicitly by `kukgrade/tests.py`.
"""

from __future__ import annotations

import os

os.environ.setdefault("DJANGO_DEBUG", "true")
os.environ.setdefault(
    "DJANGO_SECRET_KEY",
    "test-only-secret-key-not-used-outside-the-test-suite",
)

from kukgrade.settings import *  # noqa: E402,F403
