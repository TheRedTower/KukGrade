# Performance Optimisation Review — 2026-10-24

I’ve broadened the review across navigation, scoring, imports, legacy matching, database access, rendering, and production configuration. **There are useful optimisations, but the main opportunity is reducing repeated work and waiting between requests.** No code or application data was changed.

The list below separates clear inefficiencies in the code from improvements that need larger-scale profiling.

**Highest priority: everyday responsiveness**

| Opportunity | Evidence | Recommended change |
|---|---|---|
| **1. Set deliberate cache freshness** | [App.tsx](../../frontend/src/App.tsx#L345) leaves query freshness at zero. Returning to screens triggers background requests, including reference data. | Give ranks and age bands long freshness periods. Use shorter, explicit periods for changing records, retaining permission refreshes and mutation invalidation. |
| **2. Remove assessment-loading waterfalls** | [candidateAssessmentData.ts](../../frontend/src/candidateAssessmentData.ts#L50) makes three initial requests, then fetches items and summary once the assessment ID arrives. | Reuse assessment IDs already loaded by the session workspace; consider one focused assessment-workspace response. |
| **3. Prefetch likely next screens** | There is no query prefetching in the frontend. | Prefetch on clear navigation intent, such as focusing a candidate link or moving through a grading cohort. Keep prefetching bounded. |
| **4. Reduce reads after scoring** | [CandidateAssessmentScreen.tsx](../../frontend/src/CandidateAssessmentScreen.tsx#L189) refreshes items, summary and assessment after writes settle. | Return authoritative counts with the saved item, allowing cache updates with fewer follow-up requests. Preserve ordering and rollback protection for overlapping writes. |
| **5. Debounce the remaining searches** | [UsersScreen.tsx](../../frontend/src/UsersScreen.tsx#L178) and [HistoricalRecordsScreen.tsx](../../frontend/src/HistoricalRecordsScreen.tsx#L39) query directly from the search text. | Apply the existing debounce pattern used by Students and import review. Currently, typing a name can generate a request per character. |
| **6. Cancel obsolete read requests** | Query functions do not pass TanStack Query’s cancellation signal through the API helpers to `fetch`. | Thread `AbortSignal` through read helpers so superseded searches and abandoned page loads stop consuming resources. |
| **7. Preserve useful content during pagination** | Students and some import screens retain previous results; Users and Audit switch through initial-loading states for uncached pages. | Apply consistent previous-page handling with an updating indicator and appropriate safeguards against acting on stale rows. |

**Frontend loading and rendering**

8. **Split more screens out of the initial bundle.** Most grading workflows are eagerly imported by [App.tsx](../../frontend/src/App.tsx#L21). The production build measured approximately **501 kB JavaScript / 141 kB gzip**, plus **145 kB CSS / 23 kB gzip** in the main assets. Further route splitting would reduce initial download and parsing; prefetching can help keep subsequent navigation quick.

9. **Profile and isolate assessment-row rendering.** [The scoring screen](../../frontend/src/CandidateAssessmentScreen.tsx#L400) renders every item and creates fresh callbacks for each row whenever the parent renders. Stable row callbacks and selective memoisation could reduce work during scoring. This is a plausible rendering hotspot, **not yet a measured browser bottleneck**.

10. **Reuse date formatter instances.** [dates.ts](../../frontend/src/dates.ts#L90) constructs `Intl.DateTimeFormat` repeatedly. Scored rows and table rows call these formatters. Cache formatter instances by format and time zone, preserving the existing date-only and club-time-zone behaviour. This is a small, contained improvement.

**Imports and historical records**

11. **Avoid whole-batch processing for every roster correction.** [correct_import_row](../../backend/data_imports/services.py#L1163) calls `_classify_roster`, which loads, validates and bulk-updates every row.

A name correction therefore processes the entire roster. For ordinary field corrections, revalidate the affected row; for ID changes or exclusions, also revalidate rows whose duplicate classification can change. Keep full validation at commit. At minimum, update only rows whose derived values changed.

12. **Move legacy grouping ahead of pagination into a scalable representation.** [The legacy people endpoint](../../backend/gradings/views.py#L873) loads all matching records and groups them in Python before selecting a page.

In a synthetic, in-memory check, grouping 50,000 records took approximately **197 ms**, excluding database loading and model construction. Store a normalised grouping key and paginate group keys before fetching their records. This would require a migration and tests proving identical grouping.

13. **Reduce legacy suggestion comparisons.** [legacy_matching.py](../../backend/gradings/legacy_matching.py#L174) compares each displayed group against every student.

Synthetic checks for 20 groups took approximately:

- **80 ms** against 1,000 students.
- **402 ms** against 5,000 students.

These depend on the names used and exclude real-world request overhead. Precompute name representations, narrow the candidate pool while preserving surname-first and fuzzy matching rules, and select the best five without sorting every match.

14. **Avoid scanning import JSON in Python before pagination.** [rows_given_a_value](../../backend/data_imports/services.py#L732) reads matching rows’ raw values and corrections, builds a row-number list, then queries again. Express this through database predicates or stored classification flags, retaining the current blank-value semantics.

15. **Refresh less import data after individual edits.** [ImportReview.tsx](../../frontend/src/ImportReview.tsx#L711) invalidates batch, row and legacy-preview queries together. Return changed counts with mutation responses and invalidate only affected resources. Larger legacy previews currently reconstruct the stored dataset to calculate their response.

16. **Bound grouped unlink requests.** [useLegacyLinking.ts](../../frontend/src/useLegacyLinking.ts#L28) fires every unlink request simultaneously using `Promise.all`. Use bounded concurrency or a backend bulk-unlink operation with explicit partial-failure behaviour.

**Database and production improvements to validate next**

| Opportunity | Assessment |
|---|---|
| **17. Replace audit date casts with timestamp bounds** | [Audit filters](../../backend/audit/views.py#L49) generate `(occurred_at AT TIME ZONE …)::date`. Direct timestamp bounds would better suit the existing timestamp index. Preserve club-time-zone and daylight-saving semantics. |
| **18. Stop fetching all pages where only visible rows are needed** | [collectAllPages](../../frontend/src/api.ts#L187) loads pages sequentially. Cohort and session workspaces can become slower as their datasets grow. Use pagination or incremental loading where the workflow permits it. |
| **19. Profile search indexes at realistic volumes** | [Substring search](../../backend/kukgrade/filtering.py#L164) uses `icontains` across several fields. Ordinary indexes may provide little benefit. Consider suitable PostgreSQL search indexes only after checking representative query plans. |
| **20. Benchmark database connection reuse** | Database settings currently resolve to `CONN_MAX_AGE=0`. Bounded persistent connections may reduce request overhead under Gunicorn. Measure connection counts and latency before choosing a value. |
| **21. Reuse syllabus resolution within bulk preparation** | [Assessment generation](../../backend/gradings/assessment_services.py#L198) resolves the syllabus separately for each candidate. Reuse identical rank/age-band resolutions within one bulk operation while retaining exact historical snapshots. |
| **22. Measure production behaviour explicitly** | Compare cold loading, repeat navigation and scoring against the production build. Record browser request waterfalls, render durations and server timings. Existing Gunicorn access logs already include request duration. |

The existing foundation also contains useful optimisations: related-object loading, server-side assessment aggregates, bulk import creation, batched permission loading, compressed static assets, and query-count regression tests. Those should be preserved.

**I would implement this in four small stages:** cache/search improvements; assessment loading and scoring; import and legacy processing; then database changes justified by realistic measurements. Browser profiling should precede rendering changes. Increasing workers requires a shared authentication-throttle cache, as documented in the repository.

The current endpoint measurements remain fast—roughly **2–9 ms warm** on the small local dataset. They support prioritising request behaviour, but they do not establish production or multi-user performance. This extended pass used source inspection, read-only SQL inspection and synthetic benchmarks; Git remains unchanged, and implementation tests were not run.
