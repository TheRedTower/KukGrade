"""Who KukGrade is built on, written when an image is built.

`write_credits` reads what the build really contains: the server's Python
packages from the installed environment and the browser's packages from the
frontend's lock file. It writes two files:

- `credits.json`: the packages KukGrade names directly, each with its
  one-line summary and licence, for the Credits screen.
- `THIRD_PARTY_NOTICES.txt`: every Python and browser package shipped, with its
  licence text, which most licences ask to be kept with copies.

Nothing here is typed by hand, so the lists cannot drift from the image.
"""

from __future__ import annotations

import json
import re
import tomllib
from dataclasses import dataclass, field
from importlib import metadata
from pathlib import Path

CREDITS_FILE = "credits.json"
NOTICES_FILE = "THIRD_PARTY_NOTICES.txt"

_LICENCE_FILE = re.compile(r"(?i)(?:^|/)(?:licen[cs]e|copying|notice)[^/]*$")
_REQUIREMENT = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[([^\]]*)\])?")
_EXTRA_MARKER = re.compile(r"""extra\s*==\s*['"]([^'"]+)['"]""")


@dataclass
class Package:
    name: str
    version: str
    summary: str
    licence: str
    homepage: str
    texts: list[str] = field(default_factory=list)

    def credit(self) -> dict[str, str]:
        return {
            "name": self.name,
            "version": self.version,
            "summary": self.summary,
            "licence": self.licence,
            "homepage": self.homepage,
        }


def _normalise(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _requirement(spec: str) -> tuple[str, set[str]]:
    match = _REQUIREMENT.match(spec)
    if match is None:
        msg = f"Cannot read the requirement {spec!r}."
        raise ValueError(msg)
    extras = {_normalise(e) for e in (match[2] or "").split(",") if e.strip()}
    return _normalise(match[1]), extras


def _licence(meta: metadata.PackageMetadata) -> str:
    expression = (meta.get("License-Expression") or "").strip()
    if expression:
        return str(expression)
    declared = (meta.get("License") or "").strip()
    if declared and "\n" not in declared and len(declared) <= 60:
        return str(declared)
    for classifier in meta.get_all("Classifier") or []:
        parts = [part.strip() for part in classifier.split("::")]
        if parts[0] == "License" and parts[-1] != "OSI Approved":
            return str(parts[-1])
    return "Not stated"


def _homepage(meta: metadata.PackageMetadata) -> str:
    if meta.get("Home-page"):
        return str(meta["Home-page"])
    urls: dict[str, str] = {}
    for entry in meta.get_all("Project-URL") or []:
        label, _, url = entry.partition(",")
        urls.setdefault(label.strip().lower(), url.strip())
    for label in ("homepage", "home", "source", "repository", "documentation"):
        if label in urls:
            return urls[label]
    return next(iter(urls.values()), "")


def _node_homepage(own: dict[str, object]) -> str:
    """A package's home page, or failing that its repository's address."""
    if own.get("homepage"):
        return str(own["homepage"])
    repository = own.get("repository")
    url = repository.get("url") if isinstance(repository, dict) else repository
    if not isinstance(url, str):
        return ""
    url = url.strip().removesuffix(".git")
    # npm's shorthand: "owner/repo", or "github:owner/repo".
    shorthand = re.fullmatch(r"(?:github:)?([\w.-]+/[\w.-]+)", url)
    if shorthand:
        return f"https://github.com/{shorthand[1]}"
    # "git+https://host/x", "git://host/x", "git+ssh://git@host/x", "git@host:x".
    url = re.sub(r"^git\+", "", url)
    url = re.sub(r"^(?:git|ssh)://(?:git@)?", "https://", url)
    url = re.sub(r"^git@([^:/]+):", r"https://\1/", url)
    return url if url.startswith("https://") else ""


def _python_package(dist: metadata.Distribution) -> Package:
    texts = []
    for file in dist.files or []:
        if ".dist-info/" in file.as_posix() and _LICENCE_FILE.search(file.as_posix()):
            path = Path(str(dist.locate_file(file)))
            if path.is_file():
                texts.append(path.read_text(encoding="utf-8", errors="replace").strip())
    return Package(
        name=dist.metadata["Name"],
        version=dist.version,
        summary=(dist.metadata.get("Summary") or "").strip(),
        licence=_licence(dist.metadata),
        homepage=_homepage(dist.metadata),
        texts=texts,
    )


def _direct_requirements(pyproject: Path) -> list[str]:
    return list(tomllib.loads(pyproject.read_text())["project"]["dependencies"])


def python_packages(pyproject: Path) -> tuple[list[Package], list[Package]]:
    """The directly named packages, and all that are shipped, both sorted."""
    wanted: dict[str, set[str]] = {}
    direct = set()
    for spec in _direct_requirements(pyproject):
        name, extras = _requirement(spec)
        direct.add(name)
        wanted.setdefault(name, set()).update(extras)

    found: dict[str, metadata.Distribution] = {}
    while True:
        before = {name: set(extras) for name, extras in wanted.items()}
        for name, extras in list(wanted.items()):
            try:
                dist = found.get(name) or metadata.distribution(name)
            except metadata.PackageNotFoundError:
                continue
            found[name] = dist
            for spec in dist.requires or []:
                requirement, _, marker = spec.partition(";")
                needed = {_normalise(e) for e in _EXTRA_MARKER.findall(marker)}
                if needed and not needed & extras:
                    continue
                child, child_extras = _requirement(requirement)
                wanted.setdefault(child, set()).update(child_extras)
        if wanted == before:
            break

    packages = {name: _python_package(dist) for name, dist in found.items()}
    by_name = sorted(packages.items(), key=lambda item: item[1].name.lower())
    return (
        [package for name, package in by_name if name in direct],
        [package for _, package in by_name],
    )


def node_packages(frontend: Path) -> tuple[list[Package], list[Package]]:
    """As `python_packages`, for the browser's packages, from the lock file."""
    direct_names = set(
        json.loads((frontend / "package.json").read_text())["dependencies"]
    )
    lock = json.loads((frontend / "package-lock.json").read_text())["packages"]

    direct: dict[str, Package] = {}
    everything: dict[tuple[str, str], Package] = {}
    for key, entry in lock.items():
        if not key.startswith("node_modules/") or entry.get("dev") or entry.get("link"):
            continue
        name = key.rsplit("node_modules/", 1)[1]
        folder = frontend / key
        own = {}
        if (folder / "package.json").is_file():
            own = json.loads((folder / "package.json").read_text())
        texts = [
            path.read_text(encoding="utf-8", errors="replace").strip()
            for path in sorted(folder.glob("*"))
            if path.is_file() and _LICENCE_FILE.search(path.name)
        ]
        package = Package(
            name=name,
            version=entry["version"],
            summary=(own.get("description") or "").strip(),
            licence=str(entry.get("license") or own.get("license") or "Not stated"),
            homepage=_node_homepage(own),
            texts=texts,
        )
        everything[(name, package.version)] = package
        if key == f"node_modules/{name}" and name in direct_names:
            direct[name] = package

    ordered = sorted(
        everything.values(), key=lambda package: (package.name.lower(), package.version)
    )
    return sorted(direct.values(), key=lambda p: p.name.lower()), ordered


def _notices(packages: list[Package]) -> str:
    lines = [
        "Third-party Python and browser packages shipped with KukGrade",
        "============================================================",
        "",
        "KukGrade itself is licensed under its own LICENSE. It includes the",
        "packages below, each under the licence named, whose text follows.",
        "",
    ]
    for package in packages:
        lines += [f"{package.name} {package.version}", f"Licence: {package.licence}"]
        if package.homepage:
            lines.append(package.homepage)
        lines.append("")
        lines += package.texts or ["(This package ships no licence text.)"]
        lines += ["", "-" * 72, ""]
    return "\n".join(lines)


def write_credits(output: Path, pyproject: Path, frontend: Path | None) -> None:
    server_direct, server_all = python_packages(pyproject)
    browser_direct: list[Package] = []
    browser_all: list[Package] = []
    if frontend is not None:
        browser_direct, browser_all = node_packages(frontend)

    output.mkdir(parents=True, exist_ok=True)
    (output / CREDITS_FILE).write_text(
        json.dumps(
            {
                "server": [package.credit() for package in server_direct],
                "browser": [package.credit() for package in browser_direct],
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    (output / NOTICES_FILE).write_text(
        _notices(server_all + browser_all), encoding="utf-8"
    )
