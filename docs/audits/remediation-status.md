# Audit Remediation Status

Audit baseline:

- Repository: `TheRedTower/KukGrade`
- Branch: `dev`
- Commit: `464670da59721833c5f1b00ffee87f8eb9da5e0b`
- Audit file: `/Users/adi/VScode/kukgrade_repository_audit_464670da.md`

Status values: `Open`, `In progress`, `Blocked by decision`, `Implemented`,
`Verified`, `Closed`.

`Closed` requires merged implementation, passing verification, updated
documentation, independent review with no blocker, and recorded evidence.

| ID | Finding | Severity | Status | Branch/PR | Tests | Documentation | Evidence |
|---|---|---:|---|---|---|---|---|
| H-01 | Session and candidate deletion rules can be bypassed outside the API | High | Open | | Required | Required | |
| H-02 | Assessment lifecycle and snapshot immutability are not model-level invariants | High | Open | | Required | Required | |
| H-03 | Confirmed least-privilege/role enforcement is not implemented | High | Open | | Required | Required | |
| H-04 | Exact syllabus-version provenance is absent | High | Open | | Required | Required | |
| H-05 | Sensitive-action audit logging is not implemented | High | Open | | Required | Required | |
| H-06 | Parent/child workflow transactions are vulnerable to stale-state races | High | Open | | Required | Required | |
| M-01 | Legacy final-decision boolean is dead, exposed, and misleading | Medium | Open | | Required | Required | |
| M-02 | Student status and rank governance do not match confirmed requirements | Medium | Open | | Required | Required | |
| M-03 | CandidateOutcome candidate/assessment consistency is not a database invariant | Medium | Open | | Required | Required | |
| M-04 | Assessment result attribution is not constrained | Medium | Open | | Required | Required | |
| M-05 | Documentation has multiple contradictory current-state narratives | Medium | Implemented | Stage 1 documentation truth | Docs-only checks | Updated in this stage | `docs/current-system.md`, this tracker, and legacy markers |
| M-06 | Category-level grading semantics and positive observations are not implemented | Medium | Blocked by decision | | Required after decision | Required | |
| M-07 | Frontend converts service outages into anonymous user state | Medium | Open | | Required | Required | |
| M-08 | Frontend API error representation is insufficient for real forms | Medium | Open | | Required | Required | |
| M-09 | Production settings fail open to development defaults | Medium | Open | | Required | Required | |
| M-10 | No CI or reproducible proof that the repository is green | Medium | Open | | Required | Required | |
| M-11 | Outcome summary documentation overstates the overall fields | Medium | Open | | Required if code changes | Required | |
| M-12 | Candidate PUT/same-value PATCH can be rejected after snapshot generation | Medium | Open | | Required | Required | |
| L-01 | Unreachable withdrawn-specific outcome validation | Low | Open | | Required if changed | Optional | |
| L-02 | Invalid list filters silently return empty 200 responses | Low | Open | | Required if policy changes | Required if policy changes | |
| L-03 | Session serializer mutates the model instance during validation | Low | Open | | Required | Optional | |
| L-04 | Health endpoint is liveness only | Low | Open | | Required if readiness added | Required if readiness added | |
| L-05 | Whitespace-only values are not uniformly database-protected | Low | Open | | Required if changed | Required if policy changes | |

## 2026-09-14 Verification Audit

The independent audit of 2026-09-13 superseded this register's numbering. Its
findings are `KG-nnn` and its verified status is in
`docs/audits/2026-09-14-verification-audit.md`. Mapping for the prior register:

| Prior | Now |
|---|---|
| H-01, H-02 (deletion / immutability bypass) | KG-009, **closed** |
| H-03 (least privilege) | KG-001, **closed** |
| H-04 (syllabus version) | KG-014, **deferred by decision** |
| H-05 (audit logging) | KG-007, open |
| H-06 (stale-state races) | KG-021, KG-022, open |
| M-01 (legacy boolean) | KG-003, **closed** |
| M-02 (student status) | KG-025, **closed** |
| M-03, M-04 (DB invariants) | KG-010, KG-011, **closed** |
| M-05 (documentation truth) | recurred as KG-033, **closed again** |
| M-06 (category semantics) | still blocked by decision |
| M-07, M-08 (frontend errors) | KG-016, KG-015, **closed** |
| M-09 (settings fail open) | KG-002, **closed** |
| M-10 (no CI) | KG-019, **closed** |
| M-11, M-12, L-01..L-05 | open, all P3 |

## Stage 0 Baseline Reconciliation

Performed against `/Users/adi/VScode/KukGrade` on `dev` at
`464670da59721833c5f1b00ffee87f8eb9da5e0b`.

- Main worktree was clean and exactly matched the audit baseline.
- Separate worktree
  `/Users/adi/.codex/worktrees/kukgrade-promotion-rank-history/KukGrade` was
  dirty with uncommitted promotion/rank-history work. That work has not been
  reviewed or merged and must be re-audited before acceptance.
- Docker was not running, so PostgreSQL-backed verification could not complete.
- Backend static checks passed: `makemigrations --check --dry-run`,
  `manage.py check`, `ruff check`, `ruff format --check`, and `mypy`.
- `pytest` collected 222 tests; 221 database-backed tests errored because
  PostgreSQL was unavailable, and the non-database health test passed.
- Frontend `npm ci`, tests, lint, typecheck, and build passed. `npm ci`
  reported one low-severity audit issue.

## Stage Order

1. Stage 1: Documentation truth and superseded decisions.
2. Stage 2: Integrity boundaries.
3. Stage 3: Concurrency and locking.
4. Stage 4: Permissions.
5. Stage 5: Syllabus versioning.
6. Stage 6: Audit events.
7. Stage 7: Promotion and student state.
8. Stage 8: Assessment semantics.
9. Stage 9: Frontend reliability and workflows.
10. Stage 10: CI and production hardening.
