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

# The account deleted users' history is reassigned to. Kept in sync by hand
# with the literal in accounts/migrations/0005_seed_deleted_user_placeholder.py
# - migrations must not import application code.
DELETED_USER_PLACEHOLDER_EMAIL = "deleted-user@kukgrade.internal"
PLACEHOLDER_ACTIVE_MESSAGE = (
    "The deleted-user placeholder holds history only and can never be active."
)


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
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    must_change_password = models.BooleanField(default=False)
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
        if self.is_deleted_user_placeholder and self.is_active:
            raise ValidationError({"is_active": [PLACEHOLDER_ACTIVE_MESSAGE]})

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.email = User.objects.normalize_email(self.email)
        # Enforced here as well as in clean(): an active placeholder could be
        # signed into, and anything it did would read as "a deleted user".
        if self.is_deleted_user_placeholder and self.is_active:
            raise ValidationError({"is_active": [PLACEHOLDER_ACTIVE_MESSAGE]})
        super().save(*args, **kwargs)

    @property
    def is_deleted_user_placeholder(self) -> bool:
        return self.email == DELETED_USER_PLACEHOLDER_EMAIL

    def __str__(self) -> str:
        return self.email

    def get_full_name(self) -> str:
        full_name = f"{self.first_name} {self.last_name}".strip()
        return full_name or self.email

    def get_short_name(self) -> str:
        return self.first_name or self.email
