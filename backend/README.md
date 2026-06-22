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
uv run mypy kukgrade health accounts ranks students syllabus
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
