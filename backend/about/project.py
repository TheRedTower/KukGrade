"""Facts about the project itself, written once.

The About screens, the sidebar and the support details take these from the
server, so nothing in the frontend repeats them. `about/test_project.py` fails if the
licence written here, in `pyproject.toml`, `frontend/package.json`, the `Dockerfile`
or the publish workflow ever disagree, or the README stops naming the copyright holder.
"""

from __future__ import annotations

NAME = "KukGrade"
REPOSITORY_URL = "https://github.com/TheRedTower/KukGrade"
ISSUES_URL = f"{REPOSITORY_URL}/issues"
RELEASES_URL = f"{REPOSITORY_URL}/releases"

# An SPDX identifier. "only" is deliberate: it is the version the LICENSE file holds.
LICENCE_ID = "AGPL-3.0-only"
COPYRIGHT_NOTICE = "Copyright © 2026 TheRedTower"

# Both forward to the project's inbox (support: questions and conduct reports;
# security: vulnerability reports, see SECURITY.md).
SUPPORT_EMAIL = "support@kukgrade.co.uk"
SECURITY_EMAIL = "security@kukgrade.co.uk"
