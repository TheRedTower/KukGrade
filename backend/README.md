# Backend

Django and Django REST Framework API for KukGrade.

## Commands

Install dependencies:

```sh
uv sync
```

Run checks:

```sh
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy kukgrade health accounts ranks students syllabus gradings
```

Run migrations against the local PostgreSQL database:

```sh
cd ..
docker compose up -d db
cd backend
uv run python manage.py migrate
```

Run the development server:

```sh
uv run python manage.py runserver 0.0.0.0:8000
```

The public health endpoint is available at `/api/health/`. Authenticated staff
can read the active rank catalogue at `/api/ranks/`; rank writes remain admin
and migration-managed for this foundation slice.

Authenticated staff can also read the syllabus catalogue:

- `/api/syllabus/items/`
- `/api/syllabus/items/{id}/`
- `/api/syllabus/requirements/`
- `/api/syllabus/requirements/{id}/`

Syllabus writes through the API are disabled. Requirement lists support
`rank_code` and `age_band` filters, for example:

```sh
GET /api/syllabus/requirements/?rank_code=YELLOW&age_band=AGE_9_TO_12
```

The current seed is deterministic reference data from the supplied WKSA Version
2014 Junior and Adult/Youth Testing Requirement Charts. Numbered ranges live on
`SyllabusRequirement`; form parts remain concise notes.

## Grading Sessions

Authenticated staff can manage grading sessions and candidates:

- `/api/gradings/sessions/`
- `/api/gradings/sessions/{id}/`
- `/api/gradings/candidates/`
- `/api/gradings/candidates/{id}/`

Session statuses are `DRAFT`, `OPEN`, `LOCKED`, `COMPLETED`, and `CANCELLED`.
Allowed transitions are `DRAFT -> OPEN`, `DRAFT -> CANCELLED`,
`OPEN -> LOCKED`, `OPEN -> CANCELLED`, `LOCKED -> COMPLETED`, and
`LOCKED -> OPEN`. Reopening a locked session is documented as a narrow
administrative correction path until assessment records exist. Completed and
cancelled sessions are terminal.

Candidate statuses are `REGISTERED`, `WITHDRAWN`, and `COMPLETED`. Candidate
`age_band` is derived from the student's date of birth and the session grading
date, then stored as a historical snapshot. Clients cannot set it. Candidate
creation validates that the testing-for rank is the next active rank after the
student's current rank. A session grading date cannot be changed after
candidates have been added. The feature does not update `Student.current_rank`.

Deletion is state-gated: sessions can be deleted only while draft or cancelled;
candidates can be deleted only while their parent session is draft or open.
Candidate `student`, `testing_for_rank`, `status`, and `notes` can be changed
only while the parent session is draft or open.
`created_by`, candidate `student`, and candidate `testing_for_rank` use
protected foreign keys to preserve historical and reference relationships.

Filters:

- Sessions: `status`, `grading_date`, `grading_date_from`, `grading_date_to`.
- Candidates: `session`, `student_wksa_id`, `testing_for_rank_code`,
  `age_band`, `status`.

Applicable syllabus requirements are queried from active `SyllabusRequirement`
rows by candidate testing rank and age-band snapshot. No requirement snapshot
rows, item assessment rows, pass/fail/conditional outcomes, scores, promotion
records, certificates, notifications, or payment workflows exist in this
foundation.
