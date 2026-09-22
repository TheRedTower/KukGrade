# Permissions

## Confirmed Requirements

- Supported roles are Instructor, Manager, Administrator, and authorised Master.
- Permissions must be enforced by the backend.
- Frontend hiding or disabling controls is not sufficient.
- Apply least privilege throughout the API and UI.
- Sensitive changes must be auditable.
- Students do not directly access the system.

## Implemented Capability Map

Accepted 2026-09-13, implemented in `accounts/groups.py`. Django permissions
are the authority primitive; `User.role` is a label that decides group
membership and is never consulted when authorising a request.

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
| **Delete a grading session in any status** | No | **Yes** | via group |
| **Read the audit log** | via `can_view_grading_audit_log` | **Yes** | **Yes** |
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
are separate: holding one does not confer the others.
`can_view_grading_audit_log` is the odd one out in framing - it grants
audit-log *read* access rather than a grading action - but follows the
identical mechanism (`accounts.services.AUTHORITY_PERMISSIONS`,
`accounts.groups.SENSITIVE_PERMISSIONS`) as the other three, so it is listed
alongside them rather than introducing a second grant mechanism.

Final-decision authority is administrator-exclusive by decision (2026-09-16,
see `decision_log.md`): granting it to an administrator, or promoting a
holder to administrator, is refused outright. Exactly one designated Master
holds it; administrators hold the other three sensitive permissions and
every other capability instead. The audit log follows the same
administrator-or-Master-or-grantee line, unlike every other capability above
where Master access "via group" already covers it - a plain instructor
holding none of the three is refused.

`manager` was removed from `User.Role` in 2026-09. Nothing used it.

Syllabus authoring is granted with syllabus versioning in Phase 2b; the
catalogue is read-only until then.

## Backend Enforcement

The DRF API should enforce:

- authentication for all application endpoints except explicitly public health checks.
- role-based permissions for create, update, delete, decision, and audit endpoints.
- object-level permissions for branch-scoped or session-scoped data.
- immutable or locked states for submitted assessments and finalised decisions.
- audit creation for sensitive writes.
- final-decision endpoints restricted to authorised Masters.
- syllabus-version mutation restricted to confirmed administrative roles and protected by audit logging.

Frontend controls should reflect backend permissions but must not be the enforcement boundary.

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

## Unresolved Decisions

- Exact branch or organisation scoping rules for each role.
- Whether Manager is a branch-scoped operational role, an organisation-wide role, or both.
- Whether authorised Master is a role, a permission, or a designation attached to a user.
- Whether instructors can edit student profiles or only view and assess.
- Audit retention period and export policy.
