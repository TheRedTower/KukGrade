"""Each assessment item's single note becomes the first comment on it.

An item used to carry one note that every save overwrote. Comments replace it
(2026-11-04, marking workflow), so what is written there is kept as a comment
rather than lost. A note carried no author of its own, so it is credited to the
person the record says wrote it: whoever last saved that exact note, as the
audit trail has it; failing that, whoever marked the item; failing that, the
Deleted user account, which holds history whose author is no longer known.

The note column stays for now, so this can be undone and nothing is lost if a
comment has to be re-read; nothing writes it any more.
"""

from __future__ import annotations

from typing import Any

from django.db import migrations

# Kept in sync by hand with accounts.models.DELETED_USER_PLACEHOLDER_EMAIL:
# migrations must not import application code.
DELETED_USER_PLACEHOLDER_EMAIL = "deleted-user@kukgrade.internal"


def carry_notes_into_comments(apps: Any, _schema_editor: Any) -> None:
    Item = apps.get_model("gradings", "CandidateAssessmentItem")
    Comment = apps.get_model("gradings", "AssessmentItemComment")
    AuditEvent = apps.get_model("audit", "AuditEvent")
    User = apps.get_model("accounts", "User")
    placeholder = User.objects.filter(email=DELETED_USER_PLACEHOLDER_EMAIL).first()

    for item in Item.objects.exclude(assessor_notes="").iterator():
        author_id = None
        written_at = None
        events = AuditEvent.objects.filter(
            entity_type="CandidateAssessmentItem",
            entity_id=str(item.pk),
            action="ITEM_RESULT_RECORDED",
        ).order_by("-occurred_at", "-pk")
        for event in events:
            after = (event.metadata or {}).get("after") or {}
            if after.get("assessor_notes") == item.assessor_notes and event.actor_id:
                author_id, written_at = event.actor_id, event.occurred_at
                break
        if author_id is None and item.assessor_id:
            author_id = item.assessor_id
            written_at = item.assessed_at or item.updated_at
        if author_id is None:
            if placeholder is None:
                continue
            author_id, written_at = placeholder.pk, item.updated_at
        comment = Comment(item=item, author_id=author_id, body=item.assessor_notes)
        comment.save()
        # auto_now_add stamps "now"; the note was written then, not at the
        # migration. Written past the append-only guards, which apply to the
        # real model, not this historical one.
        Comment.objects.filter(pk=comment.pk).update(created_at=written_at)


class Migration(migrations.Migration):
    dependencies = [
        ("gradings", "0018_item_comments"),
        ("audit", "0009_item_comments"),
        ("accounts", "0005_seed_deleted_user_placeholder"),
    ]

    operations = [
        # The note column is untouched, so going back needs no restoring.
        migrations.RunPython(carry_notes_into_comments, migrations.RunPython.noop),
    ]
