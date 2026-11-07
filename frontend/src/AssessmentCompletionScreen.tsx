/**
 * Completion review - Certificate Proof.
 *
 * The record renders as the document
 * it becomes, so the instructor proofreads rather than fills in a form:
 * candidate and rank transition, core grading areas, the requirement ledgers,
 * every recorded note, the assessment note, and a seal line that stays blank
 * until the record is sealed. Provenance and counts sit in a side column.
 *
 * Two things that would be easy to get wrong:
 *
 * - **Every** comment renders, not only those on `NOT_MET` items. Comments
 *   carry positive observations too, so one on a met requirement would
 *   otherwise be invisible at the last moment it can be read, and absent from
 *   the permanent record afterwards.
 * - The assessment note stays **editable** while unsealed. Completion is the
 *   only point at which `CandidateAssessment.notes` can be written - it is
 *   submitted with the `COMPLETED` transition and is immutable afterwards -
 *   and the 1A scoring screen has no overall-note control, so rendering it as
 *   static prose would remove the only write path in the application.
 *
 * Counts are served, never recounted here. No percentages: `Result`
 * is NOT_ASSESSED / MET / NOT_MET and carries no partial credit.
 */
import { useState } from "react";
import { useAuth } from "./auth";
import { refresh } from "./queryKeys";
import { BackLink } from "./BackLink";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  updateCandidateAssessment,
  errorMessage,
} from "./api";
import { LoadingState } from "./LoadingState";
import { Alert } from "./Alert";
import { RankBelt } from "./Belt";
import { useSiteSettingsQuery } from "./queries";
import {
  useAssessmentNotesDraft,
  useCandidateAssessmentData,
} from "./candidateAssessmentData";
import { formatShortDate, formatShortDateTime, formatTime } from "./dates";
import "./CandidateAssessment.css";
import { CheckIcon, CrossIcon, WarningIcon } from "./Icons";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { CoreAreaMark, LedgerTable, ResultMark, SealIcon } from "./AssessmentRecordParts";
import { EmailAddress, EmailList } from "./EmailAddress";

export function AssessmentCompletionScreen() {
  const { sessionId, candidateId } = useParams<{ sessionId: string; candidateId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clubName = useSiteSettingsQuery().data?.club_name;
  const { user: currentUser } = useAuth();

  const numSessionId = sessionId ? Number(sessionId) : undefined;
  const numCandidateId = candidateId ? Number(candidateId) : undefined;

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
  // The draft outlives a trip back to scoring - see useAssessmentNotesDraft.
  const { draft: userNotes, setDraft: setUserNotes, clearDraft: clearNotesDraft } =
    useAssessmentNotesDraft(assessment?.id);

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
      refresh.afterAssessmentChange(queryClient, numCandidateId);
      navigate(`/gradings/${numSessionId}`);
    },
    onError: (err) => {
      setActionError(errorMessage(err, "Failed to complete assessment."));
    },
  });

  if (isLoading) {
    return (
      <section aria-label="Assessment completion review" className="page" data-testid="caw-review-loading">
        <LoadingState>Loading completion review…</LoadingState>
      </section>
    );
  }

  if (hasLoadError) {
    return (
      <section aria-label="Assessment completion review" className="page" data-testid="caw-review-load-error">
        <Alert action={<Link to={scoringPath} className={buttonClass({ variant: "secondary" })}>
            ← Return to scoring
          </Link>}>
          The assessment summary could not be loaded, so the record cannot be reviewed or
            sealed right now. Reload to try again.
        </Alert>
      </section>
    );
  }

  if (!session || !candidate) {
    return (
      <section aria-label="Assessment completion review" className="page" data-testid="caw-review-not-found">
        <Alert action={<Link to={`/gradings/${sessionId}`} className={buttonClass({ variant: "secondary" })}>
            ← Return to session roster
          </Link>}>
          Candidate or grading session not found.
        </Alert>
      </section>
    );
  }

  const isSealed = assessment?.status === "COMPLETED";

  // Reachable by typed URL before the assessment is ready for review. The
  // scoring screen only links here once every required item is assessed, so
  // this state explains itself rather than showing an empty proof.
  if (!assessment || (!isSealed && !stats.canComplete)) {
    return (
      <section aria-label="Assessment completion review" className="page" data-testid="caw-review-unavailable">
        <Alert action={<Link to={scoringPath} className={buttonClass({ variant: "secondary" })}>
            ← Return to scoring
          </Link>}>
          {!assessment
              ? "This candidate has no assessment form yet, so there is nothing to review."
              : `${stats.remainingRequired} required ${
                  stats.remainingRequired === 1 ? "item remains" : "items remain"
                } unassessed. Finish scoring before completing the assessment.`}
        </Alert>
      </section>
    );
  }

  /*
    The proof separates the six universal core areas from the rank-specific
    ledgers (by each item's served `category_is_core`). Everything that is not a core
    area gets a ledger of its own under its served `category_display` - not
    just Techniques and Forms. A Weapons or Other requirement that was scored
    during the grading must still appear, or the permanent record would be
    missing part of what was assessed.
  */
  const coreGroups = categoryGroups.filter((group) => group.isCore);
  const ledgerGroups = categoryGroups.filter((group) => !group.isCore);

  // Every comment, whichever way the requirement went.
  const notedItems = items.filter((item) => item.comments.length > 0);

  // Distinct assessors across the record, in the order they first appear.
  const assessors = Array.from(
    new Set(items.map((item) => item.assessor_email).filter((email): email is string => !!email)),
  );

  const canSeal = hasProofread && !completeAssessmentMutation.isPending;

  return (
    <section aria-labelledby="acp-title" className="page acp-page" data-testid="caw-review-workspace">
      <header className="acp-topbar">
        <BackLink to={scoringPath}>Back to scoring</BackLink>
        <span aria-hidden="true" className="acp-topbar-divider" />
        {currentUser?.can_read_audit_log && (
          <Link
            to={`/audit?subject=candidate:${candidateId}`}
            className={buttonClass({ variant: "ghost", small: true })}
            data-testid="acp-history-link"
          >
            History
          </Link>
        )}
        <span className="meta">
          {isSealed
            ? assessment?.marks_open
              ? session.status === "OPEN"
                ? "This record is sealed; a mark can still be corrected until the session locks"
                : "This record is sealed; as the Master you can still correct it until the decision is recorded"
              : "This record is sealed and cannot be changed"
            : "Proof the record before it is sealed"}
        </span>
      </header>

      {actionError && (
        <Alert icon={<WarningIcon size={16} />}>{actionError}</Alert>
      )}

      <div className="acp-layout">
        {/* ── The record ─────────────────────────────────────────────────── */}
        <article aria-label="Assessment record proof" className="acp-sheet">
          <div className="acp-sheet-head">
            <div>
              <div className="eyebrow--muted">
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
              <div className="eyebrow--muted">Candidate</div>
              <div className="acp-candidate-name section-title">{candidate.student_display_name}</div>
              <div className="acp-candidate-sub meta">
                {candidate.student_wksa_id && `WKSA ID ${candidate.student_wksa_id} · `}
                {candidate.age_band_display}
              </div>
            </div>
            <div className="acp-identity-right">
              <div className="eyebrow--muted">Assessed for</div>
              <div className="acp-rank-line">
                <span className="acp-rank">
                  {candidate && <RankBelt rankId={candidate.from_rank} />}
                  <span>{candidate?.from_rank_name ?? ""}</span>
                </span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="caw-rank-arrow">
                  <path d="M4 12h15M14 7l5 5-5 5" />
                </svg>
                <span className="acp-rank item-title">
                  <RankBelt rankId={candidate.testing_for_rank} />
                  <span>{candidate.testing_for_rank_name}</span>
                </span>
              </div>
              <div className="acp-candidate-sub meta">
                {session.title}
                {session.grading_date && ` · ${formatShortDate(session.grading_date, "")}`}
              </div>
            </div>
          </div>

          {coreGroups.length > 0 && (
            <>
              <h2 className="acp-section eyebrow--muted">Core grading areas · always assessed</h2>
              <div className="acp-core-grid">
                {coreGroups.map((group) => (
                  <div key={group.category} className="acp-core-cell" data-testid={`acp-core-${group.category}`}>
                    <CoreAreaMark group={group} />
                    <span className="acp-core-text">
                      <span className="acp-core-name item-title">{group.categoryDisplay}</span>
                      <span className="acp-core-detail meta">
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

          <h2 className="acp-section eyebrow--muted">Comments on individual requirements</h2>
          {notedItems.length === 0 ? (
            <p className="acp-section-note meta">No comments were recorded against individual requirements.</p>
          ) : (
            <>
              <p className="acp-section-note meta">
                Every comment recorded during scoring, whichever way the requirement went.
              </p>
              {notedItems.map((item) => (
                <div key={item.id} className="acp-note" data-testid={`acp-note-${item.id}`}>
                  <div className="acp-note-head">
                    <span className="item-title">
                      #{item.position} {item.item_name}
                      {item.korean_name && ` · ${item.korean_name}`}
                    </span>
                    <ResultMark result={item.result} />
                  </div>
                  {item.comments.map((comment) => (
                    <p key={comment.id} className="acp-note-body meta">
                      “{comment.body}”
                      <span className="meta">
                        {" "}— {comment.author_name} · {formatShortDateTime(comment.created_at)}
                      </span>
                    </p>
                  ))}
                </div>
              ))}
            </>
          )}

          <h2 className="acp-section eyebrow--muted">
            <label htmlFor="general-assessment-notes">Assessment note</label>
          </h2>
          {isSealed ? (
            <p className="acp-sealed-note" data-testid="acp-sealed-note">
              {assessment.notes || "No overall assessment note was recorded."}
            </p>
          ) : (
            <>
              <p className="acp-section-note meta">
                Editable until the record is sealed. This is the only point at which the overall
                assessment note can be written — it is saved with the record and cannot be changed afterwards.
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
              <div className="eyebrow--muted">Recorded by</div>
              <div className="acp-seal-value item-title">
                {assessors.length > 0 ? <EmailList addresses={assessors} /> : "Not yet attributed"}
              </div>
              {assessment.started_at && (
                <div className="acp-seal-detail meta">
                  Assessed from {formatTime(assessment.started_at)}
                  {assessment.completed_at && ` to ${formatTime(assessment.completed_at)}`}
                  {session.grading_date && ` on ${formatShortDate(session.grading_date, "")}`}
                </div>
              )}
            </div>
            <div>
              <div className="eyebrow--muted">Seal</div>
              {/* Blank until sealed: the line is the point of the document. */}
              {isSealed && assessment.completed_at ? (
                <>
                  <div className="acp-seal-value item-title acp-seal-applied" data-testid="acp-seal-applied">
                    Sealed {formatShortDate(assessment.completed_at, "")} at{" "}
                    {formatTime(assessment.completed_at)}
                  </div>
                  <div className="acp-seal-detail meta">This record can no longer be changed.</div>
                </>
              ) : (
                <>
                  <div className="acp-seal-blank" aria-hidden="true" />
                  <div className="acp-seal-detail meta">Applied when the record is sealed</div>
                </>
              )}
            </div>
          </div>
        </article>

        {/* ── Provenance, counts and the seal controls ───────────────────── */}
        <aside aria-label="Record details and seal" className="acp-aside">
          <div className="acp-card">
            <h2 className="acp-card-title eyebrow--muted">Record details</h2>
            <dl className="facts-list facts-list--aligned facts-list--compact">
              <div>
                <dt>Form prepared</dt>
                <dd>{assessment.generated_at ? formatShortDate(assessment.generated_at, "") : "—"}</dd>
              </div>
              <div>
                <dt>Prepared by</dt>
                <dd>{assessment.generated_by_email ? <EmailAddress address={assessment.generated_by_email} /> : "—"}</dd>
              </div>
              <div>
                <dt>Age group</dt>
                <dd>{candidate.age_band_display}</dd>
              </div>
              <div>
                <dt>Assessors</dt>
                <dd>{assessors.length > 0 ? <EmailList addresses={assessors} /> : "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="acp-card">
            <h2 className="acp-card-title eyebrow--muted">Counts</h2>
            {/*
              No percentage. `Result` is NOT_ASSESSED / MET / NOT_MET with no
              partial credit, so a percentage would imply a score the model
              cannot express. Counts are served, not recounted.
            */}
            <div className="acp-count-figure">
              <strong className="stat__value">{stats.requiredAssessed}</strong>
              <span className="subtext">{`/ ${stats.requiredItems} required`}</span>
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
              <p className="acp-count-optional meta">
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
                    ? "This record is sealed. While the session is open a mark can still be corrected, with a reason that is kept; once the session locks it is permanent."
                    : assessment?.marks_open
                      ? "This record is sealed. As the authorised Master you can still correct a mark, with a reason that is kept, until this candidate's final decision is recorded; after that it is permanent."
                      : "This record is sealed and permanent. Results, notes, assessors and times cannot be changed."}
                </p>
              </div>
              {assessment?.marks_open && (
                <Link
                  to={scoringPath}
                  className={`${buttonClass({ variant: "secondary" })} acp-correct`}
                  data-testid="acp-correct-link"
                >
                  Correct a mark
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="acp-card acp-card-notice">
                <div className="acp-notice-row">
                  <SealIcon />
                  <p>
                    Sealing completes this record. While the session is open a mark can still
                    be corrected, with a reason that is kept; it becomes permanent when the
                    session locks.
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

              <Button
                variant="primary"
                onClick={() => completeAssessmentMutation.mutate()}
                disabled={!canSeal}
                data-testid="confirm-complete-assessment-btn"
              >
                <CheckIcon size={17} />
                {completeAssessmentMutation.isPending ? "Sealing..." : "Seal assessment record"}
              </Button>
            </>
          )}

          <Link to={scoringPath} className={buttonClass({ variant: "secondary" })}>
            Return to scoring
          </Link>
        </aside>
      </div>
    </section>
  );
}
