"""PostgreSQL's two search extensions, which every search box relies on.

`unaccent` so a name is found without its accents, and `pg_trgm` so a word is
found by likeness (a slip of the keyboard). Both ship with PostgreSQL and are
"trusted": the role that owns the database may turn them on, so neither the
container's own database nor a hosted one needs a superuser for this.
"""

from __future__ import annotations

from django.contrib.postgres.operations import TrigramExtension, UnaccentExtension
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0008_setupcode"),
    ]

    operations = [
        UnaccentExtension(),
        TrigramExtension(),
    ]
