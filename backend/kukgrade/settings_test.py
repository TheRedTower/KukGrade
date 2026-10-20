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

import atexit
import os
import shutil
import tempfile

os.environ.setdefault("DJANGO_DEBUG", "true")
os.environ.setdefault(
    "DJANGO_SECRET_KEY",
    "test-only-secret-key-not-used-outside-the-test-suite",
)
# Uploaded test files go to a throwaway directory, removed when the run
# ends, never the development server's upload folder.
_UPLOAD_ROOT = tempfile.mkdtemp(prefix="kukgrade-test-uploads-")
atexit.register(shutil.rmtree, _UPLOAD_ROOT, ignore_errors=True)
os.environ["KUKGRADE_IMPORT_UPLOAD_ROOT"] = _UPLOAD_ROOT

from kukgrade.settings import *  # noqa: E402,F403
from kukgrade.settings import REST_FRAMEWORK  # noqa: E402

# Every scoped throttle's cache key is scope+IP, and the test client always
# uses the same IP, so the production rate would make one test's attempts
# start failing others' with 429. Raised here so the throttle classes still
# run on every request; a dedicated test lowers each back down with
# patch.object(ScopedRateThrottle, "THROTTLE_RATES", ...) to actually
# exercise the limit.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_THROTTLE_RATES": {
        "login": "1000/min",
        "password_change": "1000/min",
        "setup": "1000/min",
    },
}
