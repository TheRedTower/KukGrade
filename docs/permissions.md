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

### What an Administrator can do to other accounts (2026-10-20)

The table above is what each role can do; this is what a non-superuser
Administrator may do to a particular account, mapped by request on
2026-10-20 and closed by the owner's decision of the same day
(`decision_log.md`). A superuser can do all of it to any account but their
own, and is the only account with the Django admin site unless one grants it
to another (`is_staff`, which the API never sets).

| To this account | Edit name, email | Change role | Activate / deactivate | Grant / revoke authority | Reset password | Delete |
| --- | --- | --- | --- | --- | --- | --- |
| An instructor | Yes | Yes | Yes | Yes | Yes | Yes |
| Another administrator | Yes | Yes | Yes | Yes (never final decisions) | Yes | Yes |
| A superuser, or any account with admin site access | No | No | No | No | No | No |
| Their own | Yes (name also from the account menu) | No | No | No | No - change it instead | No |

Every "No" is refused by the service that makes the change
(`accounts.services.can_manage` for the third row; `update_platform_user`
for your own role and status), so the API and Django admin agree; the Users
API serves `manageable` on each account and the user page offers no change
it would refuse. Admin site access itself (`is_staff`, `is_superuser`) is
granted or removed only by a superuser, and Django admin shows another
superuser's record view-only to anyone else.

- Assessment comments, grading outcomes, student status, and audit logs need stricter access than general reference data.

## Open questions

- Audit log retention period and export policy.
