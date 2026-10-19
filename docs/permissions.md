# Permissions

## Confirmed Requirements

- Supported roles are Instructor and Administrator. "Authorised Master" is not
  a role: it is three per-user permissions (below).
- Permissions must be enforced by the backend.
- Frontend hiding or disabling controls is not sufficient.
- Apply least privilege throughout the API and UI.
- Sensitive changes must be auditable.
- Students do not directly access the system.

## Implemented Capability Map

Accepted 2026-09-13, implemented in `accounts/groups.py`. Django permissions
are the authority primitive; `User.role` is a label that decides group
membership and is never consulted when authorising a request. The one
place role appears in a rule is the policy that an administrator may not
hold final-decision authority (`accounts.services`), which is a rule about
roles rather than an authorisation check.

| Capability | Instructor | Administrator | Master |
| --- | --- | --- | --- |
| Read ranks and syllabus | Yes | Yes | via group |
| Students: view, add, change | Yes | Yes | via group |
| Grading sessions: full CRUD | Yes | Yes | via group |
| Candidates: full CRUD | Yes | Yes | via group |
| Assessments and item results | Yes | Yes | via group |
| Propose or revise an outcome | Yes | Yes | via group |
| **Final grading decision** | No | No | **Yes** |
| **Promote a student** | No | No | **Yes** |
| **Withdraw from / cancel a locked session** | No | No | **Yes** |
| Manage users and roles | No | Yes | via group |
| **Delete a user account** | No | **Yes** | via group |
| **Delete a completed assessment** | No | **Yes** | via group |
| **Delete a student (full cascade)** | No | **Yes** | via group |
| **Delete a grading session in any status** (`gradings.delete_any_gradingsession`) | No | **Yes** | via group |
| **Read the audit log** | via `can_view_grading_audit_log` | **Yes** (`audit.view_auditevent`) | **Yes** |
| **Bulk-import student roster (upload/preview/commit)** | No | **Yes** | via group |
| **Bulk-import historical grading workbook (upload/preview/commit)** | No | **Yes** | via group |
| Read imported historical grading records | Yes | Yes | via group |
| **Reconcile a historical record (link/unlink/resolve rank/void)** | No | **Yes** | via group |

"Grading sessions: full CRUD" has one asymmetry: an instructor can only
delete a `DRAFT` or `CANCELLED` session, and even a `CANCELLED` one holding
recorded assessment work (any candidate past `NOT_STARTED`) is refused for
them. An administrator can delete a session in **any** status, including
`LOCKED`/`COMPLETED` sessions holding finalised outcomes and promotions
(2026-09-20 for the cancelled-with-work case, extended to every status
2026-09-22 - see `decision_log.md`) - the `SESSION_DELETED` audit event,
with reverted ranks in its metadata, is the trail.

Three further Administrator-only capabilities, added 2026-09-21 through
2026-09-22 for corruption/test-data cleanup and routine cleanup rather than
occasional correction (see `decision_log.md`): hard-deleting a user account
(`accounts.delete_user`, already part of "Manage users and roles" above but
newly wired to an actual `DELETE`), hard-deleting a completed candidate
assessment (`gradings.delete_candidateassessment`,
`gradings.delete_candidateoutcome`, `gradings.delete_promotion`), and
hard-deleting a student (`students.delete_student`) - all in the
`_DATA_CLEANUP_PERMISSIONS` tuple, Administrator group only. All cascade
attribution/data to a placeholder account or a reverted rank rather than
erasing history it doesn't own; deleting a student unlinks (rather than
deletes) any `LegacyGradingRecord` linked to them. See
`docs/current-system.md`.

Bulk student-roster import, added 2026-09-21, is likewise Administrator-
group-only (`data_imports.view_importbatch`, `.add_importbatch`,
`.change_importbatch`, and a custom `.can_commit_import` - a new
`_DATA_IMPORT_PERMISSIONS` tuple). `can_commit_import` is deliberately its
own permission rather than reusing `change_importbatch`, so the irreversible
act of actually creating students from a reviewed file is a distinct grant
from merely uploading/previewing one. Historical grading-workbook import,
added 2026-09-22, reuses the identical `_DATA_IMPORT_PERMISSIONS` for
upload/preview/commit. Reading an imported historical record
(`gradings.view_legacygradingrecord`) is in `_KUK_SOOL_PERMISSIONS` and so
granted to both roles, matching native grading visibility; only
reconciling one (link/unlink/resolve-rank/void) is gated by a further
Administrator-only permission, `gradings.can_reconcile_imported_history`.
See `docs/data-import-and-legacy-migration.md`.

"Master" is not a group. `gradings.can_make_final_grading_decision`,
`gradings.can_promote_student`, `gradings.can_override_locked_session` and
(since 2026-09-21) `gradings.can_view_grading_audit_log` are granted per
user, independently of role, so authority survives one person being
unavailable and never arrives as a side effect of a role change. The four
are separate: holding one does not confer the others. They are granted only
through `accounts.services.set_user_authority`, which applies the rules
below and audits the change; Django admin shows groups and per-user
permissions read-only (KG-A14).
`can_view_grading_audit_log` is the odd one out in framing - it grants
audit-log *read* access rather than a grading action - but follows the
identical mechanism (`accounts.permissions.AUTHORITY_PERMISSIONS`) as the
other three, so it is listed alongside them rather than introducing a second
grant mechanism.

Final-decision authority is never held by an administrator, by decision
(2026-09-16, see `decision_log.md`): granting it to an administrator, or promoting a
holder to administrator, is refused outright. Any number of instructors may
hold it - a second Master is a normal outcome, not an exception (2026-09-25,
see `decision_log.md`) - but an administrator never can. Administrators hold
the other three sensitive permissions and every other capability instead.
The audit log follows the same
administrator-or-Master-or-grantee line, unlike every other capability above
where Master access "via group" already covers it - a plain instructor
holding none of the three is refused. The rule is stated once, in
`accounts.permissions.can_view_audit_log`, and both the API and Django admin
ask it; `audit.models.AuditEventQuerySet.visible_to` likewise applies the
administrator-only user-management exclusion for both.

The syllabus catalogue is read-only while syllabus versioning is deferred.

## Backend Enforcement

- Every endpoint requires authentication except `/api/health/`,
  `/api/ready/`, `/api/site/`, and login.
- Every viewset declares a `permission_map` from action to required Django
  permissions (`accounts.permissions.HasRequiredPermissions`); an undeclared
  action is denied, so a new endpoint fails closed.
- An account whose password somebody else chose (`must_change_password`, set
  on creation and by an administrator reset) may do nothing but read who it is,
  change its password, and sign out, whatever permissions it holds
  (2026-09-29). `accounts.middleware.ForcePasswordChangeMiddleware` applies
  this to every view at once, so a new endpoint is gated without declaring
  anything; see `api_contract.md`. Once that temporary password expires, the
  account cannot sign in at all until an administrator issues a new one.
- A password reset hands the administrator a password that signs in as that
  account, so only a superuser may reset an account that can use the Django
  admin site (`is_staff` or `is_superuser`), and nobody may reset their own
  (`accounts.services.validate_can_reset_password`).
- Final decisions, promotion, and locked-session withdrawal/cancellation each
  add a per-user authority check on top, pinned by
  `accounts/test_permission_matrix.py`.
- Models refuse illegal states (locked or finalised records, immutable
  history), so admin, the shell, and bulk querysets cannot bypass the API's
  rules.
- Every sensitive write records an audit event in its own transaction.

Frontend controls reflect these permissions but are never the enforcement
boundary.

## Audit Requirements

Audit events should capture at least:

- actor.
- action.
- entity type and identifier.
- timestamp.
- summary.
- relevant metadata, avoiding unnecessary personal data duplication.

Actions requiring audit include syllabus changes, permission changes, final decisions, overrides, rank changes, student status changes, and changes to submitted or finalised grading records.

## Privacy Rules

- Student details, attendance, grading comments, and outcomes are personal data.
- Development data must be anonymised or synthetic.
- Access should be limited to users with a real operational need.
- Assessment comments, grading outcomes, student status, and audit logs need stricter access than general reference data.

## Open questions

- Audit log retention period and export policy.
