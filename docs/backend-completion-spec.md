# Backend Completion Specification

Everything remaining before the backend is done and Phase 3 (frontend) can
start. Written 2026-09-14, after the verification audit, with the decisions of
2026-09-13 and 2026-09-14 applied. Precise enough to implement directly.

Order matters: dependencies are noted per item.

---

## 1 · AuditEvent  (NEXT-018, closes KG-007, KG-034) — **DONE 2026-09-14**

**Why.** Outcome revisions are currently neither gated nor logged. An
instructor may freely overwrite another's proposed outcome, and the Master who
must adjudicate sees only the latest value with no record that it ever said
anything else. The decision was "log it, don't gate it"; this is the log.

### Model — `audit.AuditEvent`

New app `audit`, so the log does not depend on the apps it records.

| Field | Type | Notes |
|---|---|---|
| `actor` | FK(User, PROTECT, null=True) | Null only for system actions; PROTECT keeps the attribution |
| `action` | CharField(64, choices) | See the action list below |
| `entity_type` | CharField(64) | `"CandidateOutcome"`. A plain string, not a ContentType FK: an audit record must outlive the schema it describes |
| `entity_id` | CharField(64) | String so it survives a pk type change |
| `occurred_at` | DateTimeField(auto_now_add) | Indexed |
| `summary` | TextField | Human-readable, safe to show as-is |
| `metadata` | JSONField(default=dict) | `{"before": {...}, "after": {...}}` for revisions; `{}` otherwise |

Indexes: `(entity_type, entity_id, -occurred_at)`, `(-occurred_at)`,
`(action, -occurred_at)`, `(actor, -occurred_at)`.

**Immutable.** `save()` refuses to update an existing row; `delete()` raises on
both the model and a custom QuerySet. Same pattern as `Promotion`.

### Actions

```
SESSION_CREATED  SESSION_TRANSITIONED  SESSION_DELETED
CANDIDATE_REGISTERED  CANDIDATE_UPDATED  CANDIDATE_WITHDRAWN  CANDIDATE_DELETED
ASSESSMENT_GENERATED  ASSESSMENT_STARTED  ASSESSMENT_COMPLETED
ITEM_RESULT_RECORDED
OUTCOME_CREATED  OUTCOME_PROPOSED  OUTCOME_FINALISED
PROMOTION_RECORDED
STUDENT_CREATED  STUDENT_UPDATED  STUDENT_STATUS_CHANGED
USER_CREATED  USER_UPDATED  USER_AUTHORITY_CHANGED
```

Everything is recorded, including each item mark. Roughly 3,200 rows a year at
club scale, which Postgres will not notice, and the reading API filters by
action so routine marking never obscures a decision.

`OUTCOME_PROPOSED` carries the previous proposal in `metadata.before` whenever
one existed. That single field is what makes a disagreement visible.

### Writing

One helper, `audit.record(actor, action, entity, summary, **metadata)`, called
**inside the existing service transaction** so an event cannot survive an
action that rolled back. The `actor` parameters already stubbed at
`services.py:235` and `services.py:447` are the first two call sites.

Services that must call it: `transition_grading_session`,
`withdraw_locked_candidate`, `generate_candidate_assessment`,
`update_candidate_assessment`, `update_candidate_assessment_item`,
`create_candidate_outcome`, `propose_candidate_outcome`,
`finalise_candidate_outcome`, `promote_candidate`, plus student and user
creation and updates.

Several of these take no `actor` today and will need one threaded through from
the serializer.

### API

`GET /api/audit-events/` and `/{id}/`, read-only, paginated, newest first.
Filters: `action`, `entity_type`, `entity_id`, `actor`, `occurred_from`,
`occurred_to`.

Permission `audit.view_auditevent`, granted to **both** role groups. Any
signed-in user can read the log. This is not a new exposure: instructors can
already read every proposal note and decision note through the outcomes API.

### Definition of done

Every listed service writes exactly one event per successful action and none on
rollback; events are immutable from model, queryset and admin; the proposal
revision case carries before and after; a rollback test proves no orphan event.

---

## 2 · Students API  (closes KG-030, KG-024 properly) — **DONE 2026-09-14**

**Why.** `StudentViewSet` exposes only `rank-history`. Students can only be
created or found through Django admin, so no student screen can be built, and
`students.add_student` / `students.change_student` are currently dead grants.

`list`, `retrieve`, `create`, `partial_update`. **No delete** — every
relationship is PROTECT and history is retained by decision.

### Two serializers, deliberately

`StudentListSerializer` — `id`, `wksa_id`, `first_name`, `last_name`,
`current_rank` (+ `_code`, `_name`), `status`, `status_display`.
**No date of birth.**

`StudentDetailSerializer` — the above plus `date_of_birth`, `created_at`,
`updated_at`.

Date of birth appears on a single record an instructor deliberately opened,
never in a list of two hundred. It is the most sensitive field held, on people
who may be minors.

### Behaviour

- Filters: `status`, `current_rank_code`, `search` (icontains across
  `first_name`, `last_name`, `wksa_id`).
- `current_rank` writable on create; the model already refuses to change it
  once promotions exist.
- Status changes via ordinary `PATCH`.
- `wksa_id` immutable after creation — it is the external identifier that
  grading records are matched by.

### Permissions

`list`/`retrieve` → `students.view_student`; `create` → `students.add_student`;
`partial_update` → `students.change_student`. Both groups hold all three.

---

## 3 · Users API  (closes KG-031) — **DONE 2026-09-14**

**Why.** Administrators hold `accounts.*` permissions but cannot use them:
Django admin needs `is_staff`, no group grants it, and no user API exists. So
making Orville a Master currently requires a superuser and manual database
work.

`list`, `retrieve`, `create`, `partial_update`. **No delete** — `PROTECT`
attribution everywhere means a user who has graded anyone cannot be removed;
deactivate instead.

### Fields

Writable: `email`, `first_name`, `last_name`, `role`, `is_active`.
Read-only: `id`, `is_staff`, `is_superuser`, `date_joined`, and the three
authority flags.

`is_staff` and `is_superuser` are **never** writable through the API. Django
admin access is not something this API should be able to hand out.

### Authority as a sub-resource

`PATCH /api/users/{id}/authority/`, body of three booleans:

```json
{"can_make_final_grading_decision": true,
 "can_promote_student": true,
 "can_override_locked_session": false}
```

Mapped to the three Django permissions underneath. This is the same shape
`/api/auth/me/` already returns, so the concept is spelled one way throughout.
Writes `USER_AUTHORITY_CHANGED` with before and after.

Permission: `accounts.change_user` — administrators only. A user **cannot
change their own authority**, even as an administrator; self-granting Master
authority defeats the point of it being separate.

### Passwords

Creation takes an initial password set by the administrator, validated against
Django's configured validators. A separate `POST /api/users/{id}/set-password/`
allows an administrator to reset one. Self-service password change and an
invite flow are deferred — they need email, which this system does not have.

### Permissions

All actions require `accounts.view_user` / `add_user` / `change_user`, held by
the Administrator group only.

---

## 4 · End-to-end workflow test  (closes KG-032) — **DONE 2026-09-15**

One test, pure HTTP, no service-layer shortcuts, following the exact sequence a
frontend must:

```
log in  ->  create student  ->  create session  ->  register candidate
->  open session  ->  generate assessment  ->  start assessment
->  record every required item  ->  lock session  ->  complete assessment
->  create outcome  ->  propose
->  finalise (as Master)  ->  promote (as Master)  ->  read rank history
```

Locking before completing the assessment, not after propose, is not a
simplification - `create_candidate_outcome` refuses unless the session is
already `LOCKED`. Recording item results and completing an assessment are
both allowed in `OPEN` or `LOCKED`, so nothing about entering results needs
to move.

Every step takes its identifiers **from the previous response**, never from an
ORM object. The point is not that each step works — that is already covered —
but that each response carries the fields the next request needs. That contract
is what the frontend depends on and nothing tests it today.

Two personas: an instructor for everything up to `propose`, a Master for
`finalise` and `promote`.

---

## 5 · Concurrency tests  (NEXT-011, closes KG-022)

Real threads, real Postgres connections, a `threading.Barrier` to force genuine
overlap, `django_db(transaction=True)`.

| Scenario | Must hold |
|---|---|
| Two promotions of one outcome | exactly one `Promotion`, one rank change |
| Two outcome creations for one candidate | exactly one outcome |
| Two finalisations of one outcome | one wins, the other is refused |
| Two assessment generations for one candidate | one snapshot set, no duplicates |
| Two competing session transitions | final status is one of them, never a mix |

Marked `@pytest.mark.concurrency` so they can be deselected if they prove flaky
on CI without losing the rest of the suite.

**These must land before NEXT-014** standardises `select_for_update(of=("self",))`,
so that change is made under test rather than on faith.

---

## 6 · Smaller items

**KG-035** — extend the permission completeness test so an action in a
`SENSITIVE_ACTIONS` set must carry its authority class. Today the net catches an
undeclared action but cannot see the three sensitive permissions, because they
are enforced by action-level classes rather than `permission_map`.

**NEXT-015** — `ScopedRateThrottle` on login, and a `LOGGING` config that
records failures without writing personal data or credentials into logs.

**NEXT-014** — standardise the five bare `select_for_update()` calls to
`of=("self",)`. Depends on item 5.

---

## Sequence and estimate

| # | Item | Depends on | Estimate |
|---|---|---|---|
| 1 | AuditEvent | — | ~~1.5–2 days~~ **done** |
| 2 | Students API | — | ~~1 day~~ **done** |
| 3 | Users API | 1 (authority change is audited) | ~~2–3 days~~ **done** |
| 4 | End-to-end test | 2, 3 | ~~0.5 day~~ **done** |
| 5 | Concurrency tests | — | 1 day |
| 6 | Smaller items | 5 for NEXT-014 | 0.5 day |

**Roughly 7–8 days.** At that point every audit finding is closed or
deliberately deferred, and the backend is complete for Phase 3.

## Explicitly not in scope

Syllabus versioning, data erasure, self-service password change, invite flows,
deployment and backups. Each is deferred by a recorded decision.
