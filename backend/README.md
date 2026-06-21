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
uv run mypy kukgrade health
```

Run the development server:

```sh
uv run python manage.py runserver 0.0.0.0:8000
```

The initial public health endpoint is available at `/api/health/`.
