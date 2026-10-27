# Security Policy

KukGrade holds personal data about students (names, dates of birth, grading
results and comments), so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately in either way:

1. **GitHub**: open the repository's **Security** tab and choose
   **Report a vulnerability**. This is the preferred route.
2. **Email**: [security@kukgrade.co.uk](mailto:security@kukgrade.co.uk).

Please include what you found, the steps to reproduce it, the version or commit
you tested, and what an attacker could do with it. Do not include real student
data in a report.

You can expect an acknowledgement within a week. We will keep you informed while
the report is investigated, agree a disclosure date with you once a fix is
ready, and credit you in the release notes if you would like that.

## Supported versions

KukGrade has not had a 1.0 release yet. Only the latest commit on `dev` and the
most recent release receive security fixes.

## Scope

In scope: the application in this repository (`backend/`, `frontend/`), the
production image built from the `Dockerfile`, and the Compose files in
`deploy/`.

Out of scope: a deployment's own host, proxy, firewall or DNS configuration,
vulnerabilities in third-party dependencies that are not reachable through
KukGrade (report those upstream), and findings that need an already-compromised
administrator account.

## How KukGrade is built to be safe

You do not need to take this on trust, and it is not a substitute for reporting
anything you find, but it is the intended model:

- **Fails closed.** The app refuses to start without a secret key (the image
  makes one on first start), and HTTPS redirect, secure cookies and HSTS are on
  by default.
- **No default accounts.** There is no default password. The first
  administrator is created with a one-time setup code written to the server's
  log, and Django's `createsuperuser` is switched off.
- **Least privilege, enforced by the server.** Every API action declares the
  permission it needs; an undeclared action is denied. The frontend only
  reflects what the server allows. See [docs/features.md](docs/features.md#roles-and-permissions).
- **Everything sensitive is audited.** An append-only audit log records
  grading decisions, promotions, permission changes, deletions and imports,
  inside the same database transaction as the change itself.
- **Strong passwords, short-lived temporary passwords.** Passwords must be 16
  to 64 characters and are checked against common-password lists; a password an
  administrator issues expires after 24 hours and must be changed at first
  sign-in.
- **A small image.** The production image runs as an unprivileged user, carries
  no tests, documentation or build tools, and does not serve the Django admin
  site over the network.
- **Dependencies are kept current** by Dependabot pull requests, with the full
  test suite and an image smoke test run on each.

## Running KukGrade safely

- Put it behind HTTPS and set `DJANGO_NUM_PROXIES` to the number of proxies in
  front of it. [docs/installation.md](docs/installation.md) explains how and
  includes a script to check it.
- Take backups and test a restore before putting in real student data.
- Keep `.env` and the `data/` folder private; they contain your secret key and
  your database.
- Give people the lowest role they need. Only one trusted instructor normally
  needs final-decision authority.
