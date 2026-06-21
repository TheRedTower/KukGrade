from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone


class Student(models.Model):
    wksa_id = models.CharField(max_length=32, unique=True)
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150)
    date_of_birth = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["last_name", "first_name", "wksa_id"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(wksa_id=""),
                name="student_wksa_id_not_blank",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.first_name} {self.last_name} ({self.wksa_id})"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.wksa_id = (self.wksa_id or "").strip()
        self.first_name = (self.first_name or "").strip()
        self.last_name = (self.last_name or "").strip()

        errors: dict[str, list[str]] = {}
        if not self.wksa_id:
            errors["wksa_id"] = ["WKSA ID is required."]
        if not self.first_name:
            errors["first_name"] = ["First name is required."]
        if not self.last_name:
            errors["last_name"] = ["Last name is required."]
        if self.date_of_birth and self.date_of_birth > timezone.localdate():
            errors["date_of_birth"] = ["Date of birth cannot be in the future."]

        if errors:
            raise ValidationError(errors)
