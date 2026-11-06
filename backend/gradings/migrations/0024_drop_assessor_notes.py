"""The old single note on an assessment item goes.

Release candidate 8 turned each item's note into the first comment on it
(0019) and stopped writing the column. It has stayed one release so that going
back needed no restoring. Nothing reads or writes it now.

Before it is dropped, any note that is still only in the column is carried into
a comment, so nothing is lost. That is a note whose comment is missing: written
by an older version running against a database already past 0019, for example.
It is credited as 0019 credits a note: to whoever the audit trail says last
changed it to what it now says (and as of then), failing that whoever marked the
item, failing that the Deleted user account. A note whose comment already
exists is left alone, and a note with nobody to credit it to is refused rather
than dropped, since dropping the column is the one step here that cannot be
undone from the data.
"""

from __future__ import annotations

from typing import Any

from django.db import migrations

# Kept in sync by hand with accounts.models.DELETED_USER_PLACEHOLDER_EMAIL:
# migrations must not import application code.
DELETED_USER_PLACEHOLDER_EMAIL = "deleted-user@kukgrade.internal"


def carry_what_is_left(apps: Any, _schema_editor: Any) -> None:
    Item = apps.get_model("gradings", "CandidateAssessmentItem")
    Comment = apps.get_model("gradings", "AssessmentItemComment")
    AuditEvent = apps.get_model("audit", "AuditEvent")
    User = apps.get_model("accounts", "User")
    placeholder = User.objects.filter(email=DELETED_USER_PLACEHOLDER_EMAIL).first()

    stranded = []
    for item in Item.objects.exclude(assessor_notes="").iterator():
        if Comment.objects.filter(item=item, body=item.assessor_notes).exists():
            continue
        author_id = None
        written_at = None
        events = AuditEvent.objects.filter(
            entity_type="CandidateAssessmentItem",
            entity_id=str(item.pk),
            action="ITEM_RESULT_RECORDED",
        ).order_by("-occurred_at", "-pk")
        for event in events:
            before = (event.metadata or {}).get("before") or {}
            after = (event.metadata or {}).get("after") or {}
            # Every result change also carried the note as it stood, so the
            # note must differ before and after to have been written by it.
            changed_the_note = (
                after.get("assessor_notes") == item.assessor_notes
                and before.get("assessor_notes") != item.assessor_notes
            )
            if changed_the_note and event.actor_id:
                author_id, written_at = event.actor_id, event.occurred_at
                break
        if author_id is None and item.assessor_id:
            author_id = item.assessor_id
            written_at = item.assessed_at or item.updated_at
        if author_id is None and placeholder is not None:
            author_id, written_at = placeholder.pk, item.updated_at
        if author_id is None:
            stranded.append(item.pk)
            continue
        comment = Comment(item=item, author_id=author_id, body=item.assessor_notes)
        comment.save()
        # auto_now_add stamps "now"; the note was written then. Written past the
        # append-only guards, which apply to the real model, not this one.
        Comment.objects.filter(pk=comment.pk).update(created_at=written_at)
    if stranded:
        msg = (
            f"{len(stranded)} assessment item note(s) have no comment and nobody "
            f"to credit (items {stranded[:10]}). They are not dropped: add a "
            "comment for each, or restore the Deleted user account, and run "
            "the migration again."
        )
        raise RuntimeError(msg)


class Migration(migrations.Migration):
    dependencies = [
        ("gradings", "0023_archive_sessions"),
        ("accounts", "0005_seed_deleted_user_placeholder"),
    ]

    operations = [
        # Going back re-adds an empty column; the notes themselves are comments.
        migrations.RunPython(carry_what_is_left, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="candidateassessmentitem",
            name="assessor_notes",
        ),
    ]
