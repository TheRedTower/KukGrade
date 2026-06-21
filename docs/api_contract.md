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

| Method | Endpoint                                  | Description                                       |
|--------|--------------------------------------------|---------------------------------------------------|
| GET    | /api/ranks/                                | List ranks (ordered)                              |
| POST   | /api/ranks/                                | Create a rank                                     |
| GET    | /api/ranks/{id}/                           | Retrieve rank details                             |
| PATCH  | /api/ranks/{id}/                           | Update rank                                       |
| GET    | /api/rank-pathways/                        | List progression pathways                         |
| POST   | /api/rank-pathways/                        | Create or update a pathway                        |
| GET    | /api/rank-pathways/{id}/                   | Retrieve pathway details                          |
| PATCH  | /api/rank-pathways/{id}/                   | Update pathway details                            |

## 6. Syllabus and Criteria

| Method | Endpoint                                              | Description                                      |
|--------|--------------------------------------------------------|--------------------------------------------------|
| GET    | /api/syllabus-versions/                                | List all syllabus versions                       |
| POST   | /api/syllabus-versions/                                | Create a new syllabus version                    |
| GET    | /api/syllabus-versions/{id}/                           | Retrieve syllabus version                        |
| PATCH  | /api/syllabus-versions/{id}/                           | Update syllabus version                          |
| GET    | /api/criterion-categories/                             | List categories (filter by syllabus version)     |
| POST   | /api/criterion-categories/                             | Create a category                                |
| GET    | /api/criterion-categories/{id}/                        | Retrieve category                                |
| PATCH  | /api/criterion-categories/{id}/                        | Update category                                  |
| GET    | /api/criteria/                                         | List criteria (filter by rank, version, category) |
| POST   | /api/criteria/                                         | Create a criterion                               |
| GET    | /api/criteria/{id}/                                    | Retrieve criterion details                        |
| PATCH  | /api/criteria/{id}/                                    | Update criterion                                  |

## 7. Eligibility (V2)

| Method | Endpoint                                 | Description                                        |
|--------|-------------------------------------------|----------------------------------------------------|
| POST   | /api/eligibility/recalculate/             | Trigger recalculation for all students             |
| GET    | /api/eligibility/students/                | List students with eligibility status              |
| GET    | /api/eligibility/students/{student_id}/   | Retrieve eligibility for a specific student        |

## 8. Grading Sessions

| Method | Endpoint                                            | Description                                          |
|-------|------------------------------------------------------|------------------------------------------------------|
| GET   | /api/grading-sessions/                               | List grading sessions                                |
| POST  | /api/grading-sessions/                               | Create a new grading session                         |
| GET   | /api/grading-sessions/{id}/                          | Retrieve session details                              |
| PATCH | /api/grading-sessions/{id}/                          | Update session (status, venue, etc.)                 |
| POST  | /api/grading-sessions/{id}/candidates/               | Add candidates to a session                          |
| POST  | /api/grading-sessions/{id}/assign-examiners/         | Assign examiners                                     |
| POST  | /api/grading-sessions/{id}/status/                   | Change session status (e.g. from draft to scheduled) |

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
