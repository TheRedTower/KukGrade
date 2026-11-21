"""The project's own documents, read from the files they live in.

The licence, the code of conduct and the security policy are the repository's
`LICENSE`, `CODE_OF_CONDUCT.md` and `SECURITY.md`; the image carries copies
(`KUKGRADE_DOCUMENTS_DIR`). Nothing is retyped for the screens, so what a
person reads in the app is what the repository says.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from django.conf import settings
from django.http import Http404

from about.project import REPOSITORY_URL


@dataclass(frozen=True)
class Document:
    slug: str
    title: str
    filename: str
    format: Literal["text", "markdown"]


DOCUMENTS = {
    document.slug: document
    for document in (
        Document("licence", "Licence", "LICENSE", "text"),
        Document(
            "code-of-conduct", "Code of conduct", "CODE_OF_CONDUCT.md", "markdown"
        ),
        Document("security", "Security", "SECURITY.md", "markdown"),
    )
}

PLEDGE_FILE = Path(__file__).resolve().parent / "pledge.json"


def read_document(slug: str) -> dict[str, str]:
    document = DOCUMENTS.get(slug)
    if document is None:
        raise Http404
    path = Path(settings.ABOUT_DOCUMENTS_DIR) / document.filename
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise Http404 from None
    return {
        "slug": document.slug,
        "title": document.title,
        "format": document.format,
        "content": content.strip("\n"),
        "source_url": f"{REPOSITORY_URL}/blob/HEAD/{document.filename}",
    }


def read_pledge() -> dict[str, object]:
    pledge: dict[str, object] = json.loads(PLEDGE_FILE.read_text(encoding="utf-8"))
    return pledge
