# API Contract for Single‑Discipline Grading App

This document defines REST endpoints for the grading management system.  All endpoints are prefixed with `/api/` and return JSON responses. Authentication uses Django session authentication with CSRF protection for the React frontend.

## 1. Authentication

| Method | Endpoint              | Description                       |
|-------|------------------------|-----------------------------------|
| POST  | /api/auth/login/       | Authenticate with email and password and establish a session |
| POST  | /api/auth/logout/      | Clear the current session |
| GET   | /api/auth/me/          | Get the current user profile       |

Login failures use a generic error and must not reveal whether an account exists. Unsafe session-authenticated requests require a CSRF token. The React frontend obtains the CSRF cookie from `/api/auth/me/` during startup and sends credentials with API requests.

## 2. Users and Roles (Admin only)

| Method | Endpoint                      | Description                                   |
|--------|------------------------------|-----------------------------------------------|
| GET    | /api/users/                  | List users                                    |
| POST   | /api/users/                  | Create a new user                             |
| GET    | /api/users/{id}/             | Retrieve a user                               |
| PATCH  | /api/users/{id}/             | Update user details                           |
| GET    | /api/roles/                  | List available roles                          |
| POST   | /api/users/{id}/roles/       | Assign roles to a user                        |

## 3. Organisation and Branches

| Method | Endpoint                          | Description                                       |
|--------|------------------------------------|---------------------------------------------------|
| GET    | /api/organisations/                | List organisations (V1 returns one)               |
| POST   | /api/organisations/                | Create an organisation (initially internal only)  |
| GET    | /api/organisations/{id}/           | Retrieve organisation details                     |
| PATCH  | /api/organisations/{id}/           | Update organisation                               |
| GET    | /api/branches/                     | List all branches                                 |
| POST   | /api/branches/                     | Create a branch                                   |
| GET    | /api/branches/{id}/                | Retrieve branch details                           |
| PATCH  | /api/branches/{id}/                | Update branch details                             |

## 4. Students

| Method | Endpoint                                   | Description                                      |
|-------|---------------------------------------------|--------------------------------------------------|
| GET   | /api/students/                              | List students; supports filters (rank, branch)   |
| POST  | /api/students/                              | Create a student profile                         |
| GET   | /api/students/{id}/                         | Retrieve a student profile                       |
| PATCH | /api/students/{id}/                         | Update student details                          |
| DELETE| /api/students/{id}/                         | Archive/deactivate a student                    |
| GET   | /api/students/{id}/history/                 | View promotion history                          |
| GET   | /api/students/{id}/eligibility/             | View current eligibility status                 |
| POST  | /api/students/{id}/recommendations/         | Submit a recommendation (V2)                    |
| GET   | /api/students/{id}/recommendations/         | List recommendations                            |

## 5. Ranks and Pathways

Current implementation note: the rank foundation exposes a read-only
authenticated `/api/ranks/` endpoint for the seeded active rank catalogue.
Writable rank and pathway endpoints are deferred until progression pathway and
syllabus management workflows are confirmed.

| Method | Endpoint                                  | Description                                       |
|--------|--------------------------------------------|---------------------------------------------------|
| GET    | /api/ranks/                                | List ranks (ordered)                              |
| GET    | /api/ranks/{id}/                           | Retrieve rank details                             |
| POST   | /api/ranks/                                | Deferred                                          |
| PATCH  | /api/ranks/{id}/                           | Deferred                                          |
| GET    | /api/rank-pathways/                        | Deferred                                          |
| POST   | /api/rank-pathways/                        | Deferred                                          |
| GET    | /api/rank-pathways/{id}/                   | Deferred                                          |
| PATCH  | /api/rank-pathways/{id}/                   | Deferred                                          |

## 6. Syllabus Catalogue

Current implementation note: the syllabus foundation exposes authenticated
read-only lookup endpoints for seeded WKSA Version 2014 syllabus items and
rank/age-band requirements. Syllabus version management, grading-session
selection, assessment results, scoring, attendance, and promotion decisions are
deferred.

| Method | Endpoint                              | Description                                      |
|--------|----------------------------------------|--------------------------------------------------|
| GET    | /api/syllabus/items/                   | List active syllabus items                       |
| GET    | /api/syllabus/items/{id}/              | Retrieve a syllabus item                         |
| POST   | /api/syllabus/items/                   | 405; API writes deferred                         |
| PUT    | /api/syllabus/items/{id}/              | 405; API writes deferred                         |
| PATCH  | /api/syllabus/items/{id}/              | 405; API writes deferred                         |
| DELETE | /api/syllabus/items/{id}/              | 405; API writes deferred                         |
| GET    | /api/syllabus/requirements/            | List active requirements                         |
| GET    | /api/syllabus/requirements/{id}/       | Retrieve a syllabus requirement                  |
| POST   | /api/syllabus/requirements/            | 405; API writes deferred                         |
| PUT    | /api/syllabus/requirements/{id}/       | 405; API writes deferred                         |
| PATCH  | /api/syllabus/requirements/{id}/       | 405; API writes deferred                         |
| DELETE | /api/syllabus/requirements/{id}/       | 405; API writes deferred                         |

Requirement list filters:

- `rank_code`: rank catalogue code, such as `YELLOW` or `DAHN_BO`.
- `age_band`: one of `AGE_8_AND_UNDER`, `AGE_9_TO_12`, `AGE_13_TO_17`, or
  `AGE_18_AND_OVER`.

`SyllabusItem` represents the stable assessable item. `SyllabusRequirement`
maps that item to a target rank and age band, including `required`, `sequence`,
`start_number`, `end_number`, and concise notes. Numbered technique and weapon
ranges are stored on the requirement, not encoded into duplicate item records.
Form sections or parts from the source charts are currently preserved as notes.

## 7. Eligibility (V2)

| Method | Endpoint                                 | Description                                        |
|--------|-------------------------------------------|----------------------------------------------------|
| POST   | /api/eligibility/recalculate/             | Trigger recalculation for all students             |
| GET    | /api/eligibility/students/                | List students with eligibility status              |
| GET    | /api/eligibility/students/{student_id}/   | Retrieve eligibility for a specific student        |

## 8. Grading Sessions

Current implementation note: the grading-session foundation exposes
authenticated CRUD endpoints for sessions and candidates. It does not create
assessment rows, item results, pass/fail/conditional outcomes, scoring,
promotion decisions, attendance outside grading participation, certificates,
notifications, or payment workflows.

| Method | Endpoint                              | Description                                      |
|-------|----------------------------------------|--------------------------------------------------|
| GET   | /api/gradings/sessions/                | List grading sessions                            |
| POST  | /api/gradings/sessions/                | Create a grading session                         |
| GET   | /api/gradings/sessions/{id}/           | Retrieve a grading session                       |
| PUT   | /api/gradings/sessions/{id}/           | Replace a grading session                        |
| PATCH | /api/gradings/sessions/{id}/           | Update a grading session                         |
| DELETE| /api/gradings/sessions/{id}/           | Delete only when status is DRAFT or CANCELLED    |
| GET   | /api/gradings/candidates/              | List grading candidates                          |
| POST  | /api/gradings/candidates/              | Add a candidate to a draft or open session       |
| GET   | /api/gradings/candidates/{id}/         | Retrieve a grading candidate                     |
| PUT   | /api/gradings/candidates/{id}/         | Replace a grading candidate                      |
| PATCH | /api/gradings/candidates/{id}/         | Update candidate status or notes                 |
| DELETE| /api/gradings/candidates/{id}/         | Delete only while parent session is DRAFT or OPEN|

Session fields:

- `title`: required human-readable title.
- `grading_date`: required date.
- `status`: `DRAFT`, `OPEN`, `LOCKED`, `COMPLETED`, or `CANCELLED`; defaults to
  `DRAFT`.
- `location`: optional human-readable location.
- `notes`: optional notes.
- `created_by`: read-only; assigned from the authenticated user.

`grading_date` can be changed only before candidates are added. Once a session
has candidates, its date is fixed so stored candidate age-band snapshots do not
become silently inconsistent.

Session lifecycle:

- `DRAFT -> OPEN`
- `DRAFT -> CANCELLED`
- `OPEN -> LOCKED`
- `OPEN -> CANCELLED`
- `LOCKED -> COMPLETED`
- `LOCKED -> OPEN`

`LOCKED -> OPEN` is allowed as a narrow administrative correction path while
assessment records are deferred. `CANCELLED` and `COMPLETED` are terminal.
Sessions do not auto-transition based on dates.

Session filters:

- `status`
- `grading_date`
- `grading_date_from`
- `grading_date_to`

Candidate fields:

- `session`: grading session id.
- `student`: student id.
- `testing_for_rank`: rank id.
- `age_band`: read-only snapshot derived from student date of birth and session
  grading date.
- `status`: `REGISTERED`, `WITHDRAWN`, or `COMPLETED`; defaults to
  `REGISTERED`.
- `notes`: optional notes.

Candidate filters:

- `session`
- `student_wksa_id`
- `testing_for_rank_code`
- `age_band`
- `status`

Candidate creation rejects locked, completed, and cancelled sessions; duplicate
student/session pairs; invalid testing-for ranks; and missing student date of
birth. The testing-for rank must be the next active rank after the student's
current rank. This feature does not update `Student.current_rank`; promotion
history and final decisions remain deferred.

Candidate `student`, `testing_for_rank`, `status`, and `notes` can be changed
only while the parent session is `DRAFT` or `OPEN`. `age_band` is not client
writable. Locked, completed, and cancelled sessions reject candidate updates and
deletes.

The applicable syllabus query is service-layer only for this slice. It returns
active `SyllabusRequirement` rows for the candidate testing rank and age-band
snapshot in deterministic sequence order. Immutable per-candidate requirement
snapshots will be added when assessment records are introduced.

## 9. Assessments

| Method | Endpoint                                             | Description                                          |
|-------|-------------------------------------------------------|------------------------------------------------------|
| GET   | /api/grading-candidates/{id}/assessments/             | List assessments for a candidate                     |
| POST  | /api/grading-candidates/{id}/assessments/             | Create an assessment (examiner begins scoring)       |
| GET   | /api/assessments/{id}/                                | Retrieve assessment details                          |
| PATCH | /api/assessments/{id}/                                | Update assessment (autosave)                         |
| POST  | /api/assessments/{id}/submit/                         | Submit assessment                                   |
| GET   | /api/assessments/{id}/scores/                         | List scores for an assessment                       |
| POST  | /api/assessments/{id}/scores/                         | Create or update a score entry                      |

## 10. Decisions and Promotions

| Method | Endpoint                                       | Description                                  |
|--------|-----------------------------------------------|----------------------------------------------|
| POST   | /api/grading-candidates/{id}/final-decision/   | Create a final decision for a candidate      |
| GET    | /api/final-decisions/{id}/                    | Retrieve decision details                    |
| POST   | /api/promotions/{final_decision_id}/confirm/  | Confirm a promotion and create record       |
| GET    | /api/promotions/                             | List promotions                             |
| GET    | /api/promotions/{id}/                        | Retrieve promotion details                  |

## 11. Certificates

| Method | Endpoint                                           | Description                                      |
|--------|-----------------------------------------------------|--------------------------------------------------|
| POST   | /api/promotions/{promotion_id}/certificate/         | Generate a certificate PDF                       |
| GET    | /api/certificates/{id}/                            | Retrieve certificate metadata                    |
| GET    | /api/certificates/{id}/download/                   | Download certificate file                        |

## 12. Reports

| Method | Endpoint                                | Description                                        |
|--------|------------------------------------------|----------------------------------------------------|
| GET    | /api/reports/eligibility/                | Report of students by eligibility status           |
| GET    | /api/reports/outcomes/                   | Report of grading outcomes (pass/fail/defer)       |
| GET    | /api/reports/rank-distribution/          | Distribution of students per rank                  |
| GET    | /api/reports/deferred-candidates/        | List of deferred/reassess candidates               |

## 13. Audit

| Method | Endpoint                                    | Description                                  |
|--------|----------------------------------------------|----------------------------------------------|
| GET    | /api/audit-events/                           | List audit events (admin only)               |
| GET    | /api/audit-events/{entity_type}/{entity_id}/ | Audit events for a specific entity           |

---

This contract should be refined during implementation, but it provides comprehensive coverage of the backend endpoints needed for the grading application.
