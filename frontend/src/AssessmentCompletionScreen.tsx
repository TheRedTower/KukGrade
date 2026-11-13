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
 *   the permanent record afterwards. Every changed mark renders with its
 *   reason as well (ItemRemarks), as on the scoring rows.
 * - The assessment note stays **editable** while unsealed. Completion is the
 *   only point at which `CandidateAssessment.notes` can be written - it is
 *   submitted with the `COMPLETED` transition and is immutable afterwards -
 *   and the scoring screen has no overall-note control, so rendering it as
 *   static prose would remove the only write path in the application.
 *
 * Counts are served, never recounted here. No percentages: `Result`
 * is NOT_ASSESSED / MET / NOT_MET and carries no partial credit.
 */
import { useState } from "react";
import { useAuth } from "./auth";
import { keys, refresh } from "./queryKeys";
import { BackLink } from "./BackLink";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { downloadCandidateRecords, updateCandidateAssessment, errorMessage } from "./api";
import { usePdfDownload } from "./pdfDownloads";
import { PdfDownloadNotice } from "./PdfDownloadNotice";
import { RecordPage } from "./RecordPage";
import { type RecordStatus, useIdParam } from "./recordStatus";
import { Alert } from "./Alert";
import { useSiteSettingsQuery } from "./queries";
import { useAssessmentNotesDraft, useCandidateAssessmentData } from "./candidateAssessmentData";
import { formatShortDate, formatTime } from "./dates";
import { ItemRemarks } from "./ItemRemarks";
import { hasRemarks } from "./remarks";
import "./CandidateAssessment.css";
import { ArrowLeftIcon, CheckIcon, CrossIcon, LockIcon, WarningIcon } from "./Icons";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { CoreAreaMark, LedgerTable, ResultMark } from "./AssessmentRecordParts";
import { agreeing } from "./plural";
import { CandidateRanks } from "./RankTransition";
import { cx } from "./cx";
import { stickyAside } from "./stickyParts";
import { usePageLabel } from "./pageTrail";

export function AssessmentCompletionScreen() {
  const sessionId = useIdParam("sessionId");
  const candidateId = useIdParam("candidateId");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clubName = useSiteSettingsQuery().data?.club_name;
  const { user: currentUser } = useAuth();

  const numSessionId = sessionId ?? undefined;
  const numCandidateId = candidateId ?? undefined;

  const [actionError, setActionError] = useState<string | null>(null);
  const [hasProofread, setHasProofread] = useState(false);
  const download = usePdfDownload();

  const { session, candidate, assessment, items, categoryGroups, stats, isLoading, hasLoadError } =
    useCandidateAssessmentData(numSessionId, numCandidateId);
  // The draft outlives a trip back to scoring - see useAssessmentNotesDraft.
  const {
    draft: userNotes,
    setDraft: setUserNotes,
    clearDraft: clearNotesDraft,
  } = useAssessmentNotesDraft(assessment?.id);

  const generalNotes = userNotes !== null ? userNotes : (assessment?.notes ?? "");
  const scoringPath = `/gradings/${sessionId}/assessments/${candidateId}`;
  usePageLabel(candidate ? `Assessment record · ${candidate.student_display_name}` : undefined);

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
      setActionError(errorMessage(err, "The assessment could not be completed."));
    },
  });

  const status: RecordStatus | null = isLoading
    ? "loading"
    : hasLoadError
      ? "failed"
      : !session || !candidate
        ? "missing"
        : null;
  if (status || !session || !candidate) {
    return (
      <RecordPage
        back={
          status === "failed"
            ? { to: scoringPath, label: "Assessment" }
            : {
                to: sessionId ? `/gradings/${sessionId}` : "/gradings",
                label: sessionId ? "Grading session" : "Gradings",
              }
        }
        failed="The assessment summary could not be loaded, so the record cannot be reviewed or sealed right now. Reload to try again."
        label="Assessment completion review"
        loading="Loading completion review…"
        missing="Candidate or grading session not found"
        status={status ?? "loading"}
        testId="caw-review"
      />
    );
  }

  const isSealed = assessment?.status === "COMPLETED";

  // Reachable by typed URL before the assessment is ready for review. The
  // scoring screen only links here once every required item is assessed, so
  // this state explains itself rather than showing an empty proof.
  if (!assessment || (!isSealed && !stats.canComplete)) {
    return (
      <section aria-label="Assessment completion review" className="page" data-testid="caw-review-unavailable">
        <Alert
          action={
            <Link to={scoringPath} className={buttonClass({ variant: "secondary" })}>
              <ArrowLeftIcon /> Return to scoring
            </Link>
          }
        >
          {!assessment
            ? "This candidate has no assessment form yet, so there is nothing to review."
            : `${stats.remainingRequired} required ${agreeing(
                stats.remainingRequired,
                "item remains",
                "items remain",
              )} unassessed. Finish scoring before completing the assessment.`}
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

  // Every comment and every changed mark, whichever way the requirement went.
  const notedItems = items.filter(hasRemarks);

  // Distinct assessors across the record, in the order they first appear.
  const assessors = Array.from(new Set(items.map((item) => item.assessor_name).filter((name) => name !== "")));

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
        {candidate.can_download_record && (
          <Button
            variant="secondary"
            small
            disabled={download.isPending}
            onClick={() => download.mutate(() => downloadCandidateRecords(session.id, [candidate.id]))}
          >
            {download.isPending ? "Preparing PDF…" : "Download PDF"}
          </Button>
        )}
        <span className="meta">
          {isSealed
            ? assessment?.marks_open
              ? session.marking_open
                ? "This record is sealed; a mark can still be corrected until the session locks"
                : "This record is sealed; as the Master you can still correct it until the decision is recorded"
              : "This record is sealed and cannot be changed"
            : "Proof the record before it is sealed"}
        </span>
      </header>

      {actionError && <Alert icon={<WarningIcon size={16} />}>{actionError}</Alert>}
      <PdfDownloadNotice
        download={download}
        nameOf={(id) => (id === candidate.id ? candidate.student_display_name : undefined)}
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: keys.gradingSessions.detail(session.id) });
          void queryClient.invalidateQueries({ queryKey: keys.gradingCandidates.detail(candidate.id) });
        }}
      />

      <div className="acp-layout">
        {/* ── The record ─────────────────────────────────────────────────── */}
        <article aria-label="Assessment record proof" className="acp-sheet">
          <div className="acp-sheet-head">
            <div>
              <div className="eyebrow--muted">
                {clubName}
                {session.location && ` · ${session.location}`}
              </div>
              <h1 className="acp-sheet-title" id="acp-title">
                Assessment record
              </h1>
            </div>
            <span className={cx("eyebrow acp-stamp", isSealed && "acp-stamp-sealed")} data-testid="acp-stamp">
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
                <CandidateRanks candidate={candidate} />
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
              <div className="even-set">
                <div className="acp-core-grid tiles even-set__items">
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
              </div>
            </>
          )}

          {ledgerGroups.map((group) => (
            <LedgerTable key={group.category} group={group} />
          ))}

          <h2 className="acp-section eyebrow--muted">Comments and changed marks on individual requirements</h2>
          {notedItems.length === 0 ? (
            <p className="acp-section-note meta">
              No comments or changed marks were recorded against individual requirements.
            </p>
          ) : (
            <>
              <p className="acp-section-note meta">
                Every comment, and every mark changed with its reason, whichever way the requirement went.
              </p>
              {notedItems.map((item) => (
                <div key={item.id} className="stack stack--1 acp-note" data-testid={`acp-note-${item.id}`}>
                  <div className="acp-note-head">
                    <span className="item-title">
                      #{item.position} {item.item_name}
                      {item.korean_name && ` · ${item.korean_name}`}
                    </span>
                    <ResultMark result={item.result} />
                  </div>
                  <ItemRemarks item={item} />
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
                Editable until the record is sealed. This is the only point at which the overall assessment note can be
                written — it is saved with the record and cannot be changed afterwards.
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
                {assessors.length > 0 ? assessors.join(", ") : "Not yet attributed"}
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
                    Sealed {formatShortDate(assessment.completed_at, "")} at {formatTime(assessment.completed_at)}
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
        <aside aria-label="Record details and seal" className="acp-aside" ref={stickyAside}>
          <div className="acp-card">
            <h2 className="acp-card-title eyebrow--muted">Record details</h2>
            <dl className="facts-list facts-list--aligned facts-list--compact">
              <div>
                <dt>Form prepared</dt>
                <dd>{assessment.generated_at ? formatShortDate(assessment.generated_at, "") : "—"}</dd>
              </div>
              <div>
                <dt>Prepared by</dt>
                <dd>{assessment.generated_by_name || "—"}</dd>
              </div>
              <div>
                <dt>Age group</dt>
                <dd>{candidate.age_band_display}</dd>
              </div>
              <div>
                <dt>Assessors</dt>
                <dd>{assessors.length > 0 ? assessors.join(", ") : "—"}</dd>
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
              <span className="meta row row--inline row--1 acp-result-met">
                <CheckIcon size={13} />
                {`${stats.metCount} met`}
              </span>
              <span className="meta row row--inline row--1 acp-result-not-met">
                <CrossIcon size={13} />
                {`${stats.notMetCount} not met`}
              </span>
            </div>
            {stats.notAssessedCount > 0 && (
              <p className="acp-count-optional meta">
                {`${stats.notAssessedCount} optional ${agreeing(
                  stats.notAssessedCount,
                  "requirement was",
                  "requirements were",
                )} left unassessed.`}
              </p>
            )}
          </div>

          {isSealed ? (
            <div className="acp-card acp-card-sealed" data-testid="acp-sealed-panel">
              <div className="acp-notice-row">
                <LockIcon size={18} />
                <p>
                  {session.marking_open
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
                  <LockIcon size={18} />
                  <p>
                    Sealing completes this record. While the session is open a mark can still be corrected, with a
                    reason that is kept; it becomes permanent when the session locks.
                  </p>
                </div>
                <label className="check acp-proofread">
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
                {completeAssessmentMutation.isPending ? "Sealing…" : "Seal assessment record"}
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
