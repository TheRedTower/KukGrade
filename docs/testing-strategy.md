# Testing Strategy

## Confirmed Expectations

- Every feature requires success, validation, and permission tests where applicable.
- Database changes require migrations and tests.
- Existing relevant tests must pass before finishing a change.
- Formatting, linting, and type checks should pass before finishing implementation work.
- Use explicit fixtures and anonymised or synthetic test data.
- Do not use real student data in tests, fixtures, screenshots, or seed files.

## Backend Testing

Planned backend test coverage:

- model constraints and relationships.
- serializer validation.
- DRF endpoint success paths.
- DRF endpoint validation failures.
- role and object-level permission boundaries.
- grading workflow state transitions.
- syllabus version immutability and historical references.
- age-band and syllabus-version selection behavior once the date rule is confirmed.
- audit events for sensitive writes.
- promotion or rank-change behavior once the promotion process is confirmed.

`pytest` is the expected backend test runner once the Django project exists.

## Frontend Testing

Planned frontend test coverage:

- route-level rendering for main workflows.
- form validation states.
- API integration boundaries using mocked responses.
- permission-aware UI states.
- assessment draft editing flows.
- final decision review screens.
- syllabus rendering from API data rather than hard-coded rules.

React Testing Library with Vitest or Jest is expected once the React project exists. The choice remains unresolved.

## Contract And Workflow Testing

API behavior should be covered by tests before frontend work depends on it. When API contracts change:

- update documentation.
- update backend tests.
- update frontend API client types or mocks.
- update frontend tests that depend on the changed behavior.

## Test Data Rules

- Use synthetic names, membership numbers, branches, and comments.
- Keep fixtures explicit and small.
- Include examples across ranks and age bands only when needed for the behavior under test.
- Do not include production exports or copied real grading comments.

## Unresolved Decisions

- Exact backend test command.
- Exact frontend test runner: Vitest or Jest.
- Whether to add end-to-end browser tests in V1.
- Whether API schema generation is required before frontend scaffolding.
- Whether test data factories should use a package or plain fixtures.
