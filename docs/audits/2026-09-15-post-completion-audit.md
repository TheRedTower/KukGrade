# Post-Completion Audit - 2026-09-15

Audit of `dev` at `7e84d14`, run after `docs/backend-completion-spec.md` was
finished. Every backend production file and the whole frontend source was read;
all 39 registered routes were enumerated from the live URL resolver and diffed
against `docs/api_contract.md`; 14 adversarial probes were written, run against
a real PostgreSQL database, and deleted afterwards.

This file exists because `KG-036`..`KG-054` are cited in code comments and in
`docs/decision_log.md`, and nothing in the repository defined them. It is the
lookup table for those IDs.

Numbering continues the `KG-nnn` register opened by
`2026-09-13-independent-repository-audit.md`, which holds `KG-001`..`KG-035`.

## Verdict at the time of audit

No domain invariant was broken and nothing required halting work. The findings
clustered around one theme: **the audit log recorded what the API did, not what
the system did.** Django admin - described in the docs as a first-class
operational surface, and at the time the only usable interface, since the
frontend has no grading screens - wrote students, users, sessions and
candidates with no audit event at all. Because every test drove the API, every
test agreed the trail was complete.

Two hypotheses formed while reading were **wrong**, and are recorded because an
audit that reports only confirmations is not measuring itself:

- `OPTIONS` was expected to bypass `permission_map`. DRF names that action
  `metadata`, which no viewset declares, so it is denied. The code was right.
- The admin's refusal to cancel a locked session was expected to be the missing
  reason field alone. The authority check fires first. The conclusion survived
  only because the probe was re-run with the right persona.

## Findings

All statuses below are as of 2026-09-15, after remediation.

| ID | Finding | Sev | Status |
|---|---|---|---|
| KG-036 | Every write made through Django admin was unaudited (sessions, candidates, students, users - create, update and delete) | P1 | **Fixed** |
| KG-037 | `assessor_notes` could be rewritten with no audit event - only a `result` change recorded anything | P1 | **Fixed** |
| KG-038 | `docs/api_contract.md` declared the audit API and promotions unimplemented; both had shipped. Also documented a 400 that is a 405, omitted the withdraw endpoint, and claimed `current_rank` was never updated | P1 | **Fixed** |
| KG-039 | Login throttle counters are per-process; no `CACHES` configured | P1 | **Closed by decision** |
| KG-040 | `CandidateAssessmentAdmin` called the service without `actor=`, so admin-driven assessment events had a null actor | P2 | **Fixed** |
| KG-041 | Withdrawing from a locked session deleted a draft/proposed outcome with no record of what it had said | P2 | **Fixed** |
| KG-042 | `UserAttributeSimilarityValidator` never ran on user creation - a password identical to the account's own email was accepted | P2 | **Fixed** |
| KG-043 | The Django admin add-user form ran no password validators at all; `"1234"` was accepted where the API rejected it | P2 | **Fixed** |
| KG-044 | `Promotion` and finalised `CandidateOutcome` blocked `save()`/`delete()` but not `QuerySet.update()` | P2 | **Fixed** |
| KG-045 | The login form reported throttling, 5xx and dropped connections all as "Email or password is incorrect." | P2 | **Fixed** |
| KG-046 | The `DJANGO_DATABASE_ENGINE=sqlite` branch could not migrate or run the domain | P3 | **Fixed** |
| KG-047 | Nothing asserted the production throttle rate or `LoginView.throttle_scope` | P3 | **Fixed** |
| KG-048 | Instructors could read `USER_*` audit events despite `/api/users/` being administrator-only | P3 | **Fixed** |
| KG-049 | `parse_date_filter` was defined identically in two apps | P3 | **Fixed** |
| KG-050 | A locked session could not be cancelled from Django admin - the form had no `cancellation_reason` field | P3 | **Fixed** |
| KG-051 | A no-op candidate PATCH still wrote a `CANDIDATE_UPDATED` event | P3 | **Fixed** |
| KG-052 | `SECURE_PROXY_SSL_HEADER` defaulted on in production, trusting a spoofable header | P3 | **Fixed** |
| KG-053 | The recorded backend test count in `docs/current-system.md` was stale | P3 | **Fixed** |
| KG-054 | Django admin could not validate **any** grading-session status change; `ModelForm._post_clean()` re-ran the model guard that rejects direct status writes, so `save_model()`'s correct routing was never reached | P2 | **Fixed** |

`KG-054` was not in the original audit. It was found while remediating
`KG-050`, and only because the fix was driven through the real `ModelForm`
rather than the stub form the existing admin tests used - a stub never
exercises `Meta.fields` or `full_clean()`. Every admin status-change test in
the suite had been passing without ever validating a form.

## Decisions rather than code changes

**KG-039** was closed by decision, not by a fix. The deployment is
single-process, so Django's default per-process cache gives the intended
10/min bound with no gap; nothing in this repository even defines a
multi-process deployment (`compose.yaml` has no `web` service, no Dockerfile,
no process manager). If that ever changes the throttle needs Redis, not the
database cache. Recorded in `docs/decision_log.md`, 2026-09-15.

**KG-048** was decided as a policy question before being implemented:
logistics - running the app rather than running a grading - is an
administrator concern, matching the capability map of 2026-09-13. Instructors
lost visibility of `USER_*` events rather than the events being hidden from
everyone. Recorded in `docs/decision_log.md`, 2026-09-15.

## Two bugs introduced and caught during remediation

Recorded because they say something about the method, not just the result.

1. Wiring admin through the audit services **broke the no-op detection added
   for KG-051**. Django admin constructs the new field values onto the model
   instance *before* `save_model()` runs, so `apply_candidate_update()`,
   `update_student()` and `update_platform_user()` were comparing the new
   values against themselves and treating every real admin edit as a no-op.
   All three now read a fresh row from the database for the "before" snapshot.
   Caught by testing through `save_model()` rather than the service alone.

2. An edit split an existing test in two. A partial read had truncated
   `test_cancelling_a_locked_session_requires_authority_and_a_reason`, and the
   insertion landed inside it, orphaning its second half onto the new test.
   Caught before the suite was committed; the original was reconstructed.

## What was left alone deliberately

- **KG-020** (9 npm advisories, 5 high) remains open. All are in dev/build
  tooling, none in the shipped `react`/`react-dom` runtime. CI gates at
  `--audit-level=critical` with that reasoning recorded in the workflow.
- **KG-012** (unreachable withdrawn-outcome branch, from the 2026-09-13 audit)
  was re-verified as still present in `validate_outcome_assessment_state`: the
  `!= COMPLETED` check above it means the `== WITHDRAWN` branch cannot be
  reached. Still open, still cosmetic.
- The `metadata` action is undeclared on every viewset, so `OPTIONS` is denied
  for all callers. Fail-closed and harmless; no client uses it.

## Verification at the close of remediation

Run against a live PostgreSQL 17 container and a fresh test database:

- 439 backend tests pass; every test file also passes in isolation, so the
  suite has no order dependence.
- `ruff check`, `ruff format --check`, `mypy --strict` over 100 source files,
  `makemigrations --check`, and `check --deploy --fail-level WARNING` are clean.
- Frontend lint, typecheck, 17 tests and build are clean.
- Every guard added during remediation was proven load-bearing by reverting it,
  watching the corresponding test fail, and restoring it byte-identically.

## Subsequent hygiene pass, same day

Found while cleaning the repository rather than during the audit proper:

- `backend/README.md` carried the same class of staleness as KG-038: it stated
  that the feature "does not update `Student.current_rank`" and that
  promotions "remain deferred", and its session transition list omitted
  `LOCKED -> CANCELLED`. Corrected, and a `Promotions And Rank History`
  section was added.
- `docs/decision_log.md` had **no entry for the promotion and rank-history
  design** despite the feature being fully shipped. The entry was recovered
  from uncommitted work stranded in the Codex worktree
  (`feature/promotion-rank-history`), verified line by line against the
  implementation, annotated where later work strengthened it, and committed.
  The worktree was then removed.
