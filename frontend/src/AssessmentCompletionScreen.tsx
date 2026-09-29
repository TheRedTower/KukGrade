/**
 * Completion review - Certificate Proof (SCR-027, FDR-043).
 *
 * Rebuilt from SCR-020's dual-card ledger. The record renders as the document
 * it becomes, so the instructor proofreads rather than fills in a form:
 * candidate and rank transition, core grading areas, the requirement ledgers,
 * every recorded note, the assessment note, and a seal line that stays blank
 * until the record is sealed. Provenance and counts sit in a side column.
 *
 * Two things FDR-043 is explicit about, both of which would be easy to get
 * wrong:
 *
 * - **Every** recorded `assessor_notes` value renders, not only those on
 *   `NOT_MET` items. Since the 2026-09-23 decision that field carries positive
 *   observations too, so a note on a met requirement would otherwise be
 *   invisible at the last moment it can be read, and absent from the permanent
 *   record afterwards.
 * - The assessment note stays **editable** while unsealed. Completion is the
 *   only point at which `CandidateAssessment.notes` can be written - it is
 *   submitted with the `COMPLETED` transition and is immutable afterwards -
 *   and the 1A scoring screen has no overall-note control, so rendering it as
 *   static prose would remove the only write path in the application.
 *
 * Counts are served, never recounted here (FDR-046). No percentages: `Result`
 * is NOT_ASSESSED / MET / NOT_MET and carries no partial credit.
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  CandidateAssessmentItem,
  reopenCandidateAssessment,
  updateCandidateAssessment,
} from "./api";
import { RankBelt } from "./Belt";
import { useSiteSettingsQuery } from "./queries";
import {
  CategoryGroup,
  useAssessmentNotesDraft,
  useCandidateAssessmentData,
} from "./candidateAssessmentData";
import { isCoreCategory } from "./syllabusCategories";
import { formatShortDate, formatTime } from "./dates";
import "./CandidateAssessment.css";
import { CheckIcon, CrossIcon } from "./Icons";

function SealIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** The mark shown against a requirement or core area on the proof. */
function ResultMark({ result }: { result: CandidateAssessmentItem["result"] }) {
  if (result === "MET") {
    return (
      <span className="acp-result acp-result-met">
        <CheckIcon size={13} />
        Met
      </span>
    );
  }
  if (result === "NOT_MET") {
    return (
      <span className="acp-result acp-result-not-met">
        <CrossIcon size={13} />
        Not met
      </span>
    );
  }
  return <span className="acp-result acp-result-none">Not assessed</span>;
}

export function AssessmentCompletionScreen() {
  const { sessionId, candidateId } = useParams<{ sessionId: string; candidateId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clubName = useSiteSettingsQuery().data?.club_name;

  const numSessionId = sessionId ? Number(sessionId) : undefined;
  const numCandidateId = candidateId ? Number(candidateId) : undefined;

  // The draft outlives a trip back to scoring - see useAssessmentNotesDraft.
  const { draft: userNotes, setDraft: setUserNotes, clearDraft: clearNotesDraft } =
    useAssessmentNotesDraft(numCandidateId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hasProofread, setHasProofread] = useState(false);

  const {
    session,
    candidate,
    assessment,
    items,
    categoryGroups,
    stats,
    isLoading,
    hasLoadError,
  } = useCandidateAssessmentData(numSessionId, numCandidateId);

  const generalNotes = userNotes !== null ? userNotes : (assessment?.notes ?? "");
  const scoringPath = `/gradings/${sessionId}/assessments/${candidateId}`;

  const completeAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return updateCandidateAssessment(assessment.id, {
        status: "COMPLETED",
        notes: generalNotes,
      });
    },
    onSuccess: () => {
      setActionError(null);
      clearNotesDraft();
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", "byCandidate", numCandidateId] });
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates"] });
      navigate(`/gradings/${numSessionId}`);
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : "Failed to complete assessment.");
    },
  });

  // A sealed record stays correctable until the session locks.
  const reopenAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return reopenCandidateAssessment(assessment.id);
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", "byCandidate", numCandidateId] });
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates"] });
      navigate(scoringPath);
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : "Failed to reopen assessment.");
    },
  });

  if (isLoading) {
    return (
      <section aria-label="Assessment completion review" className="caw-page" data-testid="caw-review-loading">
        <div className="caw-loading-state" role="status">
          <span className="status-dot status-dot-pulse" aria-hidden="true" />
          <p>Loading completion review...</p>
        </div>
      </section>
    );
  }

  if (hasLoadError) {
    return (
      <section aria-label="Assessment completion review" className="caw-page" data-testid="caw-review-load-error">
        <div className="caw-error-banner" role="alert">
          <p>
            The assessment rollup could not be loaded, so the record cannot be reviewed or
            sealed right now. Reload to try again.
          </p>
          <Link to={scoringPath} className="btn-secondary">
            ← Return to scoring
          </Link>
        </div>
      </section>
    );
  }

  if (!session || !candidate) {
    return (
      <section aria-label="Assessment completion review" className="caw-page" data-testid="caw-review-not-found">
        <div className="caw-error-banner" role="alert">
          <p>Candidate or grading session not found.</p>
          <Link to={`/gradings/${sessionId}`} className="btn-secondary">
            ← Return to session roster
          </Link>
        </div>
      </section>
    );
  }

  const isSealed = assessment?.status === "COMPLETED";

  // Reachable by typed URL before the assessment is ready for review. The
  // scoring screen only links here once every required item is assessed, so
  // this state explains itself rather than showing an empty proof.
  if (!assessment || (!isSealed && !stats.canComplete)) {
    return (
      <section aria-label="Assessment completion review" className="caw-page" data-testid="caw-review-unavailable">
        <div className="caw-error-banner" role="alert">
          <p>
            {!assessment
              ? "This candidate has no assessment form yet, so there is nothing to review."
              : `${stats.remainingRequired} required ${
                  stats.remainingRequired === 1 ? "item remains" : "items remain"
                } unassessed. Finish scoring before completing the assessment.`}
          </p>
          <Link to={scoringPath} className="btn-secondary">
            ← Return to scoring
          </Link>
        </div>
      </section>
    );
  }

  /*
    The proof separates the six universal core areas from the rank-specific
    ledgers (FDR-018, via `syllabusCategories`). Everything that is not a core
    area gets a ledger of its own under its served `category_display` - not
    just Techniques and Forms. A Weapons or Other requirement that was scored
    during the grading must still appear, or the permanent record would be
    missing part of what was assessed.
  */
  const coreGroups = categoryGroups.filter((group) => isCoreCategory(group.category));
  const ledgerGroups = categoryGroups.filter((group) => !isCoreCategory(group.category));

  // Every recorded note, whichever way the requirement went (FDR-043).
  const notedItems = items.filter((item) => item.assessor_notes);

  // Distinct assessors across the record, in the order they first appear.
  const assessors = Array.from(
    new Set(items.map((item) => item.assessor_email).filter((email): email is string => !!email)),
  );

  const canSeal = hasProofread && !completeAssessmentMutation.isPending;

  return (
    <section aria-labelledby="acp-title" className="acp-page" data-testid="caw-review-workspace">
      <header className="acp-topbar">
        <Link to={scoringPath} className="acp-back" data-testid="acp-back-to-scoring">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M20 12H5M10 7l-5 5 5 5" />
          </svg>
          Back to scoring
        </Link>
        <span aria-hidden="true" className="acp-topbar-divider" />
        <span className="acp-topbar-note">
          {isSealed
            ? session.status === "OPEN"
              ? "This record is sealed; it can be reopened until the session locks"
              : "This record is sealed and cannot be changed"
            : "Proof the record before it is sealed"}
        </span>
      </header>

      {actionError && (
        <div className="caw-action-error" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 3.5 21.5 20H2.5z" />
            <path d="M12 10v4.5M12 17.2v.1" />
          </svg>
          <p>{actionError}</p>
        </div>
      )}

      <div className="acp-layout">
        {/* ── The record ─────────────────────────────────────────────────── */}
        <article aria-label="Assessment record proof" className="acp-sheet">
          <div className="acp-sheet-head">
            <div>
              <div className="acp-org">
                {clubName}{session.location && ` · ${session.location}`}
              </div>
              <h1 className="acp-sheet-title" id="acp-title">Assessment record</h1>
            </div>
            <span className={`acp-stamp ${isSealed ? "acp-stamp-sealed" : ""}`} data-testid="acp-stamp">
              {isSealed ? "Sealed" : "Unsealed draft"}
            </span>
          </div>

          <div className="acp-identity">
            <div className="acp-identity-left">
              <div className="acp-label">Candidate</div>
              <div className="acp-candidate-name">{candidate.student_display_name}</div>
              <div className="acp-candidate-sub">
                {candidate.student_wksa_id && `WKSA ID ${candidate.student_wksa_id} · `}
                {candidate.age_band_display}
              </div>
            </div>
            <div className="acp-identity-right">
              <div className="acp-label">Assessed for</div>
              <div className="acp-rank-line">
                <span className="acp-rank">
                  {candidate && <RankBelt rankId={candidate.from_rank} />}
                  <span>{candidate?.from_rank_name ?? ""}</span>
                </span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="caw-rank-arrow">
                  <path d="M4 12h15M14 7l5 5-5 5" />
                </svg>
                <span className="acp-rank acp-rank-dest">
                  <RankBelt rankId={candidate.testing_for_rank} />
                  <span>{candidate.testing_for_rank_name}</span>
                </span>
              </div>
              <div className="acp-candidate-sub">
                {session.title}
                {session.grading_date && ` · ${formatShortDate(session.grading_date, "")}`}
              </div>
            </div>
          </div>

          {coreGroups.length > 0 && (
            <>
              <h2 className="acp-section">Core grading areas · always assessed</h2>
              <div className="acp-core-grid">
                {coreGroups.map((group) => (
                  <div key={group.category} className="acp-core-cell" data-testid={`acp-core-${group.category}`}>
                    <CoreAreaMark group={group} />
                    <span className="acp-core-text">
                      <span className="acp-core-name">{group.categoryDisplay}</span>
                      <span className="acp-core-detail">
                        {group.metCount} of {group.totalCount} met
                        {group.notMetCount > 0 && ` · ${group.notMetCount} not met`}
                        {group.notAssessedCount > 0 && ` · ${group.notAssessedCount} not assessed`}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {ledgerGroups.map((group) => (
            <LedgerTable key={group.category} group={group} />
          ))}

          <h2 className="acp-section">Assessor notes recorded against requirements</h2>
          {notedItems.length === 0 ? (
            <p className="acp-section-note">No notes were recorded against individual requirements.</p>
          ) : (
            <>
              <p className="acp-section-note">
                Every note recorded during scoring, whichever way the requirement went.
              </p>
              {notedItems.map((item) => (
                <div key={item.id} className="acp-note" data-testid={`acp-note-${item.id}`}>
                  <div className="acp-note-head">
                    <span className="acp-note-title">
                      #{item.position} {item.item_name}
                      {item.korean_name && ` · ${item.korean_name}`}
                    </span>
                    <ResultMark result={item.result} />
                  </div>
                  <p className="acp-note-body">
                    “{item.assessor_notes}”
                    {item.assessor_email && (
                      <span className="acp-note-by">
                        {" "}— {item.assessor_email}
                        {item.assessed_at && ` · ${formatTime(item.assessed_at)}`}
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </>
          )}

          <h2 className="acp-section">
            <label htmlFor="general-assessment-notes">Assessment note</label>
          </h2>
          {isSealed ? (
            <p className="acp-sealed-note" data-testid="acp-sealed-note">
              {assessment.notes || "No overall assessment note was recorded."}
            </p>
          ) : (
            <>
              <p className="acp-section-note">
                Editable until the record is sealed. This is the only point at which the overall
                assessment note can be written — it is submitted with the record and is immutable
                afterwards.
              </p>
              <textarea
                id="general-assessment-notes"
                className="acp-note-input"
                rows={3}
                placeholder="Overall observation for this assessment (optional)"
                value={generalNotes}
                onChange={(e) => setUserNotes(e.target.value)}
              />
            </>
          )}

          <div className="acp-seal-line">
            <div>
              <div className="acp-label">Recorded by</div>
              <div className="acp-seal-value">
                {assessors.length > 0 ? assessors.join(", ") : "Not yet attributed"}
              </div>
              {assessment.started_at && (
                <div className="acp-seal-detail">
                  Assessed from {formatTime(assessment.started_at)}
                  {assessment.completed_at && ` to ${formatTime(assessment.completed_at)}`}
                  {session.grading_date && ` on ${formatShortDate(session.grading_date, "")}`}
                </div>
              )}
            </div>
            <div>
              <div className="acp-label">Seal</div>
              {/* Blank until sealed: the line is the point of the document. */}
              {isSealed && assessment.completed_at ? (
                <>
                  <div className="acp-seal-value acp-seal-applied" data-testid="acp-seal-applied">
                    Sealed {formatShortDate(assessment.completed_at, "")} at{" "}
                    {formatTime(assessment.completed_at)}
                  </div>
                  <div className="acp-seal-detail">This record can no longer be changed.</div>
                </>
              ) : (
                <>
                  <div className="acp-seal-blank" aria-hidden="true" />
                  <div className="acp-seal-detail">Applied when the record is sealed</div>
                </>
              )}
            </div>
          </div>
        </article>

        {/* ── Provenance, counts and the seal controls ───────────────────── */}
        <aside aria-label="Record provenance and seal controls" className="acp-aside">
          <div className="acp-card">
            <h2 className="acp-card-title">Provenance</h2>
            <dl className="acp-dl">
              <div>
                <dt>Snapshot frozen</dt>
                <dd>{assessment.generated_at ? formatShortDate(assessment.generated_at, "") : "—"}</dd>
              </div>
              <div>
                <dt>Prepared by</dt>
                <dd>{assessment.generated_by_email || "—"}</dd>
              </div>
              <div>
                <dt>Source track</dt>
                <dd>{candidate.age_band_display}</dd>
              </div>
              <div>
                <dt>Assessors</dt>
                <dd>{assessors.length > 0 ? assessors.join(", ") : "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="acp-card">
            <h2 className="acp-card-title">Counts</h2>
            {/*
              No percentage. `Result` is NOT_ASSESSED / MET / NOT_MET with no
              partial credit, so a percentage would imply a score the model
              cannot express (FDR-046). Counts are served, not recounted.
            */}
            <div className="acp-count-figure">
              <strong>{stats.requiredAssessed}</strong>
              <span>{`/ ${stats.requiredItems} required`}</span>
            </div>
            <div className="acp-count-tallies">
              <span className="acp-result acp-result-met">
                <CheckIcon size={13} />
                {`${stats.metCount} met`}
              </span>
              <span className="acp-result acp-result-not-met">
                <CrossIcon size={13} />
                {`${stats.notMetCount} not met`}
              </span>
            </div>
            {stats.notAssessedCount > 0 && (
              <p className="acp-count-optional">
                {`${stats.notAssessedCount} optional ${
                  stats.notAssessedCount === 1 ? "requirement was" : "requirements were"
                } left unassessed.`}
              </p>
            )}
          </div>

          {isSealed ? (
            <div className="acp-card acp-card-sealed" data-testid="acp-sealed-panel">
              <div className="acp-notice-row">
                <SealIcon />
                <p>
                  {session.status === "OPEN"
                    ? "This record is sealed. While the session is open it can be reopened to correct a result; once the session locks it is permanent."
                    : "This record is sealed and permanent. Results, notes, assessors and times cannot be changed."}
                </p>
              </div>
              {session.status === "OPEN" && (
                <button
                  type="button"
                  className="btn-secondary acp-reopen-btn"
                  onClick={() => reopenAssessmentMutation.mutate()}
                  disabled={reopenAssessmentMutation.isPending}
                  data-testid="acp-reopen-btn"
                >
                  {reopenAssessmentMutation.isPending ? "Reopening…" : "Reopen for correction"}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="acp-card acp-card-notice">
                <div className="acp-notice-row">
                  <SealIcon />
                  <p>
                    Sealing completes this record. It can be reopened to correct it while the
                    session is open, and becomes permanent when the session locks.
                  </p>
                </div>
                <label className="acp-proofread">
                  <input
                    type="checkbox"
                    checked={hasProofread}
                    onChange={(e) => setHasProofread(e.target.checked)}
                    data-testid="acp-proofread-checkbox"
                  />
                  <span>I have proofread the record above.</span>
                </label>
              </div>

              <button
                type="button"
                className="btn-primary acp-seal-btn"
                onClick={() => completeAssessmentMutation.mutate()}
                disabled={!canSeal}
                data-testid="confirm-complete-assessment-btn"
              >
                <CheckIcon size={17} />
                {completeAssessmentMutation.isPending ? "Sealing..." : "Seal assessment record"}
              </button>
            </>
          )}

          <Link to={scoringPath} className="btn-secondary acp-return-btn">
            Return to scoring
          </Link>
        </aside>
      </div>
    </section>
  );
}

/** Core areas carry a mark rather than a full ledger row. */
function CoreAreaMark({ group }: { group: CategoryGroup }) {
  if (group.notMetCount > 0) {
    return (
      <span className="acp-core-mark acp-core-mark-not-met" aria-hidden="true">
        <CrossIcon size={13} />
      </span>
    );
  }
  if (group.notAssessedCount > 0) {
    return (
      <span className="acp-core-mark acp-core-mark-partial" aria-hidden="true">
        –
      </span>
    );
  }
  return (
    <span className="acp-core-mark acp-core-mark-met" aria-hidden="true">
      <CheckIcon size={13} />
    </span>
  );
}

/**
 * One rank-specific ledger, headed by the category's own served display name.
 * `display_range` is the syllabus numbering the paper chart carries, which the
 * old review screen never showed.
 */
function LedgerTable({ group }: { group: CategoryGroup }) {
  const hasAnyRange = group.items.some((item) => item.display_range);

  return (
    <>
      <h2 className="acp-section">{group.categoryDisplay}</h2>
      <table className="acp-ledger" data-testid={`acp-ledger-${group.category}`}>
        <thead>
          <tr>
            <th scope="col">Requirement</th>
            {hasAnyRange && <th scope="col" className="acp-ledger-range-col">Numbers</th>}
            <th scope="col" className="acp-ledger-result-col">Result</th>
          </tr>
        </thead>
        <tbody>
          {group.items.map((item) => (
            <tr key={item.id} data-testid={`acp-ledger-row-${item.id}`}>
              <td>
                <strong>{item.item_name}</strong>
                {item.korean_name && <span className="acp-ledger-korean"> {item.korean_name}</span>}
                {!item.required && <span className="caw-optional-badge">Optional</span>}
              </td>
              {hasAnyRange && <td className="acp-ledger-range">{item.display_range}</td>}
              <td>
                <ResultMark result={item.result} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
