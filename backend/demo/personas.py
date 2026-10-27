"""The shared accounts of the demo site.

Anyone may sign in as these: the password is published on the sign-in screen
(`/api/site/`), because the demo holds only made-up data. They are ordinary
accounts with ordinary permissions - none is a superuser - so the demo shows
the real boundaries: an administrator cannot grant themselves the Master's
authority, and an instructor cannot make the final decision.
"""

from __future__ import annotations

from dataclasses import dataclass

from accounts.models import User

DEMO_PASSWORD = "KukGradeDemo2026!"


@dataclass(frozen=True)
class Persona:
    key: str
    email: str
    first_name: str
    last_name: str
    role: str
    label: str
    description: str
    authority: dict[str, bool]


PERSONAS = (
    Persona(
        key="instructor",
        email="instructor@demo.example.com",
        first_name="Ian",
        last_name="Instructor",
        role=User.Role.INSTRUCTOR,
        label="Instructor",
        description=(
            "Builds a grading, assesses candidates and recommends a verdict. "
            "Cannot make the final decision."
        ),
        authority={},
    ),
    Persona(
        key="master",
        email="master@demo.example.com",
        first_name="Mia",
        last_name="Master",
        role=User.Role.INSTRUCTOR,
        label="Master",
        description=(
            "Makes the final decision on each candidate, promotes students and "
            "can reopen a locked grading."
        ),
        authority={
            "can_make_final_grading_decision": True,
            "can_promote_student": True,
            "can_override_locked_session": True,
            "can_view_grading_audit_log": True,
        },
    ),
    Persona(
        key="administrator",
        email="administrator@demo.example.com",
        first_name="Alex",
        last_name="Administrator",
        role=User.Role.ADMINISTRATOR,
        label="Administrator",
        description=(
            "Looks after students, staff accounts and the audit log. Cannot "
            "grade, and cannot grant themselves the Master's authority."
        ),
        authority={},
    ),
)

PERSONA_EMAILS = frozenset(persona.email for persona in PERSONAS)
