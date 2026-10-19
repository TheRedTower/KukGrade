# Documentation Index

Each document has one job. When they disagree, `current-system.md` wins for
what exists today and `decision_log.md` for why.

## Current state and contracts

- `current-system.md` - what is implemented on `dev`, how it was verified,
  and the known gaps. The current-state authority.
- `api_contract.md` - the HTTP contract, endpoint by endpoint. The
  machine-readable form is `../backend/schema.yml`, which declares every
  request and response body and generates the frontend's types.
- `permissions.md` - roles, the Django-permission authority model, and the
  capability map.
- `data-import-and-legacy-migration.md` - student-roster import, historical
  KSW Colchester workbook migration, and the sixteen locked import decisions
  the code cites as "import Decision N".
- `deployment.md` - production image, Traefik/PostgreSQL connections,
  startup, update, and recovery.
- `email-and-credential-lifecycle.md` - the accepted design for optional
  email (Resend), temporary credentials, forced and voluntary password
  changes, and forgotten-password recovery, with the owner's 2026-10-19
  amendments and delivery order at the top.

## Direction and reasoning

- `decision_log.md` - dated decisions and their reasoning.
- `product-requirements.md` - product goals, users, confirmed requirements,
  and scope.
- `architecture.md` - the modular monolith, its app boundaries, and
  deployment shape.
- `action_plan.md` - what remains, in order.
- `development-workflow.md` - working rules, testing expectations, and the
  one canonical list of verification commands.

## Historical snapshots (not current)

Nothing here describes today's system; read `current-system.md` for that.

- `audits/` - dated audit snapshots. Code comments and the decision log cite
  their `KG-nnn` and `KG-Ann` findings. Verify a finding against current code
  before acting on it, and never rewrite a dated audit to look current.

## Working agreement

Before a change that affects behaviour or structure, read the relevant
documents above and confirm any unresolved decision it depends on. Update the
documents a change makes stale in the same change, and record structural,
dependency, data-shape or workflow choices in `decision_log.md`.
