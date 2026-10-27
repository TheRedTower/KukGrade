# Contributing to KukGrade

Thanks for helping. KukGrade is a small project with a specific job (grading
management for Kuk Sool Won schools), so the most useful contributions are bug
reports, fixes, and improvements that fit that job.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Security problems go through [SECURITY.md](SECURITY.md), not public issues.
For anything else you would rather not raise in public, email
[support@kukgrade.co.uk](mailto:support@kukgrade.co.uk).

## Before you start

- **Bugs and small fixes:** open a pull request, or an issue first if you are
  unsure.
- **New features:** open an issue to discuss it first. Check the
  [roadmap](docs/roadmap.md): some things are deliberately not built yet, and
  some need a decision from a school owner before anyone writes code.
- **Never include real student data** anywhere: issues, pull requests,
  screenshots, test fixtures. Use made-up names and the `example.com` domain.

## Setting up

[docs/development.md](docs/development.md) has the full guide. In short, you
need Docker (for PostgreSQL), [uv](https://docs.astral.sh/uv/) and Node 22:

```sh
docker compose up -d db                       # local PostgreSQL
cd backend && uv sync && uv run python manage.py migrate
cd ../frontend && npm ci
```

## Making a change

1. Branch from `dev` (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Keep the change small and focused; unrelated clean-ups belong in their own pull request.
3. Add or update tests. Every feature needs a success case, a validation case
   and a permission case where they apply; a bug fix needs a test that fails
   without the fix.
4. If you change an API request or response, declare it in the backend, then
   regenerate `backend/schema.yml` and `frontend/src/api/schema.ts`. Never
   hand-write an API type in the frontend. Database changes need a migration.
5. Run the checks (CI runs the same ones):

   ```sh
   cd backend  && uv run ruff check . && uv run ruff format --check . && uv run pytest -n auto
   cd frontend && npm run lint && npm run typecheck && npm run test
   ```

6. Open a pull request against `dev` (never `prod`, which only receives what
   `dev` has proved; see [Releasing](docs/development.md#releasing)) and fill in
   the template. Use [Conventional Commit](https://www.conventionalcommits.org/)
   style for the title (`feat: …`, `fix: …`, `docs: …`).

## Ground rules

- The backend is the authority. Permission and grading rules live in the
  backend and are exposed through the API; React components never hard-code
  them.
- Every state change goes through a service function that validates it and
  writes its audit event in the same transaction.
- Do not add a dependency without saying in the pull request what it is for.
- Syllabus, rank and grading history must stay reproducible: changes must not
  alter past records.

## Licence

KukGrade is licensed under the [GNU AGPL-3.0](LICENSE). By contributing you
agree that your contribution is licensed under the same terms.
