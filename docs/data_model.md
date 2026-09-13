# Data Model for Single-Discipline Grading App

Status: legacy/target planning input.

This document is not the current database schema. It records a broader target
model from early planning and uses names that do not always match the
implemented Django models. Use `docs/current-system.md`, migrations, and model
code for current implementation. Use this document only as planning context
when a future slice explicitly reconciles it with accepted decisions.

This document defines the main entities and relationships in the martial‑arts grading application.  It is intended to guide database schema implementation in Django and help align API endpoints with the underlying data.

## 1. Identity and Organisations

### User
Represents an authenticated account.  A user may have multiple roles across different branches.

| Field         | Type              | Notes                                        |
|---------------|-------------------|-----------------------------------------------|
| id            | UUID / AutoField  | Primary key                                   |
| email         | Email             | Unique; used for login                        |
| password_hash | String            | Securely stored password hash                 |
| first_name    | String            |                                               |
| last_name     | String            |                                               |
| is_active     | Boolean           | Indicates if account is enabled               |
| last_login    | DateTime          |                                               |
| created_at    | DateTime          |                                               |
| updated_at    | DateTime          |                                               |

### Role
Defines a permission group (admin, instructor, examiner, etc.).

| Field       | Type     | Notes              |
|-------------|----------|---------------------|
| id          | AutoField| Primary key         |
| name        | String   | Unique role name    |
| description | Text     | Optional description|

### UserRole
Associates a user with a role at a given branch (object‑level permissions).

| Field     | Type      | Notes                             |
|-----------|-----------|------------------------------------|
| id        | AutoField | Primary key                        |
| user_id   | FK User   |                                    |
| role_id   | FK Role   |                                    |
| branch_id | FK Branch | Nullable; null indicates org level |
| assigned_at| DateTime |                                    |

### Organisation
Top‑level entity for a school or federation.  In the initial release there is one organisation.

| Field    | Type      | Notes                 |
|----------|-----------|------------------------|
| id       | AutoField | Primary key            |
| name     | String    |                        |
| slug     | String    | For URL/path use       |
| active   | Boolean   |                        |
| created_at| DateTime|                        |

### Branch
Represents a physical location or dojo.

| Field         | Type      | Notes             |
|---------------|-----------|--------------------|
| id            | AutoField | Primary key        |
| organisation_id | FK Organisation |             |
| name          | String    |                    |
| code          | String    | Identifier         |
| address       | String    | Optional           |
| active        | Boolean   |                    |
| created_at    | DateTime  |                    |

## 2. Student Domain

### StudentProfile
Stores personal and membership information for each student.

| Field             | Type      | Notes                                                |
|-------------------|-----------|-------------------------------------------------------|
| id                | AutoField | Primary key                                           |
| organisation_id   | FK Organisation |                                               |
| branch_id         | FK Branch | Home branch                                           |
| membership_number | String    | Unique per organisation (e.g., WKSA ID)               |
| first_name        | String    |                                                       |
| last_name         | String    |                                                       |
| preferred_name    | String    | Nullable                                              |
| date_of_birth     | Date      |                                                       |
| email             | Email     | Nullable                                              |
| phone             | String    | Nullable                                              |
| join_date         | Date      | When the student joined the organisation              |
| status            | Enum      | Active, inactive, graduated, etc.                    |
| current_rank_id   | FK Rank   | The student’s current belt/grade                     |
| notes_private     | Text      | Restricted notes                                      |
| created_at        | DateTime  |                                                       |
| updated_at        | DateTime  |                                                       |

### AttendanceRecord (optional for V1)
Tracks class attendance; used by the eligibility engine in later versions.

| Field      | Type      | Notes                                  |
|------------|-----------|-----------------------------------------|
| id         | AutoField | Primary key                             |
| student_id | FK StudentProfile |                                 |
| class_date | Date      |                                         |
| attended   | Boolean   | Did the student attend?                 |
| recorded_by| FK User   |                                         |
| created_at | DateTime  |                                         |

### Recommendation
Instructor recommendation for a student to be considered for grading.

| Field           | Type       | Notes                                          |
|-----------------|------------|-------------------------------------------------|
| id              | AutoField  | Primary key                                    |
| student_id      | FK StudentProfile |                                       |
| target_rank_id  | FK Rank    | The rank the student is aiming to achieve      |
| recommended_by  | FK User    | Instructor who recommends                      |
| status          | Enum       | Pending, approved, denied                      |
| comments        | Text       | Optional notes                                 |
| created_at      | DateTime   |                                               |
| expires_at      | DateTime   | Optional expiry                               |

## 3. Ranks and Syllabus

### Rank
Represents a belt or grade in the discipline.

| Field           | Type      | Notes                                   |
|-----------------|-----------|------------------------------------------|
| id              | AutoField | Primary key                              |
| organisation_id | FK Organisation |                                  |
| name            | String    | e.g. “White Belt”, “Brown Belt”         |
| code            | String    | Short identifier                        |
| display_order   | Integer   | Determines ordering                     |
| color_label     | String    | Optional; for UI                         |
| is_black_belt   | Boolean   | Whether this rank counts as a black belt |
| minimum_age     | Integer   | Minimum age requirement (nullable)       |
| active          | Boolean   |                                          |

### RankPathway
Defines allowed progression from one rank to the next.

| Field                 | Type      | Notes                                  |
|-----------------------|-----------|----------------------------------------|
| id                    | AutoField | Primary key                             |
| from_rank_id          | FK Rank   | Source rank                             |
| to_rank_id            | FK Rank   | Target rank                             |
| min_time_in_grade_days| Integer   | Minimum days since last promotion       |
| min_attendance_count  | Integer   | Minimum classes attended (nullable)    |
| requires_recommendation | Boolean | Whether an instructor recommendation is required |
| requires_manual_review| Boolean   | Whether manual approval is required     |
| active                | Boolean   |                                         |

### SyllabusVersion
Allows versioning of criteria/rubrics to preserve historical assessments.

| Field        | Type     | Notes                                     |
|--------------|----------|-------------------------------------------|
| id           | AutoField| Primary key                               |
| organisation_id | FK Organisation |                              |
| name         | String   | e.g. “2024 Edition”                       |
| version_code | String   | e.g. “v1”, “v2”                           |
| effective_from| Date    | When this version starts                  |
| effective_to  | Date    | Optional; when it ends                    |
| active       | Boolean  |                                           |

### CriterionCategory
Top‑level grouping for criteria (e.g. Basics, Forms, Sparring).

| Field            | Type      | Notes                                  |
|------------------|-----------|----------------------------------------|
| id               | AutoField | Primary key                             |
| syllabus_version_id | FK SyllabusVersion |                          |
| name             | String    | Category name                          |
| display_order    | Integer   |                                        |
| active           | Boolean   |                                        |

### Criterion
Individual assessment item for a target rank within a syllabus version.  Supports different scoring types.

| Field              | Type      | Notes                                           |
|--------------------|-----------|--------------------------------------------------|
| id                 | AutoField | Primary key                                      |
| syllabus_version_id | FK SyllabusVersion |                                        |
| target_rank_id     | FK Rank    | Rank for which this criterion applies           |
| category_id        | FK CriterionCategory |                                      |
| title              | String    | Name of technique or requirement                |
| description        | Text      | Detailed description                            |
| score_type         | Enum      | pass_fail, numeric, banded, checkbox            |
| weight             | Float     | Weight in aggregated score (0–1)                |
| max_score          | Integer   | Only for numeric scores; otherwise null         |
| passing_threshold  | Integer   | Minimum score or pass level to avoid auto-fail  |
| is_mandatory       | Boolean   | If true, failing this criterion fails the grade |
| comment_required   | Boolean   | Require examiner comment                        |
| display_order      | Integer   |                                                |
| active             | Boolean   |                                                |

## 4. Eligibility and Grading Operations

### EligibilitySnapshot
Precomputes eligibility status for a student aiming for a specific target rank.

| Field                | Type      | Notes                                                     |
|----------------------|-----------|-----------------------------------------------------------|
| id                   | AutoField | Primary key                                              |
| student_id           | FK StudentProfile |                                                  |
| target_rank_id       | FK Rank   | Rank being evaluated                                     |
| status               | Enum      | Eligible, Near Eligible, Not Eligible, Blocked, Pending   |
| current_rank_ok      | Boolean   | Meets prerequisite rank                                   |
| time_in_grade_ok     | Boolean   | Meets min_time_in_grade_days                              |
| attendance_ok        | Boolean   | Meets min_attendance_count                                |
| recommendation_ok    | Boolean   | Recommendation approved                                   |
| manual_block         | Boolean   | True if manually blocked                                  |
| calculated_at        | DateTime  | When snapshot was computed                                |
| calculated_by_system | Boolean   | True if system generated; false if manual override        |
| notes                | Text      | Optional commentary                                       |

### GradingSession
Represents a scheduled grading event.

| Field        | Type       | Notes                                             |
|--------------|------------|---------------------------------------------------|
| id           | AutoField  | Primary key                                        |
| organisation_id | FK Organisation |                                           |
| branch_id    | FK Branch  | Where the session is held (nullable)               |
| title        | String     | Session name                                     |
| venue        | String     | Location description                              |
| session_date | Date       | Date of the event                                 |
| start_time   | Time       | Start time                                        |
| end_time     | Time       | End time                                          |
| status       | Enum       | Draft, Scheduled, In Progress, Finalising, Finalised |
| publish_results| Boolean  | Whether results are visible to students            |
| notes        | Text       | Optional                                          |
| created_by   | FK User    | Who created the session                            |
| created_at   | DateTime   |                                                  |
| updated_at   | DateTime   |                                                  |

### GradingCandidate
Associates a student with a session and the rank they intend to earn.

| Field              | Type      | Notes                                   |
|--------------------|-----------|-----------------------------------------|
| id                 | AutoField | Primary key                              |
| grading_session_id | FK GradingSession |                               |
| student_id         | FK StudentProfile |                               |
| target_rank_id     | FK Rank    |                                        |
| eligibility_snapshot_id | FK EligibilitySnapshot | Nullable             |
| status             | Enum      | Awaiting, Scoring, Reviewed, Finalised |
| added_by           | FK User   | Who added the candidate                |
| added_at           | DateTime  |                                         |

### ExaminerAssignment
Maps examiners to sessions.

| Field              | Type       | Notes                                 |
|--------------------|------------|---------------------------------------|
| id                 | AutoField  | Primary key                            |
| grading_session_id | FK GradingSession |                              |
| examiner_user_id   | FK User    | User who acts as examiner             |
| assigned_by        | FK User    | Who made the assignment               |
| assigned_at        | DateTime   |                                       |

## 5. Assessments and Decisions

### Assessment
Represents the grading form filled by an examiner for one candidate.

| Field            | Type       | Notes                              |
|------------------|------------|------------------------------------|
| id               | AutoField  | Primary key                         |
| grading_candidate_id | FK GradingCandidate |                     |
| examiner_user_id | FK User    | Examiner who assessed               |
| status           | Enum       | Draft, Submitted                    |
| submitted_at     | DateTime   | When submitted                      |
| overall_comment  | Text       | Optional overall notes              |
| recommendation_outcome | Enum | Pass, Fail, Defer, Reassess, None   |
| created_at       | DateTime   |                                    |
| updated_at       | DateTime   |                                    |

### AssessmentScore
Individual line item score or pass flag for a criterion in an assessment.

| Field            | Type      | Notes                                            |
|------------------|-----------|--------------------------------------------------|
| id               | AutoField | Primary key                                      |
| assessment_id    | FK Assessment |                                           |
| criterion_id     | FK Criterion |                                            |
| raw_score        | Integer   | Only for numeric criteria; null otherwise       |
| pass_flag        | Boolean   | Only for pass/fail criteria                     |
| band_value       | Enum      | Only for banded criteria (e.g. “poor”, “good”)  |
| completion_flag  | Boolean   | Only for checkbox criteria                      |
| comment          | Text      | Examiner notes                                  |

### FinalDecision
The official grading outcome after head examiner review.

| Field              | Type      | Notes                                   |
|--------------------|-----------|-----------------------------------------|
| id                 | AutoField | Primary key                              |
| grading_candidate_id | FK GradingCandidate |                             |
| decided_by         | FK User   | Person who makes the final decision     |
| outcome            | Enum      | Pass, Fail, Defer, Reassess            |
| awarded_rank_id    | FK Rank    | Assigned rank if passed                |
| rationale          | Text      | Reason for decision or override       |
| override_flag      | Boolean   | True if overriding examiner outcome    |
| created_at         | DateTime  |                                      |

### PromotionRecord
Record of a successful promotion.

| Field              | Type      | Notes                                   |
|--------------------|-----------|-----------------------------------------|
| id                 | AutoField | Primary key                              |
| student_id         | FK StudentProfile |                                |
| from_rank_id       | FK Rank    | Previous rank                          |
| to_rank_id         | FK Rank    | New rank                               |
| grading_session_id | FK GradingSession |                               |
| final_decision_id  | FK FinalDecision |                                 |
| promoted_at        | DateTime  | Date/time of promotion                  |
| created_by         | FK User    | Who recorded the promotion             |

### Certificate
Links a promotion record to a generated certificate file.

| Field                | Type       | Notes                                |
|----------------------|------------|--------------------------------------|
| id                   | AutoField  | Primary key                           |
| promotion_record_id  | FK PromotionRecord |                              |
| certificate_number   | String     | Unique serial for verification        |
| file_path            | String     | Path or URL to the certificate file   |
| issued_at            | DateTime   | When issued                           |
| issued_by            | FK User    | Who issued                            |
| reissued_from_id     | FK Certificate | Nullable; points to prior cert    |

## 6. Audit

### AuditEvent
Captures significant actions for traceability.

| Field        | Type       | Notes                                      |
|--------------|------------|--------------------------------------------|
| id           | AutoField  | Primary key                                 |
| actor_user_id| FK User    | Who performed the action                    |
| entity_type  | String     | e.g. “StudentProfile”, “FinalDecision”      |
| entity_id    | Integer    | ID of the affected entity                   |
| action       | String     | e.g. “update_rank”, “create_assessment”     |
| summary      | Text       | Short description                           |
| metadata_json| JSON       | Extended details                           |
| created_at   | DateTime   | When the action occurred                    |

---

This data model should be adapted and extended based on real syllabus requirements (age bands, techniques, etc.), but it provides a robust foundation for implementing the grading app’s backend.
