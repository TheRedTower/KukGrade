from __future__ import annotations

import uuid
from typing import Any, ClassVar

from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from ranks.models import Rank

ADMINISTRATOR_RANK_MESSAGE = "An administrator account has no rank."
STAFF_RANK_MESSAGE = "Choose one of the instructor ranks."


class UserManager(BaseUserManager["User"]):
    """Manager for email-first KukGrade staff accounts."""

    @classmethod
    def normalize_email(cls, email: str | None) -> str:
        email = super().normalize_email(email)
        return email.strip().lower() if email else ""

    def create_user(
        self,
        email: str,
        password: str | None = None,
        **extra_fields: Any,
    ) -> User:
        if not email:
            msg = "The email address must be set."
            raise ValueError(msg)
        user = self.model(email=self.normalize_email(email), **extra_fields)
        user.set_password(password)
        user.full_clean(exclude=["password"])
        user.save(using=self._db)
        return user

    def create_superuser(
        self,
        email: str,
        password: str | None = None,
        **extra_fields: Any,
    ) -> User:
        extra_fields.setdefault("role", User.Role.ADMINISTRATOR)
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        if extra_fields.get("is_staff") is not True:
            msg = "Superuser must have is_staff=True."
            raise ValueError(msg)
        if extra_fields.get("is_superuser") is not True:
            msg = "Superuser must have is_superuser=True."
            raise ValueError(msg)

        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        # A label that decides group membership, never consulted when
        # authorising a request. "manager" was removed in 2026-09: nothing
        # used it, and the confirmed policy has instructors and
        # administrators only.
        INSTRUCTOR = "instructor", "Instructor"
        ADMINISTRATOR = "administrator", "Administrator"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    role = models.CharField(
        max_length=32,
        choices=Role.choices,
        default=Role.INSTRUCTOR,
    )
    # An instructor's rank, chosen when the account is made, from the ranks
    # above the syllabus (Rank.objects.staff()). An administrator account has
    # none. What it was when they acted is kept on each record that names
    # them (accounts.people), so a later promotion changes no record.
    rank = models.ForeignKey(
        "ranks.Rank",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="staff_accounts",
    )
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    must_change_password = models.BooleanField(default=False)
    # Set with a temporary password - one somebody other than the owner set -
    # and cleared when the owner chooses their own. Once passed, the account
    # cannot sign in until an administrator issues a new one
    # (accounts/backends.py). Null for every password its owner chose.
    temporary_password_expires_at = models.DateTimeField(null=True, blank=True)
    # Set when the account is deleted after recording something: the row stays
    # so their name stays on their records, but it cannot sign in and is
    # hidden from user management (accounts.services.delete_platform_user).
    deleted_at = models.DateTimeField(null=True, blank=True)
    date_joined = models.DateTimeField(default=timezone.now)

    objects: ClassVar[UserManager] = UserManager()

    EMAIL_FIELD: ClassVar[str] = "email"
    USERNAME_FIELD: ClassVar[str] = "email"
    REQUIRED_FIELDS: ClassVar[list[str]] = []

    class Meta:
        ordering = ["email"]

    def clean(self) -> None:
        super().clean()
        self.email = User.objects.normalize_email(self.email)
        if self.rank_id is None:
            return
        if self.role == User.Role.ADMINISTRATOR:
            raise ValidationError({"rank": [ADMINISTRATOR_RANK_MESSAGE]})
        if not Rank.objects.staff().filter(pk=self.rank_id).exists():
            raise ValidationError({"rank": [STAFF_RANK_MESSAGE]})

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.email = User.objects.normalize_email(self.email)
        super().save(*args, **kwargs)

    @property
    def temporary_password_expired(self) -> bool:
        expires_at = self.temporary_password_expires_at
        return expires_at is not None and expires_at <= timezone.now()

    def __str__(self) -> str:
        return self.email

    def get_full_name(self) -> str:
        full_name = f"{self.first_name} {self.last_name}".strip()
        return full_name or self.email

    def get_short_name(self) -> str:
        return self.first_name or self.email


class SetupCode(models.Model):
    """The one-time code that proves who sets up a new deployment.

    While no administrator exists, each server start issues one and writes
    it to the server's own log, which only the host's owner can read; the
    setup page asks for it with the first administrator's details
    (accounts/setup.py). Only its hash is kept, at most one row exists, and
    it is deleted the moment setup succeeds.
    """

    code_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Setup code, expires {self.expires_at:%Y-%m-%d %H:%M}"
