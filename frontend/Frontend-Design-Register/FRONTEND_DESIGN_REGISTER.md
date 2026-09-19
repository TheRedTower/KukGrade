# KukGrade Frontend Design Register

Status: accepted design register with implementation tracking

Selected direction: Operational Ledger

Design pass: shared shell, management, assessment and promotion screens

Implementation truth remains `docs/current-system.md`; a screen being selected
here does not by itself mean it has shipped.

## Design decisions

| ID | Decision | Status | Notes |
| --- | --- | --- | --- |
| FDR-001 | Use Quiet Command as the visual base. | Approved | Modern, calm and operational, with a restrained traditional character. |
| FDR-002 | Use ink black, WKSA gold, warm white and charcoal as the principal palette. | Approved | Target balance is approximately 75% light surface, 20% ink structure and 5% gold accent. |
| FDR-003 | Reserve conventional green, amber and red for operational meaning. | Approved | Colour never carries meaning without text or an icon. |
| FDR-004 | Use a persistent ink navigation rail in both themes. | Approved | Maintains brand and positional continuity between light and dark modes. |
| FDR-005 | Use Overview, Students, Gradings and Syllabus for standard instructors; add Audit for the designated Master and administrators, and Users only for administrators. | Approved | Matches the current permission boundary. Reports, Certificates and Settings are excluded from first-release navigation. |
| FDR-006 | Make Overview an operational ledger rather than an analytics dashboard. | Approved | The selected concept prioritises Now, Needs attention, Upcoming and Recent activity. |
| FDR-007 | Use comfortable tablet-first density with minimum 44px interactive targets. | Approved | Data tables remain compact but touch-safe. |
| FDR-008 | Prefer grouped tables and divider-led lists to repeated cards. | Approved | Cards are reserved for genuinely independent content. |
| FDR-009 | Treat Active, Inactive and Left as distinct semantics. | Approved | Active uses success; Inactive is neutral or amber; Left uses a stronger blocking treatment. |
| FDR-010 | Keep the student list privacy-minimised. | Approved | Date of birth appears only on an intentionally opened student record. |
| FDR-011 | Use explicit text-plus-colour status treatments. | Approved | Applies to connectivity, sessions, assessments, outcomes and student status. |
| FDR-012 | Build dark mode from layered charcoal surfaces. | Approved | No simple inversion, pure-black content panels, neon glow or large gold fills. |
| FDR-013 | Use motion for feedback and orientation only. | Approved | Normal motion 120-260ms; reduced-motion support is mandatory. |
| FDR-014 | Keep KukGrade technically installable as a PWA without in-app installation UI. | Approved | Browser or operating-system installation remains available; KukGrade never prompts for it. Full offline assessment sync remains later work. |
| FDR-015 | Design assessment marking as its own workflow pass. | Approved | Includes item results, observations, completion, proposals, final decisions, promotion and offline/save states. |
| FDR-016 | Use Operational Ledger as the selected overview hierarchy. | Approved | Selected from three same-brand structural concepts on 2026-09-15. |
| FDR-017 | Use Rank Chapter as the selected syllabus hierarchy. | Approved | Curriculum, age group and destination rank remain visible above a horizontal rank progression. |
| FDR-018 | Separate universal grading areas from rank-specific Techniques and Forms. | Approved | Mirrors the preliminary WKSA chart structure without reproducing its dense paper layout. |
| FDR-019 | Treat the 2014 adult/youth and junior/little-dragon PDFs as preliminary reference sources. | Approved | Content requires confirmation before it becomes authoritative product data. |
| FDR-020 | Keep syllabus browsing separate from assessment recording. | Approved | P/F controls, comments and judging actions belong in the dedicated assessment pass. |
| FDR-021 | Hide Users from instructors in the first release. | Approved | The current API does not grant instructors `accounts.view_user`; showing a read-only tab would create a dead or forbidden route. |
| FDR-022 | Keep self-service account context in the profile menu. | Approved | Every signed-in user can inspect their own role and Master capabilities without access to the user-management API. |
| FDR-023 | Restrict account, password and authority management UI to administrators. | Approved | Master authority remains three permissions, never a role. |
| FDR-024 | Do not expose PWA installation inside KukGrade. | Approved | No install menu item, banner, modal, toast or onboarding prompt. |
| FDR-025 | Defer the persistent notification centre until a later build. | Approved | The first release has no bell, inbox or unread badge. It uses contextual feedback for saves, validation, errors, connectivity, session state and update readiness. A future centre requires an agreed notification model, sources, permissions, read state, retention and delivery behaviour. |
| FDR-026 | Use a ledger-preview layout when creating a grading session. | Approved | The form stays focused on title, grading date, location and notes while a restrained preview confirms the resulting Draft session. Time and status controls are excluded because they are not part of the current creation contract. |
| FDR-027 | Make candidate registration and assessment preparation bulk-first. | Approved | Bulk registration, automatic next-rank resolution, optional bulk assessment generation and a separate bulk assessment start now exist on the backend. Per-candidate controls remain for exceptions and late additions. |
| FDR-028 | Represent bulk operations as independently processed rows. | Approved | The implemented API returns successful rows plus indexed errors. The UI must never imply all-or-nothing success: it shows the exact created/updated count, identifies failures inline and provides a retry-failed-only action. |
| FDR-029 | Treat assessment generation and assessment start as different actions. | Approved | `generate_assessments: true` creates immutable snapshots in `NOT_STARTED`; it does not start grading. Preparation controls say `Prepare assessment forms`; the separate, deliberate `bulk-start` action says `Start assessments` and is available only after the session is open. |
| FDR-030 | Use a filter-and-rank-group cohort builder for bulk registration. | Approved | Staff can add all filtered eligible students or complete current-rank groups, then remove only genuine exceptions. The review summarises automatically derived destination ranks and offers optional preparation of `NOT_STARTED` assessment forms. Individual ticking is not the primary workflow. |
| FDR-031 | Resolve partial bulk-registration results through a simple editable exception list. | Approved | Show every flagged candidate once with their identity, plain-language issue and only relevant actions: view an existing registration, remove from the retry/cohort, or correct a genuinely inaccurate blocking student status. Successful rows remain saved, backend row indices are never exposed, and retry submits only resolved candidates. Status changes are explicitly cautioned and audited. |
| FDR-032 | Use a dual-pane command ledger layout for candidate assessment scoring. | Approved | Selected from three layout directions on 2026-09-16. Fixed left category sub-rail (~280px) provides permanent peripheral vision of overall candidate progress, while right panel hosts touch-safe segmented Met/Not-Met controls and inline assessor notes. |
| FDR-033 | Segmented 3-state control (`NOT_ASSESSED`, `MET`, `NOT_MET`) with minimum 48px touch targets for mat-side scoring. | Approved | Direct alignment with backend `CandidateAssessmentItem.Result` enum. One-tap evaluation suited for active dojang environments. |
| FDR-034 | Auto-saving row-level item evaluations with immediate attribution. | Approved | Prevents data loss during live gradings; matches the backend check constraint requiring assessor and timestamp on scored items. |
| FDR-035 | Strict UI completion lock: "Complete Assessment" remains disabled until zero required items remain unassessed. | Approved | Mirrors backend `validate_assessment_can_complete` service validation, preventing misleading error toasts. |
| FDR-036 | Use a side-by-side dual-card ledger layout for assessment completion review. | Approved | Selected from three layout directions on 2026-09-16. Left column provides total evaluation metrics and category breakdown table; right column isolates flagged not-met requirements, general notes, and the immutable seal confirmation. |
| FDR-037 | Use a right slide-over drawer layout for instructor outcome proposals. | Approved | Selected from three layout directions on 2026-09-16. Preserves candidate roster context in the background while providing dedicated vertical room for selectable recommendation cards, proposal rationale notes, and Master-authority disclosure. |
| FDR-038 | Use an expansive dual-column slide-over ledger for Authorised Master final decisions. | Approved | Selected from layout directions (synthesising slide-over efficiency with full-ledger depth) on 2026-09-16. Opens wide (~65% width) over the candidate roster to preserve scroll position and cohort context, while internally presenting an assessment criteria ledger with instructor proposal on the left, and Master adjudication cards, conditional requirements input, authority credential seal, and formal decision sealing on the right. |
| FDR-039 | Use a roster batch and inline promotion ledger for student rank conferral. | Approved | Selected from three layout directions on 2026-09-16. Provides individual row-level promotion triggers ('Promote to [Rank]') alongside a cohort promotion summary bar ('Promote Qualified Cohort') and pinned batch preview tray. Gated strictly by `can_promote_student` permission. Effective date is locked to session grading date. Contracts to row-level promotion with a server-side bulk-promote endpoint targeted for efficient cohort processing. |
| FDR-040 | Use in-page operational action banners for grading session state transitions. | Approved | Selected from layout directions on 2026-09-16. Instead of heavy multi-step wizards or disconnected drawers, the session roster proactively surfaces an elegant in-page operational banner beneath the title and progression track when stage prerequisites are satisfied (e.g. 'All assessments completed · Ready to lock session'). Clicking the direct action triggers a minimal 2-sentence confirmation dialog, maintaining quiet operational flow and zero modal fatigue. |

## Concept screen register

| ID | Screen | Theme | File | Status |
| --- | --- | --- | --- | --- |
| SCR-001 | Operational overview | Light | `01-overview-light.png` | Selected concept |
| SCR-002 | Operational overview | Dark | `02-overview-dark.png` | First dark-theme concept |
| SCR-003 | Students list | Light | `03-students-list.png` | First concept |
| SCR-004 | Student detail and history | Light | `04-student-detail.png` | First concept |
| SCR-005 | Grading sessions list | Light | `05-gradings-list.png` | First concept |
| SCR-006 | Open grading session and candidate roster | Light | `06-grading-session-roster.png` | First concept |
| SCR-007 | Add student | Light | `07-add-student.png` | First concept |
| SCR-008 | Staff login | Light | `08-login.png` | First concept; unsupported persistent-login control removed |
| SCR-009 | Syllabus rank chapter | Light | `09-syllabus-rank-chapter.png` | Selected syllabus concept |
| SCR-010 | Audit event list | Light | `10-audit-log.png` | Implemented; visible only to administrators and the designated Master |
| SCR-011 | Administrator users list | Light | `11-admin-users-list.png` | Administrator-only concept |
| SCR-012 | Administrator user details and authority | Light | `12-admin-user-detail.png` | Administrator-only concept |
| SCR-013 | Installed PWA offline shell | Light | `13-pwa-offline-shell.png` | First-release degraded state; no offline writes |
| SCR-014 | Instructor self-profile menu | Light | `14-instructor-profile-menu.png` | Selected; contains no installation action |
| SCR-015 | PWA update-ready notification | Light | `15-pwa-update-ready.png` | First concept; update is deferrable and never forced |
| SCR-016 | Create grading session with ledger preview | Light | `16-create-grading-session.png` | Selected concept |
| SCR-017 | Build grading cohort | Light | `17-build-grading-cohort.png` | Selected combined concept |
| SCR-018 | Resolve flagged cohort candidates | Light | `18-resolve-flagged-candidates.png` | Selected exception-editor concept |
| SCR-019 | Candidate assessment workspace | Light | `19-candidate-assessment-workspace.png` | Selected dual-pane concept |
| SCR-020 | Assessment completion review | Light | `20-assessment-completion-review.png` | Selected dual-card concept |
| SCR-021 | Instructor outcome proposal drawer | Light | `21-instructor-outcome-proposal.png` | Selected slide-over concept |
| SCR-022 | Authorised Master final decision slide-over | Light | `22-master-final-decision.png` | Selected hybrid slide-over ledger concept |
| SCR-023 | Roster batch and inline promotion ledger | Light | `23-student-promotion-flow.png` | Selected batch and inline promotion concept |
| SCR-024 | Grading session state transition action banner | Light | `24-session-state-transition.png` | Selected in-page operational banner concept |

## Preliminary curriculum-source interpretation

- Adult & Youth is the source track for ages 13-17 and 18+.
- Junior & Little Dragon is the source track for ages 9-12 and 8 and under.
- Yea Eue, Ki Cho Jah Ki, Soo Ki, Johk Sool, Nahk Bup and Kyuk Pah are universal grading areas shown separately from rank-specific curriculum.
- Rank-specific content is organised into parallel Techniques and Forms requirements.
- Junior requirements differ by age group, so age context must remain visible at all times.
- The source-chart P/F and Comments columns inform the later assessment-form design; they are not part of syllabus browsing.
- The PDFs' printed `Do Not Alter` wording is source-document content, not an instruction governing this preliminary digital design pass.

## Corrections required during Figma reconstruction

- Render `INACTIVE` with a neutral or amber treatment, not the same danger treatment as `LEFT`.
- Replace all illustrative rank-history rows with a sequence validated against the seeded rank catalogue.
- Validate every mock date, status and transition against generated API types before treating copy as final.
- Replace concept-only icons with one consistent accessible icon library.
- Create two application-rail variants: Instructor without Users, and Administrator with Users.
- Label the signed-in user's role and Master capabilities separately in the profile menu; never present Master as a role.
- Verify contrast, focus states, zoom behaviour and reduced motion in both themes.
- Do not treat image-generated spacing or text as exact implementation measurements.

## Implementation coverage (2026-09-20)

- Implemented: login and application shell, Overview, Students list/detail/add,
  Gradings list/create/detail, cohort builder and exception handling, Syllabus,
  assessment workspace/completion, outcome proposal, final decision, promotion
  ledger, Audit event browser/detail, profile/password controls, themes, and
  session transitions.
- Placeholder only: administrator Users list.
- Not implemented: administrator user detail/authority/password flows, installed
  PWA/offline shell, and update-ready notification.
- Partial cleanup remains: full keyboard/focus/contrast verification, component
  stylesheet boundaries, elimination of remaining literal colours, and full
  light/dark/mobile parity.

## Remaining shared-screen work

- User administration, password reset and Master-authority controls.
- PWA update, cached-shell, reconnection and honest offline states. Installation is browser/OS-owned with no KukGrade prompt.
- Finish accessibility review, tablet/mobile coverage, component states and motion storyboards. A persistent notification centre is deferred.
- Full light/dark parity for every accepted screen.

## Bulk-workflow backend boundary

Verified on `dev` at `4c009f6` on 2026-09-16. Earlier focused bulk-operation tests: 9 passed. Focused bulk-start tests: 2 passed.

- Implemented: `bulk-register`, including optional per-row rank override and automatic next-rank resolution.
- Implemented: optional assessment generation during bulk registration and separate `bulk-generate-assessments` for existing candidates.
- Implemented: separate `bulk-start` for deliberately transitioning several generated assessments from `NOT_STARTED` to `IN_PROGRESS` after the session is open.
- Implemented: `bulk-update-status`, intended for attendance/no-show handling.
- Implemented transaction policy: rows are independent. Responses contain successful records plus an `errors` map keyed by submitted row index.
- Not implemented: a server preflight endpoint. The UI can preview its submitted cohort from loaded data, then must reconcile and clearly display the authoritative partial-result response.

## Assessment implementation notes

- Candidate assessment, completion review, outcome proposal, final decision and
  promotion flows are implemented.
- Bulk prepare and explicit bulk start are implemented in session detail;
  backend partial failures are reported. A dedicated retry-failed-only control
  remains future refinement.
- Offline save/synchronisation, locked-session withdrawal UI, and dedicated
  no-show attendance selection remain unimplemented frontend work.
