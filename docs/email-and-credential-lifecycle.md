# KukGrade Optional Email, Account Onboarding & Credential Lifecycle — Implementation Packet

**Status:** Accepted design / deferred implementation  
**Target timing:** Implement only after the current frontend design register is complete and the existing product is stable at the first production-ready Semantic Versioning release.  
**Recommended release boundary:** **v1.0.0** if that release is the first version KukGrade considers stable, production-ready, and supported for real use.  
**Implementation target:** Post-v1.0.0 feature work unless the project later deliberately changes that release boundary.  
**Primary purpose:** Preserve every finalised decision from the email, account-onboarding, temporary-password, forced-password-change, password-recovery, Resend, and deployment discussion so later implementation can proceed without design drift.

---

## Amendments (2026-10-19)

The owner reviewed this packet against the code on 2026-10-19. Where an
amendment below differs from a later section, **the amendment wins**; the
original text is kept unchanged so the reasoning stays readable. The same
decisions are recorded in `decision_log.md` ("2026-10-19 - Email and
credential lifecycle: the packet as amended").

1. **Timing (§58, §62).** Everything that works with email disabled is built
   now: the signed-in password change, the password policy, generated
   temporary credentials with expiry, and closing the Django admin gap
   (slices 1-4 in "Delivery order" below). The email slices (5-10) wait for
   the readiness condition in §62.
2. **Password policy (§18).** 16 to 64 characters - not 8 to 24 - with every
   other rule unchanged: an uppercase letter, a lowercase letter, a number, a
   special character, no common password, not too similar to the user's own
   details. It applies whenever a password is next set; an existing password
   keeps working until it is changed.
3. **The policy is declared by the server (§18, §47).** The frontend's live
   checklist renders the rule list the server sends; it keeps no copy of the
   rules.
4. **Runtime capability (§8).** `email_enabled` is added to the existing
   public `GET /api/site/` rather than a new `/api/config/`. Email is to be
   treated with particular care throughout.
5. **Expiry and the Django admin site (§14, §17).** Temporary-credential
   expiry is enforced where sign-in is checked, so it covers the API and the
   Django admin site alike; the admin site is also closed while
   `must_change_password` is set.
6. **Generated temporary credentials (§11, §12, §20).** The create-user and
   reset-password dialogs lose their password fields. The server generates a
   policy-compliant temporary password (avoiding look-alike characters),
   returns it exactly once with caching disabled, and stores only its hash.
   The recipient is always made to choose their own password at next
   sign-in, enforced by the server.
7. **Email failure fallback (§39, §48).** If a welcome or reset email cannot
   be sent, the administrator is shown the temporary password once - the
   same dialog as email-disabled mode. Because the forced change is enforced,
   the administrator never knows the password that is finally used. An
   administrator can issue a new temporary password at any time, which
   invalidates the previous one.
8. **Resend SDK (§35).** The official Resend Python package is used, through
   the single transport boundary in §34, with an explicit timeout - its value
   decided at implementation - so a Resend outage cannot hang a request. The
   container health check keeps using the standard library; it is a separate
   job. No rule is held in two places, and one function sends each email.
9. **Forgotten-password eligibility (§23).** Any active account, including
   administrators and accounts still holding a temporary password. Inactive
   accounts receive nothing, with the same public response.
10. **First administrator (§10).** No default password exists anywhere. On a
    new production deployment, setup prompts for the first administrator's
    email address and password; that account is a superuser with every
    permission. Every later account is created through the administrator
    workflow (and the email workflow once enabled). Before production, what
    the Administrator role - not superuser - can and cannot do is mapped
    (`action_plan.md`).
11. **Email tracking (§37).** Checked at implementation against Resend's
    documentation and dashboard.
12. **Commits (§55).** One commit per slice, made only after the owner
    approves the slice.

### Delivery order

| # | Slice | Reasoning effort |
|---|---|---|
| 0 | This packet in the repo; decisions recorded | medium |
| 1 | Signed-in "Change password" for everyone; `set-password` refused on your own account | high |
| 2 | Server-declared password policy (16-64) on every password path | high |
| 3 | Generated temporary credentials, one-time display, expiry, replacement, audit | high |
| 4 | Django admin closed while a change is required | high |
| 5 | Email configuration and transport boundary; fake transport for tests | high |
| 6 | Templates and the welcome, admin-reset and password-changed sends | medium |
| 7 | Forgotten-password request and confirm | high |
| 8 | Frontend: forgot/reset, checklist, one-time dialog, email-failure state | medium |
| 9 | Deployment examples and documentation | medium |
| 10 | End-to-end security review of sign-in and passwords | high |

---

## 1. Executive decision

KukGrade will support **optional transactional email**.

Email must **not** be a hard dependency for deploying or using KukGrade. A deployment with no Resend account or API key must still support administrator-created users, temporary credentials, forced first-login password changes, administrator password resets, and all normal application functionality.

When email is configured, the same account lifecycle is enhanced with welcome, password-reset, password-change, and security notification emails.

The guiding rule is:

> **Email is notification and recovery infrastructure. It is not authoritative account state.**

Failure of an email provider must not roll back or corrupt an otherwise valid account or password operation.

---

## 2. Existing product decisions that remain authoritative

The following existing KukGrade decisions remain unchanged:

- There is **no public self-registration**.
- There is **no Google SSO**.
- Staff accounts are provisioned by KukGrade administrators.
- Students do not directly access the system.
- Authentication remains Django session based.
- Password validation remains a backend responsibility.
- Sensitive account changes remain auditable.
- Frontend hiding or modal behaviour is never the sole security control.
- The frontend consumes backend state; it does not independently decide account authorisation.
- Generated OpenAPI/TypeScript contracts remain part of the normal development workflow.

This packet adds optional email and credential-lifecycle behaviour without overturning those decisions.

---

## 3. Domain and sender identity decisions

The canonical KukGrade domain is:

```text
kukgrade.co.uk
```

The intended public application URL is:

```text
https://kukgrade.co.uk
```

The accepted email identities are:

```text
KukGrade <accounts@kukgrade.co.uk>
KukGrade Security <security@kukgrade.co.uk>
KukGrade Support <support@kukgrade.co.uk>
```

Recommended responsibilities:

### `accounts@kukgrade.co.uk`

Used for automated account and recovery email:

- Welcome / account-created email
- Temporary-password onboarding instructions
- Administrator-reset / password-change-required notification
- Forgotten-password reset email

### `security@kukgrade.co.uk`

Used for security notifications:

- Password changed successfully
- Password reset successfully
- Future account-security alerts if added

### `support@kukgrade.co.uk`

Used for human support correspondence and as the default `Reply-To` address for transactional messages.

---

## 4. Current mail infrastructure decisions

### Resend

Resend is the selected outbound transactional email provider.

The domain `kukgrade.co.uk` has already been added to Resend and verified using Resend's automated Cloudflare DNS setup.

The current DNS/mail posture is therefore:

- Resend sending domain: verified
- DKIM: configured and verified
- SPF / Resend sending-return-path configuration: configured and verified
- DMARC: present with initial monitoring policy
- Resend inbound receiving: not required for this design

Current DMARC posture:

```text
v=DMARC1; p=none;
```

This should remain in monitoring mode initially. It may later be tightened deliberately:

```text
p=none
→ p=quarantine
→ p=reject
```

only after real KukGrade mail has been verified to pass SPF, DKIM, and DMARC consistently.

### No KukGrade mail-server IP is required

KukGrade will send through the Resend API or Resend SMTP. The KukGrade web server is **not** an SMTP server.

Therefore:

- Do not add the KukGrade server IPv4 address to SPF.
- Do not add the KukGrade server IPv6 address to SPF.
- Do not add Clotho, home-network, Cloudflare Tunnel, or other origin addresses to SPF merely because they host KukGrade.
- Resend remains responsible for the actual mail-sending infrastructure.

---

## 5. Current human-support mailbox arrangement

The intended lightweight support arrangement is:

```text
support@kukgrade.co.uk
        ↓
forwarding / inbound routing
        ↓
kukgrade@gmail.com
```

Manual support email can be sent so recipients see:

```text
From: KukGrade Support <support@kukgrade.co.uk>
```

using Resend SMTP as the outbound transport.

The currently accepted operational state is that the existing Resend production key was also used when configuring Gmail's `Send mail as` / SMTP path for `support@kukgrade.co.uk`.

This is acceptable as the current setup, but it is **not ideal credential separation**.

Later hardening may create a dedicated key such as:

```text
KukGrade Support SMTP
```

and reserve:

```text
KukGrade Production
```

for the Django backend only.

This future credential split is a hardening improvement, not a blocker for the application architecture.

The application must not depend on Gmail specifically. Gmail is only an operational support inbox/client.

---

## 6. Optional email deployment model

Email functionality must be explicitly selectable by deployment configuration.

Recommended configuration:

```dotenv
KUKGRADE_EMAIL_BACKEND=disabled
```

Supported values:

```text
disabled
console
resend
```

Meaning:

### `disabled`

- No transactional email is attempted.
- Resend configuration is not required.
- Administrator account provisioning and password-reset workflows remain usable without external email.

### `console`

- Development/test-oriented mode.
- Email is rendered to a safe development transport rather than sent externally.
- Useful for local development and manual inspection.

### `resend`

- Production transactional email is enabled.
- A valid Resend API key and required sender/application configuration are mandatory.

The application should not infer capability solely from whether `RESEND_API_KEY` happens to be non-empty. The mode must be explicit.

If:

```text
KUKGRADE_EMAIL_BACKEND=resend
```

but required Resend configuration is missing, KukGrade should fail fast with a clear configuration error rather than silently degrading.

---

## 7. Recommended environment variables

Production-capable configuration should use server-side environment variables such as:

```dotenv
KUKGRADE_EMAIL_BACKEND=resend

RESEND_API_KEY=re_...

KUKGRADE_PUBLIC_URL=https://kukgrade.co.uk

KUKGRADE_EMAIL_FROM=KukGrade <accounts@kukgrade.co.uk>
KUKGRADE_SECURITY_EMAIL_FROM=KukGrade Security <security@kukgrade.co.uk>
KUKGRADE_EMAIL_REPLY_TO=support@kukgrade.co.uk

KUKGRADE_TEMP_PASSWORD_TTL_HOURS=24
KUKGRADE_PASSWORD_RESET_TIMEOUT_SECONDS=3600
```

Exact names may be refined during implementation, but the capability split and semantics in this packet should remain intact.

### Secret-handling requirements

`RESEND_API_KEY` must never be exposed through:

- React code
- `VITE_*` variables
- OpenAPI output
- generated TypeScript types
- source control
- logs
- client-visible runtime configuration

It is a server-side secret only.

---

## 8. Public runtime capability discovery

The frontend should not be compiled with a hardcoded assumption that email exists.

Recommended approach:

```text
GET /api/config/
```

or an equivalent safe runtime capability endpoint.

Example response:

```json
{
  "email_enabled": true
}
```

Only safe capability flags belong here.

Never expose:

- provider API keys
- SMTP credentials
- secret configuration
- internal provider metadata that is unnecessary to the client

### Frontend behaviour

If email is enabled:

```text
Forgot password?
```

can be shown and can launch the self-service recovery flow.

If email is disabled:

```text
Forgot your password? Contact your KukGrade administrator.
```

or equivalent copy should be shown instead.

---

## 9. User account state additions

KukGrade should add explicit credential-lifecycle state to the user/account model.

At minimum:

```text
must_change_password
temporary_password_expires_at
```

Conceptually:

```python
must_change_password: bool
temporary_password_expires_at: datetime | None
```

### Migration requirement

Existing users must **not** unexpectedly become locked out when this feature is introduced.

The migration must deliberately preserve existing account behaviour.

A safe migration design should ensure:

- existing users migrate to `must_change_password = false`
- newly administrator-created temporary-password accounts use `must_change_password = true`
- existing permanent passwords are not reclassified as temporary

---

## 10. Bootstrap / superuser behaviour

KukGrade may provide or create an initial administrative/superuser account as part of deployment/bootstrap.

However:

- KukGrade must never ship a universal/default hardcoded administrator password.
- Initial credentials must be supplied/generated securely.
- If the initial administrator is created with a bootstrap/temporary password, it should be subject to the same forced-password-change lifecycle.
- The bootstrap administrator should be forced to replace its temporary credential before unrestricted application use.

The same security principle applies to administrators and ordinary staff.

---

## 11. Temporary-password onboarding model

Administrator-created accounts should use **temporary credentials**.

The preferred flow is:

```text
Administrator creates user
        ↓
KukGrade generates cryptographically strong temporary password
        ↓
Django stores only the password hash
        ↓
must_change_password = true
temporary_password_expires_at = <configured expiry>
        ↓
Email-enabled?
   ┌────┴────┐
   │         │
  yes        no
   │         │
   ▼         ▼
Welcome     Show temporary
email       password to admin
            exactly once
        ↓
User signs in
        ↓
Backend sees must_change_password = true
        ↓
User is forced to create permanent password
        ↓
Old temporary credential becomes invalid
        ↓
must_change_password = false
temporary_password_expires_at = null
        ↓
Normal KukGrade access
```

---

## 12. Temporary-password generation

When possible, KukGrade should generate the temporary password automatically rather than asking administrators to invent one.

The generator must use cryptographically secure randomness.

It must satisfy the application's password policy.

Example shape only:

```text
R8!vK4@qT7#mP2xZ
```

The plaintext temporary password must not be persisted.

The database stores only the normal Django password hash.

### Plaintext lifecycle

The plaintext temporary password may exist transiently long enough to:

- hash it
- display it once to the administrator in email-disabled mode, or
- insert it into the welcome email in email-enabled mode

It must not be:

- stored in a database field
- logged
- included in audit-event payloads
- written to application logs
- retained for later retrieval
- exposed through an API after the initial creation response

---

## 13. Temporary password by email — accepted design

For email-enabled deployments, the welcome email **may include the temporary password**.

This is an accepted design decision because it is being treated as a short-lived bootstrap credential with mandatory replacement.

Example content:

> Welcome to KukGrade  
> An administrator has created a KukGrade account for you.  
>  
> Your temporary password is:  
> `R8!vK4@qT7#mP2xZ`  
>  
> This temporary password expires after the configured period and must be replaced the first time you sign in.  
>  
> **Sign in to KukGrade**

The password itself must **never** be included in the URL.

The email button should lead only to a normal navigation destination such as:

```text
https://kukgrade.co.uk/login
```

or a non-secret fragment such as:

```text
https://kukgrade.co.uk/login#welcome
```

The link must not automatically authenticate the user.

---

## 14. Temporary-password expiry

Temporary credentials should expire.

Initial recommendation:

```text
New-account temporary password: 24 hours
Forgot-password reset token: 1 hour
```

Administrator-reset temporary-password expiry may use the same 24-hour setting or a shorter value if the implementation team deliberately chooses one.

The exact values should be configurable.

Expired temporary credentials must fail authentication.

If an initial credential expires, an administrator should be able to generate a replacement.

Generating a replacement must invalidate the previous temporary credential.

---

## 15. Email-disabled onboarding

Email must remain optional.

If email is disabled:

```text
Administrator creates account
        ↓
KukGrade generates temporary password
        ↓
Temporary password shown to administrator exactly once
        ↓
Administrator communicates it securely to user
        ↓
User signs in
        ↓
Forced password change
```

The one-time display should explicitly warn:

> Copy this temporary password now. It will not be shown again.

After the modal/page is closed, KukGrade should not be capable of retrieving the plaintext because only the password hash remains.

---

## 16. Forced first-login password change

`must_change_password = true` is a security state, not merely a UX hint.

After a successful login using a temporary credential:

```text
authenticated = true
must_change_password = true
```

React should immediately display a blocking password-change modal or equivalent forced screen.

Recommended copy:

> **Create your new password**  
> You're currently using a temporary password. Choose a new password before continuing to KukGrade.

Fields:

```text
Current temporary password
New password
Confirm new password
```

---

## 17. Backend enforcement of forced password change

The frontend modal is **not** the security boundary.

While:

```text
must_change_password = true
```

the backend must block ordinary application access.

Recommended small allowlist:

```text
GET  /api/auth/me/
POST /api/auth/change-password/
POST /api/auth/logout/
```

Everything else should be rejected with a stable machine-readable error, for example:

```json
{
  "error": {
    "code": "password_change_required",
    "message": "You must change your password before continuing."
  }
}
```

Exact HTTP status may be chosen consistently with the existing API conventions, but the rule is mandatory:

> A user with `must_change_password = true` must not be able to access normal KukGrade data or actions through direct API calls.

This prevents bypass through:

- browser developer tools
- crafted API requests
- direct HTTP clients
- frontend manipulation

---

## 18. Password policy

The desired password policy is:

- Minimum 8 characters
- Maximum 24 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character
- Reject commonly used passwords
- Reject passwords too similar to user-identifying attributes where Django's normal similarity validator applies

The user has explicitly requested the **8–24 character** range.

The project may later reconsider the maximum length if there is a deliberate security/product decision to support longer passphrases, but implementation should not silently change the accepted range.

### Single source of truth

Password policy must be enforced by Django/backend validation.

Frontend requirements are advisory UX only.

The frontend should display live requirement state such as:

```text
✓ 8–24 characters
✓ Uppercase letter
✓ Lowercase letter
✓ Number
✓ Special character
```

but backend validation remains authoritative.

The same backend policy must apply to:

- temporary-password generation
- first-login forced change
- signed-in voluntary password change
- administrator password reset
- forgotten-password reset
- bootstrap/superuser password creation where applicable

No password-setting path may silently use a weaker policy.

---

## 19. Completing the forced password change

When the user successfully creates the permanent password:

```text
validate current temporary password
        ↓
validate new password against canonical policy
        ↓
set_password(new_password)
        ↓
must_change_password = false
temporary_password_expires_at = null
        ↓
persist atomically
        ↓
write audit event
```

Once `set_password(new_password)` succeeds, the old temporary password hash has been replaced and the old temporary password is no longer valid.

The active authenticated session should be handled deliberately so the UX is coherent and secure. If the existing signed-in password-change behaviour updates the session authentication hash, the forced-change flow should follow the same established approach unless security review decides otherwise.

---

## 20. Administrator password reset

Administrator-reset behaviour should align with the same temporary-credential model.

When an administrator resets another user's password:

```text
Administrator requests reset
        ↓
KukGrade generates new temporary password
        ↓
Old password becomes invalid
        ↓
must_change_password = true
temporary_password_expires_at = <expiry>
        ↓
Email-enabled?
   ┌────┴────┐
   │         │
  yes        no
   │         │
Notification Show new temporary
email        password once to admin
        ↓
User signs in
        ↓
Forced permanent-password change
```

An administrator should not silently choose another staff member's permanent password.

The administrator is issuing a temporary credential only.

---

## 21. Administrator-reset notification email

When email is enabled, an administrator reset may send:

**Subject:** Your KukGrade password has been reset

Recommended content:

> An administrator has reset your KukGrade password.  
>  
> Your temporary password is:  
> `<temporary password>`  
>  
> This temporary password expires after the configured period.  
>  
> Sign in to KukGrade and you will be required to create a new password immediately.

The login button leads to:

```text
https://kukgrade.co.uk/login
```

not to a URL containing the password.

---

## 22. Forgotten-password flow

Forgotten-password recovery is distinct from administrator-issued temporary passwords.

The accepted self-service recovery model is:

```text
Login page
        ↓
Forgot password?
        ↓
Enter email address
        ↓
POST password-reset request
        ↓
Backend returns same response regardless of whether account exists
        ↓
If eligible account exists:
generate secure short-lived reset token
        ↓
Resend password-reset email
        ↓
User clicks Reset password
        ↓
Login page opens with reset modal
        ↓
User chooses new permanent password
        ↓
Backend validates token + password
        ↓
Password changed
        ↓
User returns to sign in
```

Forgotten-password recovery does **not** issue another temporary password.

---

## 23. Account-enumeration protection

The password-reset request endpoint must not reveal whether an email address belongs to a KukGrade account.

For example:

```text
POST /api/auth/password-reset/request/
```

should produce the same public response for:

- existing active account
- unknown email address
- otherwise non-eligible account, subject to final security rules

A generic success response such as HTTP `204 No Content` is appropriate.

No message such as:

```text
"No account exists with that email."
```

should be returned from the public recovery endpoint.

---

## 24. Password-reset tokens

KukGrade should use Django's established password-reset token machinery, preferably:

```python
default_token_generator
```

rather than inventing a new cryptographic token format.

The reset mechanism should include:

- user identifier/UID
- secure Django-generated reset token
- short expiration
- invalidation after successful password change
- backend validation before any state change

Recommended reset timeout:

```text
1 hour
```

configurable by deployment settings.

---

## 25. Reset-link UX

The reset email should contain a clickable HTML button.

Example conceptual destination:

```text
https://kukgrade.co.uk/login#reset/<uid>/<token>
```

The goal is:

```text
Reset email
        ↓
[ Reset password ]
        ↓
KukGrade login page
        ↓
Reset-password modal opens immediately
```

The user must **not** be automatically logged into KukGrade.

The reset token grants only the narrow capability to replace the password.

It must not grant:

- normal authenticated application access
- student-data access
- grading access
- administration access
- a normal session by itself

---

## 26. Prefer URL fragment for reset token presentation

Where practical, use a browser URL fragment:

```text
/login#reset/<uid>/<token>
```

rather than placing the secret token in a conventional query string.

The fragment is handled client-side and is normally not sent to the web server as part of the HTTP request, reducing exposure through:

- reverse-proxy access logs
- normal server request logs
- some analytics pipelines
- ordinary Referer transmission

The token is still sensitive and must be treated as such.

The frontend can extract the fragment and submit the token directly to the backend reset-confirm endpoint.

---

## 27. Email link scanners

Opening a password-reset link must not consume or invalidate the token.

Email-security systems frequently pre-open links.

Therefore:

```text
GET /login#reset/...
```

must be non-state-changing.

The token should only be acted upon when the user explicitly submits the new password to the backend, for example:

```text
POST /api/auth/password-reset/confirm/
```

This operation validates the token and performs the password change.

---

## 28. Forgotten-password reset modal

The reset-link experience should visually reuse the login page.

Recommended modal:

> **Reset your password**  
> Choose a new password for your KukGrade account.

Fields:

```text
New password
Confirm new password
```

The same live password-policy component used elsewhere should be reused.

After success:

> **Password changed successfully**  
> Your password has been updated. You can now sign in.

Button:

```text
Sign in
```

Do not automatically create a normal authenticated session after reset unless a later explicit security decision changes this.

---

## 29. New-account link UX

Welcome/account-created email should contain:

```text
[ Sign in to KukGrade ]
```

leading to:

```text
https://kukgrade.co.uk/login
```

or:

```text
https://kukgrade.co.uk/login#welcome
```

The link is navigational only.

It does not:

- verify identity
- contain the temporary password
- automatically authenticate
- bypass the normal login form

The user enters:

- their email address
- the temporary password provided in the email

After successful authentication, the forced password-change modal opens immediately.

---

## 30. Email verification — deliberately not part of this packet

A conventional:

```text
Verify your email address
```

workflow is **not required** for the current design.

Reason:

- accounts are administrator-provisioned
- there is no self-registration
- the temporary-credential login plus mandatory replacement establishes the intended onboarding path

Do not add `email_verified` or another verification-token subsystem unless a later product/security requirement specifically needs proof of mailbox ownership.

The welcome button should say:

```text
Sign in to KukGrade
```

not:

```text
Verify account
```

---

## 31. Password-change confirmation email

When email is enabled, a successful password change should trigger a security notification.

From:

```text
KukGrade Security <security@kukgrade.co.uk>
```

Recommended content:

> Your KukGrade password was changed successfully.  
>  
> If you made this change, no action is required.  
>  
> If you did not make this change, contact KukGrade support immediately.

Possible support link:

```text
mailto:support@kukgrade.co.uk
```

This notification may be sent after:

- first-login forced password replacement
- signed-in voluntary password change
- successful forgotten-password reset

It should not contain credentials or reset tokens.

---

## 32. Transactional email templates

Initial repo-owned template set:

```text
welcome.html
welcome.txt

must_change_password.html
must_change_password.txt

password_reset.html
password_reset.txt

password_changed.html
password_changed.txt
```

A distinct administrator-reset template may be added if required by final UX/content design:

```text
admin_password_reset.html
admin_password_reset.txt
```

HTML and plain-text versions should both exist.

Templates should live in the repository rather than only inside the Resend dashboard so that:

- changes are code-reviewed
- templates are versioned
- tests can render them
- deployment state is reproducible
- provider migration remains possible

---

## 33. Email visual design

Transactional email should visually match KukGrade's established design language once the current frontend design register is complete.

Do not implement final email styling before the design register has stabilised.

Requirements:

- professional KukGrade identity
- accessible typography
- clear CTA button
- meaningful plain-text fallback
- no marketing content
- no unnecessary imagery
- no tracking-dependent functionality

Security-sensitive links must remain obvious and readable even if CSS is stripped.

---

## 34. Resend provider integration architecture

Do not scatter direct provider calls across account views/services.

Use an abstraction boundary.

Conceptual structure:

```text
accounts/
    emails.py

kukgrade/
    email/
        transport.py
        resend.py
```

or an equivalent architecture consistent with the repository at implementation time.

Account/business logic calls KukGrade's email service.

The email service chooses the configured transport.

This keeps Resend replaceable without rewriting account workflows.

---

## 35. Resend API use

Production application email should use the official Resend API/SDK.

The application supplies, at minimum:

```text
from
to
subject
html
text
reply-to
```

Conceptually:

```python
send_email(
    from_="KukGrade <accounts@kukgrade.co.uk>",
    to=[user.email],
    reply_to="support@kukgrade.co.uk",
    subject="Reset your KukGrade password",
    html=rendered_html,
    text=rendered_text,
)
```

Exact SDK syntax must be checked against the current Resend SDK version at implementation time.

---

## 36. Resend SMTP

Resend SMTP is an operational option for manual support correspondence.

It is not the preferred application integration path.

The Django application should use the Resend API/SDK unless implementation review identifies a better reason not to.

---

## 37. Email tracking

For authentication/security transactional email:

- click tracking should be disabled
- open tracking should be disabled

This is especially important for password-reset links so URLs are not unnecessarily rewritten or observed by tracking infrastructure.

---

## 38. Idempotency and duplicate prevention

Where supported, Resend idempotency should be used to reduce accidental duplicate email during retries.

Suitable conceptual identifiers include:

```text
welcome/<user-id>/<event-id>
password-reset/<user-id>/<reset-event-id>
admin-reset/<user-id>/<event-id>
password-changed/<user-id>/<event-id>
```

Do not place raw passwords or reset tokens inside logs or visible idempotency metadata.

---

## 39. Email failure semantics

Email delivery failure must not corrupt authoritative state.

Examples:

### Account creation

```text
Account creation succeeds
        ↓
Welcome email fails
        ↓
Account remains created
```

The administrator must be given a clear recovery path.

If the plaintext temporary password is no longer available, recovery should generate a **new** temporary password, invalidate the previous one, and resend/re-display the new credential.

### Password changed

```text
Password successfully changed
        ↓
Security notification fails
        ↓
Password remains changed
```

Never roll the password back because a notification failed.

---

## 40. Resend unavailable / retry model

Do not introduce a worker/Celery system solely for email unless async processing has been separately accepted as a project requirement.

Initial implementation may use synchronous send-after-state-change semantics with careful failure handling.

If retries are added, they must not duplicate authoritative account actions.

Any future async architecture should be a deliberate later decision rather than premature scaffolding.

---

## 41. Audit requirements

Sensitive account actions should remain auditable.

Audit events should capture relevant action metadata without storing secrets.

Do not log:

- permanent passwords
- temporary passwords
- password-reset tokens
- complete secret reset URLs
- Resend API keys
- SMTP credentials

Potential audited actions include:

- account created
- administrator password reset
- forced password change completed
- self-service password reset completed
- normal signed-in password change
- temporary credential regenerated

Email delivery status may be operationally logged separately if useful, but it must never include secret material.

---

## 42. Password-reset throttling

Forgotten-password requests need a dedicated throttle distinct from login/password-change throttles.

Initial suggested value:

```text
5 requests per hour per IP
```

The exact number may be tuned based on testing and real deployment needs.

Rate limiting must not reveal whether a given email exists.

---

## 43. Security boundaries

The following are explicitly forbidden designs:

### Do not automatically authenticate from an email link

Bad:

```text
Email link
→ normal logged-in KukGrade session
```

### Do not put temporary passwords in URLs

Bad:

```text
/login?password=TemporaryPassword
```

### Do not make frontend state authoritative

Bad:

```text
React modal dismissed
→ unrestricted API still works
```

### Do not allow reset tokens to grant ordinary application access

A reset token only permits password replacement.

### Do not consume reset tokens on GET

Opening the link must not change account state.

### Do not rely on email to preserve security-critical state

Email is notification/recovery infrastructure only.

---

## 44. Suggested API surface

Exact route names may be adapted to existing API conventions.

Likely additions:

```text
GET  /api/config/

POST /api/auth/password-reset/request/
POST /api/auth/password-reset/confirm/
```

Existing routes should be reused/refined where appropriate:

```text
GET  /api/auth/me/
POST /api/auth/login/
POST /api/auth/logout/
POST /api/auth/change-password/
POST /api/users/{id}/set-password/
```

The user-management create/reset contracts will need to reflect the new temporary-password lifecycle.

---

## 45. OpenAPI / generated frontend types

Any backend serializer or API-contract change must continue through the existing OpenAPI workflow.

Requirements:

- update backend schema
- regenerate OpenAPI
- regenerate TypeScript types
- ensure CI catches drift
- avoid handwritten duplicate frontend contracts

New fields likely include:

```text
must_change_password
email_enabled
```

and any password-reset request/confirm request/response shapes.

---

## 46. Frontend routes and UI states

Likely frontend work:

```text
/login
```

with support for:

- ordinary login
- welcome-state presentation
- immediate forced-password modal after temporary login
- reset-password modal when a valid reset fragment is present

Potential route/state pattern:

```text
/login#welcome
/login#reset/<uid>/<token>
```

The final routing mechanism should respect the current React Router architecture at implementation time.

---

## 47. Frontend modal requirements

### Forced first-login modal

Cannot be dismissed to gain access.

Contains:

```text
Current temporary password
New password
Confirm new password
```

### Forgot-password reset modal

Token-authorised; does not require old password.

Contains:

```text
New password
Confirm new password
```

### Shared password-policy component

Both should reuse the same visual requirements component.

The frontend must show validation clearly, but backend validation is final.

---

## 48. Email-enabled account-creation UX

When email is enabled:

```text
Admin creates user
        ↓
KukGrade generates temporary password
        ↓
Welcome email sent automatically
        ↓
Admin sees account-created success
```

The admin does not need to copy the password manually in the normal successful path.

If email delivery fails, the admin must receive an explicit failure/recovery UI rather than assuming the user received the credential.

---

## 49. Email-disabled account-creation UX

When email is disabled:

```text
Admin creates user
        ↓
KukGrade generates temporary password
        ↓
One-time credential modal
        ↓
Admin copies password
        ↓
Close modal
        ↓
Plaintext is no longer recoverable
```

This mode must be treated as a first-class supported deployment configuration, not a degraded or broken state.

---

## 50. Email-enabled forgotten-password UX

If `email_enabled = true`:

Login page offers:

```text
Forgot password?
```

User enters email.

UI returns a generic message such as:

> If an eligible KukGrade account exists for that address, a password reset email has been sent.

This message should be shown regardless of whether a matching account exists.

---

## 51. Email-disabled forgotten-password UX

If `email_enabled = false`:

Do not present a self-service flow that cannot work.

Instead show:

> Contact your KukGrade administrator if you cannot sign in.

The administrator can issue a new temporary credential using the administrator reset flow.

---

## 52. Initial email set

The first implementation should support exactly these core transactional emails:

1. Welcome / account created
2. Administrator reset / temporary password reissued
3. Forgotten-password reset
4. Password changed security notification

Do not expand scope into newsletters, broadcasts, marketing, audiences, or other non-transactional email.

---

## 53. Webhooks

Resend delivery/bounce/complaint webhooks are explicitly **later work**.

They are not required for the initial implementation.

Possible later events:

```text
delivered
bounced
complained
failed
```

If webhooks are later added:

- verify signatures
- never trust unsigned payloads
- keep provider delivery state separate from authoritative account state
- do not make email delivery determine whether an account exists

---

## 54. Testing requirements

Automated tests must never send real Resend email.

Use a mocked/fake transport.

At minimum cover:

### Account creation

- email disabled account creation
- email enabled account creation
- temporary password generated
- plaintext not persisted
- `must_change_password = true`
- expiry set
- welcome email rendered correctly
- provider failure does not corrupt account state

### Forced first login

- temporary password accepted before expiry
- expired temporary password rejected
- normal API blocked while `must_change_password = true`
- allowlisted auth endpoints remain available
- forced password change succeeds
- old temporary password invalid after change
- `must_change_password = false` afterwards

### Password policy

- minimum length
- maximum length
- uppercase requirement
- lowercase requirement
- digit requirement
- special-character requirement
- common-password rejection
- similarity validator where applicable
- identical rules across all password-setting paths

### Administrator reset

- previous password invalidated
- new temporary password created
- forced-change flag set
- expiry set
- email-disabled one-time display path
- email-enabled notification path

### Forgotten password

- known account request
- unknown email request gives indistinguishable public response
- inactive/non-eligible handling according to final rules
- throttling
- valid token
- invalid token
- expired token
- token invalid after successful password change
- reset does not authenticate normal application session automatically

### Email

- HTML template
- text template
- correct From
- correct Reply-To
- correct public URL
- no password/token leaks in logs
- no real provider calls during tests

### Frontend

- email capability discovery
- email-enabled Forgot Password visibility
- email-disabled administrator-contact state
- forced modal opens after temporary login
- modal cannot bypass backend restriction
- reset fragment opens reset modal
- successful reset returns user to login
- generated API types remain in sync

---

## 55. Development workflow requirements

This feature should be implemented in small, independently verified slices.

Preferred sequence:

```text
one slice
→ tests
→ lint
→ typecheck
→ deliberate security/load-bearing verification
→ report result
→ commit only after approval
→ next slice
```

Avoid a single massive implementation commit.

Suggested slices:

1. Canonical password-policy validators
2. User temporary-credential fields + migrations
3. Backend forced-password gate
4. Temporary-password generation lifecycle
5. Email capability configuration
6. Provider abstraction + development transport
7. Resend transport
8. Welcome/admin-reset emails
9. Forgot-password backend
10. Reset email + reset-token flow
11. Runtime capability endpoint
12. Frontend forced-change modal
13. Frontend forgotten-password/reset modal
14. Security notification email
15. End-to-end hardening/tests
16. Documentation and deployment examples

---

## 56. Docker/deployment examples

### Minimal deployment

```yaml
environment:
  KUKGRADE_EMAIL_BACKEND: disabled
```

No Resend account required.

Account management still works.

### Email-enabled deployment

```yaml
environment:
  KUKGRADE_EMAIL_BACKEND: resend
  RESEND_API_KEY: ${RESEND_API_KEY}

  KUKGRADE_PUBLIC_URL: https://kukgrade.co.uk

  KUKGRADE_EMAIL_FROM: "KukGrade <accounts@kukgrade.co.uk>"
  KUKGRADE_SECURITY_EMAIL_FROM: "KukGrade Security <security@kukgrade.co.uk>"
  KUKGRADE_EMAIL_REPLY_TO: support@kukgrade.co.uk

  KUKGRADE_TEMP_PASSWORD_TTL_HOURS: "24"
  KUKGRADE_PASSWORD_RESET_TIMEOUT_SECONDS: "3600"
```

Use the same application images in both modes.

---

## 57. Future production web deployment

The intended public deployment is:

```text
https://kukgrade.co.uk
        ↓
Cloudflare
        ↓
Cloudflare Tunnel
        ↓
Traefik
        ↓
KukGrade
```

Email infrastructure is independent:

```text
KukGrade Django
        ↓
HTTPS API
        ↓
Resend
        ↓
Recipient
```

Hosting KukGrade behind Cloudflare Tunnel does not make the origin server part of the SPF configuration.

---

## 58. Semantic Versioning / release boundary

The current frontend design register should be completed before this packet is implemented.

Recommended interpretation of Semantic Versioning:

### `1.0.0`

Use `v1.0.0` for the first release the project deliberately considers:

- functionally complete for its defined initial product scope
- stable enough for real production use
- documented
- migration-safe
- tested
- not merely an internal development snapshot

If the current product reaches that state after the frontend design register is complete, **v1.0.0 is the correct Semantic Versioning milestone**.

This packet can then be implemented as post-1.0 work.

The exact release number for the resulting email/onboarding feature should be decided from the actual API compatibility impact at implementation time rather than hardcoded now.

Likely examples:

```text
v1.1.0
```

if added as a backwards-compatible feature to the stable 1.x line, or a later minor release depending on intervening work.

Do not call an unstable dev snapshot `1.0.0` merely because the number is convenient.

---

## 59. Deferred / explicitly out of scope

This packet does **not** currently include:

- public self-registration
- Google SSO
- social login
- magic-link authentication
- passwordless authentication
- general email-verification subsystem
- marketing email
- newsletters
- broadcast campaigns
- Resend inbound-email processing
- email-based approval workflows
- Celery/worker architecture solely for email
- automatic login from welcome/reset links
- permanent passwords chosen by administrators for other users

These require separate future decisions.

---

## 60. Final accepted architecture

```text
                         KUKGRADE
                            │
            ┌───────────────┴───────────────┐
            │                               │
      EMAIL DISABLED                  EMAIL ENABLED
            │                               │
            │                           RESEND API
            │                               │
            │                      welcome / reset /
            │                      security messages
            │
Administrator creates user
            │
KukGrade generates temporary password
            │
hash only stored
            │
must_change_password = true
temporary_password_expires_at = expiry
            │
       ┌────┴────┐
       │         │
email off      email on
       │         │
show once    email temporary
to admin     password once
       │         │
       └────┬────┘
            │
            ▼
          LOGIN
            │
            ▼
Temporary credentials authenticated
            │
            ▼
Backend restricts user to password-change flow
            │
            ▼
Blocking password-change modal
            │
            ▼
Permanent password accepted
            │
            ▼
must_change_password = false
temporary_password_expires_at = null
            │
            ▼
       FULL KUKGRADE ACCESS
```

Forgot-password flow:

```text
User requests reset
        ↓
Generic public response
        ↓
Django creates short-lived reset token
        ↓
Resend email
        ↓
[ Reset password ]
        ↓
https://kukgrade.co.uk/login#reset/<uid>/<token>
        ↓
Login page + reset modal
        ↓
New password submitted
        ↓
Django validates token and password
        ↓
Password replaced
        ↓
User returns to normal login
```

---

## 61. Implementation principle

When this packet is eventually picked up by Antigravity or another implementation agent:

> **Treat this document as the accepted product/security design. Do not silently redesign account onboarding, temporary-password behaviour, optional email behaviour, password recovery, sender identities, or forced-password enforcement.**

If current repository code conflicts with this packet, stop and identify the conflict before changing behaviour.

If implementation reveals a security or architectural issue that warrants changing an accepted decision, document the concern explicitly and request a deliberate design decision rather than improvising.

---

## 62. Readiness condition before implementation begins

Do not start this packet merely because Resend/domain setup is available.

Begin only when:

- the current frontend design register is complete
- the existing frontend works coherently
- backend and frontend test suites are green
- current dev scope has been stabilised
- the team has deliberately declared the first production-ready SemVer milestone, expected to be `v1.0.0` if it is truly the first stable release
- repository documentation has been updated to reflect that stable baseline

At that point, this packet becomes the implementation handoff for the next account/email capability phase.
