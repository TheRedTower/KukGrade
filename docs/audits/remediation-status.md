# Audit Remediation Status

> **This register is historical.** Its `H-`/`M-`/`L-` numbering was superseded
> by the `KG-nnn` register on 2026-09-13. For current status read, in order:
>
> 1. `docs/audits/2026-09-13-independent-repository-audit.md` - `KG-001`..`KG-035`
> 2. `docs/audits/2026-09-15-post-completion-audit.md` - `KG-036`..`KG-054`
> 3. `docs/current-system.md` - what is true on `dev` now
>
> The table below is kept for traceability from the original numbering. Its
> `Status` column was stale for a long time and was corrected on 2026-09-15;
> where a row was not re-verified in that pass, it says so rather than
> guessing.

Audit baseline:

- Repository: `TheRedTower/KukGrade`
- Branch: `dev`
- Commit: `464670da59721833c5f1b00ffee87f8eb9da5e0b`
- Audit file: not committed to this repository; it was written to a path
  outside the working tree and the `KG-nnn` audits above supersede it.

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
| H-05 | Sensitive-action audit logging is not implemented | High | Closed | | Required | Required | |
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

## Mapping to the KG register

The independent audit of 2026-09-13 superseded this register's numbering. Its
findings are `KG-nnn`, split across
`docs/audits/2026-09-13-independent-repository-audit.md` (`KG-001`..`KG-035`)
and `docs/audits/2026-09-15-post-completion-audit.md` (`KG-036`..`KG-054`).

Statuses below were corrected on 2026-09-15. An earlier version of this
section referenced `docs/audits/2026-09-14-verification-audit.md`, which was
never committed; that reference has been removed.

| Prior | Now |
|---|---|
| H-01, H-02 (deletion / immutability bypass) | KG-009, **closed** |
| H-03 (least privilege) | KG-001, **closed** |
| H-04 (syllabus version) | KG-014, **deferred by decision** |
| H-05 (audit logging) | KG-007, **closed**; completeness gap later found and closed as KG-036 |
| H-06 (stale-state races) | KG-021, KG-022, **closed** - concurrency tests landed, then locking was standardised under them (NEXT-014) |
| M-01 (legacy boolean) | KG-003, **closed** |
| M-02 (student status) | KG-025, **closed** |
| M-03, M-04 (DB invariants) | KG-010, KG-011, **closed** |
| M-05 (documentation truth) | recurred as KG-033, then again as KG-038 and in `backend/README.md`; **closed again 2026-09-15** |
| M-06 (category semantics) | still blocked by decision |
| M-07, M-08 (frontend errors) | KG-016, KG-015, **closed**; login-form error handling later corrected as KG-045 |
| M-09 (settings fail open) | KG-002, **closed**; proxy-header default later tightened as KG-052 |
| M-10 (no CI) | KG-019, **closed** |
| M-11 (summary docs overstate fields) | not re-verified in the 2026-09-15 pass |
| M-12 (candidate PUT/same-value PATCH) | not re-verified in the 2026-09-15 pass |
| L-01 (unreachable withdrawn branch) | KG-012, **re-verified 2026-09-15 as still open**; cosmetic dead branch in `validate_outcome_assessment_state` |
| L-02 (invalid filters return empty 200) | KG-018, open by design pending a policy decision |
| L-03 (serializer mutates instance in validation) | KG-013, **re-verified 2026-09-15 as fixed** |
| L-04 (health is liveness only) | open; readiness probe belongs with deployment work |
| L-05 (whitespace-only values) | largely addressed by the not-blank check constraints; not re-verified in full |

## Stage 0 Baseline Reconciliation

Performed against `/Users/adi/VScode/KukGrade` on `dev` at
`464670da59721833c5f1b00ffee87f8eb9da5e0b`.

- Main worktree was clean and exactly matched the audit baseline.
- Separate worktree
  `/Users/adi/.codex/worktrees/kukgrade-promotion-rank-history/KukGrade` was
  dirty with uncommitted promotion/rank-history work. **Resolved 2026-09-15:**
  its commits had long since been reviewed and merged into `dev`; the
  remaining uncommitted documentation was salvaged (the promotion decision-log
  entry and the `backend/README.md` promotions section, both verified against
  the shipped implementation first), the superseded `api_contract.md` diff was
  discarded, and the worktree was removed.
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
