"""Sign-in, with expired temporary passwords refused.

Django runs `user_can_authenticate` both when a password is checked - the
API's sign-in and the admin site's - and when a session's user is loaded on
every later request. So an expired temporary password can neither sign in nor
keep using a session it opened; the owner needs a new one from an
administrator.

The refusal is the same as a wrong password's, by design: telling the two
apart would confirm the password was right.
"""

from __future__ import annotations

from django.contrib.auth.backends import ModelBackend
from django.contrib.auth.models import AnonymousUser

from accounts.models import User


class AccountBackend(ModelBackend):
    def user_can_authenticate(self, user: User | AnonymousUser | None) -> bool:
        if isinstance(user, User) and user.temporary_password_expired:
            return False
        return super().user_can_authenticate(user)
