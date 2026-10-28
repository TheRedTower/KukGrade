"""The licence is written once in code and must match everywhere it is declared."""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

from about import project

REPOSITORY = Path(__file__).resolve().parent.parent.parent


def test_the_licence_is_the_same_in_every_place_it_is_declared() -> None:
    pyproject = tomllib.loads((REPOSITORY / "backend" / "pyproject.toml").read_text())
    package = json.loads((REPOSITORY / "frontend" / "package.json").read_text())
    dockerfile = (REPOSITORY / "Dockerfile").read_text()
    image = re.search(r'org\.opencontainers\.image\.licenses="([^"]+)"', dockerfile)

    assert pyproject["project"]["license"] == project.LICENCE_ID
    assert package["license"] == project.LICENCE_ID
    assert image is not None and image[1] == project.LICENCE_ID
    workflow = (REPOSITORY / ".github" / "workflows" / "publish.yml").read_text()
    annotation = re.search(r"org\.opencontainers\.image\.licenses=(\S+)", workflow)
    assert annotation is not None and annotation[1] == project.LICENCE_ID


def test_the_licence_file_is_the_affero_licence_version_three() -> None:
    text = (REPOSITORY / "LICENSE").read_text()

    assert "GNU AFFERO GENERAL PUBLIC LICENSE" in text
    assert "Version 3, 19 November 2007" in text


def test_the_readme_names_the_copyright_holder() -> None:
    assert project.COPYRIGHT_NOTICE in (REPOSITORY / "README.md").read_text()
