from __future__ import annotations

import uuid
from typing import Any, ClassVar

from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from django.db import models
from django.utils import timezone


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
    can_make_final_grading_decision = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    EMAIL_FIELD: ClassVar[str] = "email"
    USERNAME_FIELD: ClassVar[str] = "email"
    REQUIRED_FIELDS: ClassVar[list[str]] = []

    class Meta:
        ordering = ["email"]

    def clean(self) -> None:
        super().clean()
        self.email = User.objects.normalize_email(self.email)

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.email = User.objects.normalize_email(self.email)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.email

    def get_full_name(self) -> str:
        full_name = f"{self.first_name} {self.last_name}".strip()
        return full_name or self.email

    def get_short_name(self) -> str:
        return self.first_name or self.email
