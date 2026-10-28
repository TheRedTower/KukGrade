"""The credits are written from what a build contains, never typed."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from django.core.management import CommandError, call_command
from rest_framework.test import APIClient

from about.credits import (
    CREDITS_FILE,
    NOTICES_FILE,
    _node_homepage,
    node_packages,
    python_packages,
    write_credits,
)
from accounts.models import User

pytestmark = pytest.mark.django_db

PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"


def signed_in() -> APIClient:
    user = User.objects.create_user(email="credits@example.com", password="x")
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def make_frontend(root: Path) -> Path:
    (root / "package.json").write_text(json.dumps({"dependencies": {"react": "^19"}}))
    (root / "package-lock.json").write_text(
        json.dumps(
            {
                "packages": {
                    "": {"name": "kukgrade-frontend"},
                    "node_modules/react": {"version": "19.0.0", "license": "MIT"},
                    "node_modules/scheduler": {"version": "0.25.0", "license": "MIT"},
                    "node_modules/eslint": {
                        "version": "9.0.0",
                        "license": "MIT",
                        "dev": True,
                    },
                },
            },
        ),
    )
    for name, _version, text in (
        ("react", "19.0.0", "React licence"),
        ("scheduler", "0.25.0", "S"),
    ):
        folder = root / "node_modules" / name
        folder.mkdir(parents=True)
        (folder / "package.json").write_text(
            json.dumps(
                {
                    "name": name,
                    "description": f"The {name} package.",
                    "homepage": f"https://{name}.example",
                }
            ),
        )
        (folder / "LICENSE").write_text(text)
    return root


def test_the_server_packages_named_directly_are_listed_with_their_licences() -> None:
    direct, everything = python_packages(PYPROJECT)

    names = {package.name.lower() for package in direct}
    assert {"django", "djangorestframework", "gunicorn"} <= names
    django = next(package for package in direct if package.name.lower() == "django")
    assert django.licence == "BSD-3-Clause"
    assert django.summary and django.texts
    # A package only the direct ones need is shipped, so it is in the notices.
    assert len(everything) > len(direct)
    assert "pytest" not in {package.name.lower() for package in everything}


def test_a_package_reached_through_an_extra_is_shipped_too() -> None:
    _, everything = python_packages(PYPROJECT)

    assert "psycopg-binary" in {package.name.lower() for package in everything}


def test_the_browser_packages_come_from_the_lock_file_without_the_dev_tools(
    tmp_path: Path,
) -> None:
    direct, everything = node_packages(make_frontend(tmp_path))

    assert [package.name for package in direct] == ["react"]
    assert direct[0].credit() == {
        "name": "react",
        "version": "19.0.0",
        "summary": "The react package.",
        "licence": "MIT",
        "homepage": "https://react.example",
    }
    assert [package.name for package in everything] == ["react", "scheduler"]


def test_a_browser_package_without_a_home_page_is_linked_to_its_repository(
    tmp_path: Path,
) -> None:
    make_frontend(tmp_path)
    (tmp_path / "node_modules" / "react" / "package.json").write_text(
        json.dumps(
            {"repository": {"url": "git+https://github.com/facebook/react.git"}}
        ),
    )

    direct, _ = node_packages(tmp_path)

    assert direct[0].homepage == "https://github.com/facebook/react"


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("remarkjs/react-markdown", "https://github.com/remarkjs/react-markdown"),
        ("github:owner/repo", "https://github.com/owner/repo"),
        (
            "git+https://github.com/facebook/react.git",
            "https://github.com/facebook/react",
        ),
        ("git://github.com/o/r.git", "https://github.com/o/r"),
        ("git+ssh://git@github.com/o/r.git", "https://github.com/o/r"),
        ("git@github.com:o/r.git", "https://github.com/o/r"),
        ("http://insecure.example/x", ""),
        ("", ""),
    ],
)
def test_a_repository_address_becomes_a_web_address(given: str, expected: str) -> None:
    assert _node_homepage({"repository": given}) == expected


def test_a_lock_entry_that_is_a_link_is_left_out(tmp_path: Path) -> None:
    make_frontend(tmp_path)
    lock = json.loads((tmp_path / "package-lock.json").read_text())
    lock["packages"]["node_modules/kukgrade-local"] = {"resolved": "../x", "link": True}
    (tmp_path / "package-lock.json").write_text(json.dumps(lock))

    _, everything = node_packages(tmp_path)

    assert [package.name for package in everything] == ["react", "scheduler"]


def test_nested_copies_of_a_package_are_each_listed_once(tmp_path: Path) -> None:
    make_frontend(tmp_path)
    lock = json.loads((tmp_path / "package-lock.json").read_text())
    nested = {"version": "0.1.0", "license": "MIT"}
    lock["packages"]["node_modules/react/node_modules/scheduler"] = nested
    (tmp_path / "package-lock.json").write_text(json.dumps(lock))

    _, everything = node_packages(tmp_path)

    assert [(p.name, p.version) for p in everything] == [
        ("react", "19.0.0"),
        ("scheduler", "0.1.0"),
        ("scheduler", "0.25.0"),
    ]


def test_naming_a_frontend_that_is_missing_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(CommandError, match="package-lock.json"):
        call_command("write_credits", output=tmp_path, frontend=tmp_path / "none")


def test_writing_the_credits_makes_the_list_and_the_notices(tmp_path: Path) -> None:
    output = tmp_path / "out"
    web = tmp_path / "web"
    web.mkdir()

    write_credits(output, PYPROJECT, make_frontend(web))

    listed = json.loads((output / CREDITS_FILE).read_text())
    assert {credit["name"].lower() for credit in listed["server"]} >= {
        "django",
        "gunicorn",
    }
    assert [credit["name"] for credit in listed["browser"]] == ["react"]
    notices = (output / NOTICES_FILE).read_text()
    assert "React licence" in notices
    assert "Licence: BSD-3-Clause" in notices


def test_the_command_writes_where_it_is_told(tmp_path: Path) -> None:
    call_command("write_credits", output=tmp_path)

    assert (tmp_path / CREDITS_FILE).is_file()
    assert (tmp_path / NOTICES_FILE).is_file()


def test_a_checkout_without_credits_says_so(settings: Any, tmp_path: Path) -> None:
    settings.CREDITS_DIR = tmp_path

    client = signed_in()
    served = client.get("/api/about/credits/").json()

    assert served == {"available": False, "server": [], "browser": []}
    assert client.get("/api/about/credits/notices/").status_code == 404


def test_the_credits_and_notices_are_served_once_written(
    settings: Any, tmp_path: Path
) -> None:
    settings.CREDITS_DIR = tmp_path
    write_credits(tmp_path, PYPROJECT, None)

    client = signed_in()
    served = client.get("/api/about/credits/").json()
    notices = client.get("/api/about/credits/notices/")

    assert served["available"] is True
    assert any(credit["name"].lower() == "django" for credit in served["server"])
    assert notices.status_code == 200
    assert notices["Content-Type"].startswith("text/plain")
    assert b"Django" in b"".join(notices.streaming_content)  # type: ignore[attr-defined]


def test_the_credits_are_for_people_who_are_signed_in() -> None:
    assert APIClient().get("/api/about/credits/").status_code in {401, 403}
    assert APIClient().get("/api/about/credits/notices/").status_code in {401, 403}
