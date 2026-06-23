Single‑Discipline Martial Arts Grading App – Planning & Execution
This document outlines a detailed, phased plan to build a secure, single‑discipline martial arts grading management system.  The plan reflects the latest insights from industry surveys and developer trends, and follows the product scope and stack recommendations previously agreed.  It is intended to serve as a hand‑off document for building a working prototype and full application.
1. Overview
The goal of the project is to replace spreadsheets and ad‑hoc processes with a role‑based web application that manages student progression, grading sessions, examiner assessments and promotion records.  The product focuses on a single martial arts discipline and operates initially as an internal staff tool.  It later evolves to support operational maturity and automation.
2. Project phases and versions
To deliver value quickly and reduce risk, the work is divided into three releases.  Each version introduces a self‑contained set of features.
2.1 Version 1 – Internal grading MVP
Objective: deliver a usable internal system that supports basic grading operations.  This is the smallest set of features that solves the core problems (tracking students, referencing the syllabus, scoring candidates and recording final decisions).
Scope and features:
	1	Authentication and RBAC: secure login and role‑based access for admin, instructor and examiner roles.  Authentication should rely on Django’s user model and Django REST Framework (DRF) token or session auth.
	2	Student records: ability to add/edit student profiles, attach a WKSA ID (or other membership number), and view previous grading comments.  The student list should support sorting and filtering by rank, age band, class and eligibility.
	3	Syllabus lookup: implement models to store the discipline’s rank hierarchy and age‑band‑specific technique lists.  Expose endpoints and UI views so examiners can view the relevant syllabus and grading criteria during a session.
	4	Grading session management: admins can create sessions, assign candidates and examiners, and set session status (draft/in‑progress/completed).
	5	Assessment entry: examiners record scores and comments against criteria categories (techniques, forms, sparring, etc.), with pass/fail style outcomes.  Provide cohort comments and global comments to reduce repetitive data entry.  Prior grading notes should be visible to aid consistency.
	6	Final decision capture: authorised Masters record pass/fail/conditional decisions.  Final results and cohort comments are stored for later reporting. Promotion records remain a separate deferred workflow.
	7	Basic metrics: display simple statistics such as pass/fail counts and improvement from previous attempts.
	8	Audit trail: log who recorded each final decision and any manual overrides.
2.2 Version 2 – Operational maturity
Objective: enhance the system’s usefulness by automating eligibility, formalising rubric templates, and improving reporting and history.
Scope additions:
	1	Eligibility engine: calculate whether students are eligible, nearly eligible or blocked based on time‑in‑grade, attendance and recommendation status.  Provide an eligibility dashboard for instructors.
	2	Recommendation workflow: instructors submit recommendations for students ready to test; admins or head instructors approve them before adding to sessions.
	3	Rubric templates: allow admins to define and version grading criteria per rank and age band.  This ensures assessments stay consistent across sessions.
	4	Certificate generation: create PDF certificates for successful promotions using a library like WeasyPrint.
	5	Reports and exports: add more detailed analytics (e.g. average time between ranks, rank distribution) and CSV exports for offline analysis.
	6	Audit history: provide UI to view change logs and promotion history.
	7	Data import tools: enable bulk student imports and grading history migration for smoother adoption.
2.3 Version 3 – Automation and integration
Objective: streamline operations and extend the product’s reach through automation and integrations.
Scope additions:
	1	Workflow automation: integrate with an automation platform (e.g. n8n) to schedule notifications for upcoming eligibility, send reminders for recommendations and coordinate re‑tests or deferred sessions.
	2	Notifications: email or in‑app notifications for grading availability, session assignments and published results.
	3	Parent/student portal: optionally allow limited student or parent access to view results, download certificates and see next eligibility dates.
	4	Advanced analytics: track long‑term trends in promotion rates, instructor performance and retention.
	5	External integrations: integrate with attendance tracking or payment systems if needed.
3. Implementation plan (phased tasks)
The following breakdown translates the high‑level roadmap into concrete tasks.  Each phase can be treated as a sprint or milestone.
Phase 0 – Definition and design (prep)
	1	Product requirements document: finalise the product scope, roles, grading lifecycle and criteria model.  This document (the one you’re reading) should serve as a starting point.
	2	Data modelling: design the Django models for users, roles, organisations, students, ranks, pathways, rubric categories, criteria, sessions, candidates, assessments, decisions and audit events.  Draw an entity‑relationship diagram and review with stakeholders.
	3	API contract: define REST endpoints for authentication, students, ranks, eligibility, grading sessions, assessments, promotions and reports.
	4	UI wireframes: create Figma wireframes for the main screens (dashboard, students list, student profile, grading session, scoring form and reports) and iterate with instructors.  These are low‑fidelity sketches to validate workflows.
Phase 1 – Foundations
	1	Repository setup: initialise a monorepo with a Django project (grading_app/api) and a React frontend (grading_app/web) using Vite.  Configure Docker Compose for development with PostgreSQL.
	2	Authentication and RBAC: implement custom user model, roles and permissions.  Build login/logout endpoints and integrate them into the React app with protected routes.
	3	Organisation structure: create models for organisations and branches.  Build simple admin pages to manage them.
	4	Student management: implement student CRUD via DRF and create a React student list and detail pages.  Include search/sort/filter by rank, age band and class.  Allow storing membership number (WKSA ID) and previous grading notes.
Phase 2 – Syllabus and rubric
	1	Rank hierarchy & pathways: implement models for ranks and progression pathways.  Build an admin UI to manage rank order and prerequisites.
	2	Criteria categories and criteria: build models and API endpoints for rubric categories and criteria.  Provide a UI for admins to define technique lists, forms, etc., per rank and age band.  Version them to preserve historical assessments.
	3	Syllabus lookup UI: in the React app, build pages that display the current syllabus for a selected age band and rank.  Provide quick links from grading screens to the relevant criteria.
Phase 3 – Grading workflow
	1	Grading sessions: implement creation and management of sessions.  Admins select date, venue, target rank and assign candidates.  Build session list and detail pages.
	2	Candidate assignment: allow adding eligible students to a session.  Provide quick search to find students and display their current rank and eligibility status.
	3	Examiner assignment: assign one or more examiners to each session and restrict scoring access to assigned examiners.
	4	Assessment entry UI: build a responsive scoring form where examiners input scores and comments by category.  Support autosave drafts and previous comment visibility.  Implement simple pass/fail logic for V1.
	5	Final decision panel: create a screen for authorised Masters to review examiner assessments, record final decisions (pass/fail/conditional) and add cohort/global comments.  Lock results once finalised. Promotion records remain deferred until the promotion workflow is confirmed.
Phase 4 – Reporting and history
	1	Promotion records and certificates: implement model to store promotions and generate simple PDF certificates.  Allow staff to download certificates from the student profile.
	2	Basic reports: build backend endpoints and frontend pages that summarise pass/fail/conditional counts and improvement metrics.  Provide filters by date range, rank and instructor.
	3	Audit log: record changes to critical entities (rank updates, final decisions, rubric changes) and display them in an admin audit view.
Phase 5 – Maturity and automation (V2)
	1	Eligibility engine: create a service that calculates eligibility based on time since last promotion, attendance and recommendation status.  Expose results via API and display badges in the student list.  Implement an “eligible/near‑eligible/blocked” dashboard.
	2	Recommendation workflow: build pages where instructors recommend students, and admins approve/deny these recommendations.  Integrate with eligibility engine.
	3	Rubric templates: expand criteria models to support template versioning.  Provide UI to duplicate and revise rubric templates for new grading cycles.
	4	Improved certificate generation: design nicer certificate templates and incorporate serial numbers or QR codes.
	5	Report exports: add CSV/Excel export endpoints and UI buttons.
	6	Audit history UI: improve the visibility of change logs, enabling filtering by entity and date.
Phase 6 – Automation & integration (V3)
	1	Workflow automation hooks: integrate with n8n or a similar platform via webhooks or scheduled jobs to send reminders, track retests and trigger deferred actions.
	2	Notification system: implement email or push notifications for session assignments, eligibility changes and published results.
	3	Student/parent portal: build minimal pages for students or guardians to view their current rank, grading history and certificates.
	4	Advanced analytics dashboards: use charts to show long‑term trends such as average time in grade, pass/fail ratios and instructor performance comparisons.
	5	External integrations: evaluate whether attendance or payment systems need to be synchronised; integrate via APIs if necessary.
4. Technology stack and justification
4.1 Frontend
	1	React –  still the most widely used frontend library.  According to the Stack Overflow Developer Survey 2025, React is used by ~46.9 % of professional developers and remains second only to Node.js among web frameworks .  A 2026 developer article notes that React is “the most employable” framework, with the largest ecosystem of UI libraries and state managers .
	2	TypeScript – adds type safety to JavaScript and reduces bugs.  The 2025 survey shows that 43.6 % of developers have used TypeScript .  It is also required by Angular and strongly recommended for React in large projects.
	3	Vite – a modern build tool that offers instant hot module reloading and fast compilation.  It dramatically improves developer experience compared with older tools like Create React App.
	4	React Router – a routing library recommended in the official React docs for single‑page applications.  It handles client‑side routing without the opinionated full‑stack layer of Next.js, which is unnecessary because the backend is Django.
	5	TanStack Query – handles server state (data fetching, caching and synchronisation) elegantly.  It reduces boilerplate and fits well with REST APIs.
	6	Tailwind CSS (optionally paired with shadcn/ui) – offers utility‑first styling, enabling modern, responsive UIs quickly.  It can be combined with component libraries if desired.
4.2 Backend
	1	Django + Django REST Framework – a batteries‑included Python framework that offers built‑in authentication, an admin panel and an ORM.  A 2026 article highlights Django as “Python’s fastest path to production” due to its built‑in security, admin dashboard and DRF integration .  This aligns with the project’s need for rapid development and strong security.
	2	PostgreSQL – a robust, open‑source relational database well suited for structured data (students, ranks, assessments).  It supports transactional integrity and complex queries.
	3	Celery + Redis (optional in V2 or later) – for background tasks such as sending notifications and generating certificates asynchronously.
4.3 Rationale
The combination of React and Django balances rapid development with scalability.  React remains the industry standard for frontend development , while Django provides a secure, mature backend .  TypeScript improves maintainability, and Vite speeds up local development.
5. Prototype strategy
	1	Planning prototype: use Figma to design wireframes and clickable flows.  This helps align workflows and screen layouts with instructors before code is written.
	2	Coded prototype: build a minimal React/TypeScript app with mock data for students, sessions and assessments.  Focus on the grading workflow (list → detail → scoring form).  This prototype should be coded in the same tech stack as the final app, so it evolves into the real product rather than being discarded.
	3	Avoid heavy no‑code tooling: while platforms like Bubble or Retool can deliver quick prototypes, they impose limitations on custom data models, authentication and rubric logic.  For this domain‑heavy app, it is better to invest early in a real code base and use Figma for design.
6. Handoff to Codex or other code generators
This document can serve as a blueprint for code generation tools like GitHub Copilot or Codex.  To automate the creation of boilerplate code, follow these guidelines:
	1	Define clear model schemas: provide Codex with the models.py definitions for each entity listed in the data model, including fields and relationships.  For example, define StudentProfile, Rank, Criterion, GradingSession, Assessment and FinalDecision models.
	2	Generate serializers and viewsets: use DRF ModelSerializer and ModelViewSet patterns.  Provide high‑level descriptions of endpoints so that Codex can generate CRUD operations and custom actions (e.g., “finalise decision”).
	3	Create React components: instruct Codex to scaffold pages based on the wireframes.  For instance, ask it to create a StudentList component with search and filters, a GradingSessionForm, and an AssessmentForm that loops through criteria and captures scores.
	4	Setup routing and state management: ask Codex to generate React Router routes and TanStack Query hooks for each API endpoint.  Provide endpoint paths and expected response shapes.
	5	Iterate manually: after generating initial code, developers should review and refine logic, ensuring the eligibility calculations and rubric processing work correctly.  Automated tools can accelerate scaffolding but still require human oversight.
At present, there is no direct mechanism for this assistant to invoke Codex automatically.  However, the code structure and tasks described here can be passed to a code generation tool or used by human developers to start the project.
7. Next steps
	1	Review this planning document with stakeholders and confirm the V1/V2/V3 scope.  Adjust tasks based on feedback from instructors and administrators.
	2	Create wireframes in Figma or your preferred design tool for the critical screens.
	3	Set up the repository and start Phase 1 tasks.  Use the recommended stack and follow the phased plan.
	4	Consider using Codex or similar AI coding tools to scaffold models, serializers and components, but ensure that the generated code aligns with the data model and user workflows defined here.
This phased, stack‑aligned plan will help you build a robust grading management system while reducing technical debt and aligning with current industry best practices.
