"""Private temporary storage for uploaded import source files.

Never wired to `MEDIA_URL` or served statically - a source file holds
personal data (student names, dates of birth) and is only ever read
server-side, between upload and commit/cancel/expiry. `IMPORT_UPLOAD_ROOT`
must be a persistent volume in any deployment, the same requirement the
database's own data directory already has - see the deployment note in
docs/data-import-and-legacy-migration.md once it exists.

The storage backend itself is the "import_uploads" alias registered in
`kukgrade.settings.STORAGES`, resolved through `import_upload_storage()`
below rather than a `FileSystemStorage(...)` instance constructed directly
here - see the comment on `ImportBatch.source_file` for why.
"""

from __future__ import annotations

import uuid
from pathlib import PurePosixPath
from typing import TYPE_CHECKING

from django.core.files.storage import Storage, storages

if TYPE_CHECKING:
    from data_imports.models import ImportBatch


def import_upload_storage() -> Storage:
    return storages["import_uploads"]


def import_upload_path(instance: ImportBatch, filename: str) -> str:
    # Unpredictable identifier, not the original filename - see
    # KukGrade_Data_Import_Legacy_Migration_Definitive_Implementation_Spec.md
    # section 11 ("no direct public URL", "unpredictable identifier").
    suffix = PurePosixPath(filename).suffix.lower()
    return f"{uuid.uuid4().hex}{suffix}"
