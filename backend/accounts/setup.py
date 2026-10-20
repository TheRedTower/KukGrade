"""Setting up a new deployment: its first administrator, from the setup page.

There is no default password anywhere. While no superuser exists, every
server start issues a one-time setup code and writes it to the server's own
log (`issue_setup_code`, run by the container's entrypoint) - which only the
host's owner can read. The setup page asks for that code with the first
administrator's email, name and password; `complete_setup` checks the code,
holds the password to the policy every password meets, and creates a
superuser with every permission (decision log, 2026-10-19 amendment 10, and
2026-10-20). So whoever reaches the site first cannot claim it.

The code is 12 characters from an alphabet without look-alikes (about 56
bits), kept only as a SHA-256 hash, valid for SETUP_CODE_LIFETIME, used once,
and the endpoint that takes it is rate-limited like sign-in. A restart
replaces it. Once an administrator exists every code is gone and setup is
refused for good; later accounts come from the Users screen.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import timedelta

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from accounts.models import SetupCode, User
from audit.models import AuditAction
from audit.recording import record

security_logger = logging.getLogger("kukgrade.security")

SETUP_CODE_LIFETIME = timedelta(hours=24)
SETUP_CODE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY34679"
SETUP_CODE_LENGTH = 12

ALREADY_SET_UP_MESSAGE = (
    "KukGrade is already set up. Add further accounts from the Users screen."
)
WRONG_CODE_MESSAGE = "That setup code is not right. Use the one in the server's log."
EXPIRED_CODE_MESSAGE = (
    "That setup code has expired. Restart KukGrade for a new one in its log."
)


def setup_needed() -> bool:
    return not User.objects.filter(is_superuser=True).exists()


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def _normalise(code: str) -> str:
    # As shown, in groups of four - but typed with or without the hyphens.
    return "".join(code.split()).replace("-", "").upper()


@transaction.atomic
def issue_setup_code() -> str | None:
    """A fresh code replacing any earlier one, or None once set up."""
    SetupCode.objects.all().delete()
    if not setup_needed():
        return None
    code = "".join(
        secrets.choice(SETUP_CODE_ALPHABET) for _ in range(SETUP_CODE_LENGTH)
    )
    SetupCode.objects.create(
        code_hash=_hash(code),
        expires_at=timezone.now() + SETUP_CODE_LIFETIME,
    )
    return "-".join(code[i : i + 4] for i in range(0, SETUP_CODE_LENGTH, 4))


@transaction.atomic
def complete_setup(
    *,
    code: str,
    email: str,
    password: str,
    first_name: str = "",
    last_name: str = "",
) -> User:
    """Create the first administrator, given the setup code.

    The code's row is locked first, so two requests holding it cannot both
    pass: the second waits, then finds it gone.
    """
    stored = SetupCode.objects.select_for_update().first()
    if not setup_needed():
        raise ValidationError({"code": [ALREADY_SET_UP_MESSAGE]})
    if stored is None or not secrets.compare_digest(
        stored.code_hash,
        _hash(_normalise(code)),
    ):
        security_logger.warning("Failed setup attempt for %s", email)
        raise ValidationError({"code": [WRONG_CODE_MESSAGE]})
    if stored.expires_at <= timezone.now():
        raise ValidationError({"code": [EXPIRED_CODE_MESSAGE]})

    email = User.objects.normalize_email(email)
    candidate = User(email=email, first_name=first_name, last_name=last_name)
    try:
        validate_password(password, candidate)
    except ValidationError as refused:
        raise ValidationError({"password": refused.messages}) from refused

    user = User.objects.create_superuser(
        email=email,
        password=password,
        first_name=first_name,
        last_name=last_name,
    )
    stored.delete()
    record(
        AuditAction.USER_CREATED,
        user,
        f"First administrator {user.email} set up.",
        metadata={"role": user.role, "superuser": True},
    )
    return user
