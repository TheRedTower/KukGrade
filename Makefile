# Shortcuts for working on KukGrade locally (docs/development.md). Each target
# runs the same commands the docs list, from the repository root, and `make
# check` runs what the Backend and Frontend CI jobs run (ci.yml).
#   make            lists the targets

BACKEND := cd backend &&
FRONTEND := cd frontend &&
DEBUG := DJANGO_DEBUG=true

.DEFAULT_GOAL := help
.PHONY: help setup hooks db backend frontend types fix test check check-backend check-frontend

help:
	@echo "make setup           install everything and the commit hooks, start the database"
	@echo "make hooks           install the commit hooks (.pre-commit-config.yaml) only"
	@echo "make db              start the local PostgreSQL (compose.yaml)"
	@echo "make backend         migrate, then run the API on http://localhost:8000"
	@echo "make frontend        run the app on http://localhost:5173"
	@echo "make types           regenerate backend/schema.yml and the frontend's API types"
	@echo "make fix             apply Ruff's fixes and formatting, then Prettier"
	@echo "make test            both test suites"
	@echo "make check           every check the Backend and Frontend CI jobs run"

setup: db
	$(BACKEND) uv sync --frozen
	$(FRONTEND) npm ci
	$(MAKE) hooks

hooks:
	uv run --project backend --frozen pre-commit install

db:
	docker compose up -d db

backend:
	$(BACKEND) $(DEBUG) uv run python manage.py migrate
	$(BACKEND) $(DEBUG) uv run python manage.py runserver 0.0.0.0:8000

frontend:
	$(FRONTEND) npm run dev

types:
	$(BACKEND) DJANGO_SETTINGS_MODULE=kukgrade.settings_test uv run python manage.py spectacular --file schema.yml --validate --fail-on-warn
	$(FRONTEND) npm run generate:types

fix:
	$(BACKEND) uv run ruff check --fix .
	$(BACKEND) uv run ruff format .
	$(FRONTEND) npm run format

test:
	$(BACKEND) uv run pytest -n auto
	$(FRONTEND) npm run test

check: check-backend check-frontend

# Needs the local PostgreSQL (make db).
check-backend:
	$(BACKEND) uv sync --frozen
	$(BACKEND) req="$$(mktemp)" && uv export --frozen --no-emit-project -o "$$req" > /dev/null && uvx pip-audit@2.10.1 -r "$$req" --disable-pip --progress-spinner off; status=$$?; rm -f "$$req"; exit $$status
	SKIP=ruff-check,ruff-format,prettier,eslint,stylelint uv run --project backend --frozen pre-commit run --all-files --show-diff-on-failure
	$(BACKEND) uv run ruff check .
	$(BACKEND) uv run ruff format --check .
	$(BACKEND) uv run mypy .
	$(BACKEND) $(DEBUG) uv run python manage.py check
	$(BACKEND) $(DEBUG) uv run python manage.py makemigrations --check --dry-run
	$(BACKEND) DJANGO_SECRET_KEY="$$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')" DJANGO_DEBUG=false DJANGO_ALLOWED_HOSTS=kukgrade.example.com uv run python manage.py check --deploy --fail-level WARNING
	$(BACKEND) DJANGO_SETTINGS_MODULE=kukgrade.settings_test uv run python manage.py spectacular --file schema.yml --validate --fail-on-warn
	git diff --exit-code -- backend/schema.yml
	$(BACKEND) uv run pytest -q -n auto

check-frontend:
	$(FRONTEND) npm ci
	$(FRONTEND) npm run generate:types
	git diff --exit-code -- frontend/src/api/schema.ts
	$(FRONTEND) npm run lint
	$(FRONTEND) npm run format:check
	$(FRONTEND) npm run knip
	$(FRONTEND) npm run typecheck
	$(FRONTEND) npm run test
	$(FRONTEND) npm run build
	$(FRONTEND) npm audit --audit-level=high
