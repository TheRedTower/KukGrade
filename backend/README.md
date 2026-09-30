# Backend

Django and Django REST Framework API for KukGrade. This is the developer's
guide to the code; the endpoint-by-endpoint HTTP contract is
`../docs/api_contract.md`, and what exists today is
`../docs/current-system.md`.

## Configuration

Settings fail closed. `DJANGO_DEBUG` defaults to **false**, and when debug is
off a missing `DJANGO_SECRET_KEY` raises `ImproperlyConfigured` rather than
falling back to a known key, so an unconfigured deployment refuses to start
instead of serving debug tracebacks signed with a key that is in the
repository.

With `DJANGO_DEBUG=false` the transport-security settings
(`SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS`, `SECURE_HSTS_INCLUDE_SUBDOMAINS`,
`SECURE_HSTS_PRELOAD`) and the secure cookie flags all default to their
hardened values; each can be overridden individually to opt out.
`DJANGO_BEHIND_TLS_PROXY` is the exception and defaults off even in
production - see the comment in `kukgrade/settings.py`. The browsable API
renderer is only registered when debug is on. `manage.py check --deploy
--fail-level WARNING` is clean and enforced in CI.

For local development copy `.env.example` to `.env` and export it, or set
`DJANGO_DEBUG=true` in your shell.

Tests and type checking use `kukgrade.settings_test`, which sets a development
environment and then star-imports the real settings module. This is necessary
because pytest imports Django settings before it loads `conftest.py`, so the
environment cannot be prepared there. The production branch of the real
settings module is covered directly by `kukgrade/tests.py`.

## Commands

The canonical verification list is in `../docs/development-workflow.md`.
Day to day:

```sh
uv sync
uv run python manage.py migrate          # needs `docker compose up -d db`
uv run python manage.py runserver 0.0.0.0:8000
uv run pytest
```

## How the code is organised

Each app is described in `../docs/architecture.md`. The conventions that hold
everywhere:

- **Services own every state change.** `<app>/services.py` (`gradings` also has
  `assessment_services.py`, `outcome_services.py` and `legacy_services.py`)
  validates a
  change, writes it in a transaction, and records its audit event with
  `audit.recording.record()` in that same transaction. Views, serializers,
  and Django admin all call the services, so a change is validated and
  audited identically however it arrives. Services raise Django's
  `ValidationError` and views let it propagate: `custom_exception_handler`
  (`kukgrade/exceptions.py`) turns it into the standard 400 envelope, keeping
  its field keys.
- **Models refuse the illegal states that matter most.** Session status
  changes, deletion rules, and the immutability of finalised outcomes,
  promotions, audit events and imported source text are enforced in
  `save()`/`delete()`/`clean()` and custom querysets, so they hold from the
  shell, bulk querysets and admin - not only through the API. The few
  deliberate bypasses (administrator hard deletes that reassign attribution
  or cascade history) call the unbound `models.QuerySet.update`/`delete` at
  one documented call site each. Assessment rules - a snapshot's copied
  requirement text, and a completed assessment staying completed - are
  service invariants: the services, serializers and admin enforce them, but
  a raw ORM write from the shell is not refused (KG-A22).
- **Permissions fail closed.** Every viewset declares a `permission_map`;
  `accounts.permissions.HasRequiredPermissions` denies any undeclared
  action. Master authority and the audit-log grant are per-user permissions
  in `accounts.permissions.AUTHORITY_PERMISSIONS`, never a role.
- **Lists are uniform.** Every list endpoint is paginated
  (`kukgrade.pagination.DefaultPagination`: 50 per page, `?page_size=` up to
  200, so one candidate's roughly 40 assessment items fit a page), and every
  query-parameter filter goes through `kukgrade/filtering.py`, where a value
  that cannot match returns an empty page.
- **The schema is the contract.** Every custom action declares its request
  and response with `@extend_schema`, and the bulk, summary, and import
  responses serialize through those declared serializers. Regenerate
  `schema.yml` after any serializer change; CI fails if it is stale, and the
  frontend's types are generated from it.
- **Bulk endpoints process rows independently**
  (`gradings.service_support.each_independently`): each row runs the single-item
  service in its own savepoint, and the response lists what succeeded plus
  an `errors` map from row index to that row's messages.
- **Test builders live in `testing.py`** in their own app
  (`kukgrade/testing.py`, `audit/testing.py`, `data_imports/testing.py`), not
  in another app's `tests.py`.

## Seeded reference data

Migrations seed the rank catalogue
(`ranks/migrations/0002_seed_rank_catalogue.py`), the WKSA Version 2014
syllabus from the Junior and Adult/Youth Testing Requirement Charts
(`syllabus/migrations/0002_seed_wksa_2014_syllabus.py`, with the adults'
seven black-belt technique sets completed in `0003_adult_jkn_technique_sets.py`),
and the "Deleted User" placeholder account a hard-deleted user's history is
reassigned to
(`accounts/migrations/0005_seed_deleted_user_placeholder.py`). Numbered
technique ranges live on `SyllabusRequirement`; form parts remain concise
notes.

## Data imports

`data_imports` handles both batch kinds - student rosters and the historical
KSW Colchester grading workbook - through one `ImportBatch` lifecycle.
Uploaded files sit in private storage (`STORAGES["import_uploads"]`, never a
public URL) until commit, cancel, or `manage.py expire_stale_import_batches
--hours 24`, and are deleted only once that transaction has committed.
Spreadsheets are read row by row with openpyxl and `csv`, under limits
checked while reading (`data_imports/parsers.py`). Full detail in
`../docs/data-import-and-legacy-migration.md`.
