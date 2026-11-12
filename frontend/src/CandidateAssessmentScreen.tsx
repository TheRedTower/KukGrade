import { type ComponentProps, useState } from "react";
import { keys } from "./queryKeys";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BackLink } from "./BackLink";
import { EmptyState } from "./EmptyState";
import { RecordPage } from "./RecordPage";
import { type RecordStatus, useIdParam } from "./recordStatus";
import { Alert } from "./Alert";
import {
  addAssessmentItemComment,
  CandidateAssessmentItemResult,
  deleteCandidateAssessment,
  generateCandidateAssessment,
  updateCandidateAssessment,
  errorMessage,
} from "./api";
import { forgetDeletedAssessment, useCandidateAssessmentData } from "./candidateAssessmentData";
import { formatDayMonth, formatTime } from "./dates";
import { ArrowRightIcon, CheckIcon, CrossIcon, WarningIcon } from "./Icons";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Meter } from "./Meter";
import { buttonClass } from "./buttonClass";
import { assessmentTone } from "./badgeClass";
import { AssessmentItemRow, CategoryHeader, DeleteAssessmentDialog } from "./AssessmentParts";
import "./CandidateAssessment.css";
import { counted } from "./plural";
import { CandidateRanks } from "./RankTransition";
import { type ItemWriteOptions, useItemWrites } from "./useItemWrites";

/** An item's row with a mutation of its own, so its writes queue in that item's scope. */
function ScoredItemRow({
  write,
  onMark,
  ...row
}: Omit<ComponentProps<typeof AssessmentItemRow>, "onMark" | "onChangeResult"> & {
  write: ItemWriteOptions;
  /** Called as a first mark is sent. */
  onMark: () => void;
}) {
  const mutation = useMutation(write);
  return (
    <AssessmentItemRow
      {...row}
      onMark={(result) => {
        onMark();
        mutation.mutate({ result });
      }}
      onChangeResult={(result, reason) => mutation.mutateAsync({ result, reason })}
    />
  );
}

export function CandidateAssessmentScreen() {
  const sessionId = useIdParam("sessionId");
  const candidateId = useIdParam("candidateId");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const numSessionId = sessionId ?? undefined;
  const numCandidateId = candidateId ?? undefined;

  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // At most one row may be asking for the reason a mark is changing, or taking
  // a comment, at a time - both are held here rather than in the row so
  // opening one closes the other.
  const [changing, setChanging] = useState<{ itemId: number; result: CandidateAssessmentItemResult } | null>(null);
  const [openCommentId, setOpenCommentId] = useState<number | null>(null);

  const { session, candidate, assessment, categoryGroups, stats, isLoading, hasLoadError } = useCandidateAssessmentData(
    numSessionId,
    numCandidateId,
  );

  const generateAssessmentMutation = useMutation({
    mutationFn: (candidateId: number) => generateCandidateAssessment(candidateId),
    onSuccess: (generated) => {
      setActionError(null);
      queryClient.setQueryData(keys.candidateAssessments.byCandidate(numCandidateId), generated);
      queryClient.invalidateQueries({ queryKey: keys.gradingCandidates.all() });
    },
    onError: (err) => {
      setActionError(errorMessage(err, "The assessment form could not be prepared."));
    },
  });

  const startAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return updateCandidateAssessment(assessment.id, { status: "IN_PROGRESS" });
    },
    onSuccess: (updated) => {
      setActionError(null);
      queryClient.setQueryData(keys.candidateAssessments.byCandidate(numCandidateId), updated);
      queryClient.invalidateQueries({ queryKey: keys.gradingCandidates.all() });
    },
    onError: (err) => {
      setActionError(errorMessage(err, "The assessment could not be started."));
    },
  });

  const itemsKey = keys.candidateAssessmentItems(assessment?.id);
  const {
    writeKey: itemWriteKey,
    isSaving: isSavingItems,
    patchItem,
    writeOptions,
  } = useItemWrites({
    assessmentId: assessment?.id,
    candidateId: numCandidateId,
    onError: (err) => setActionError(errorMessage(err, "This mark could not be saved.")),
  });

  // A comment is added, never changed, so it needs none of the write ordering
  // above: it is shown as soon as the server has it.
  const addCommentMutation = useMutation({
    mutationFn: ({ itemId, body }: { itemId: number; body: string }) => addAssessmentItemComment(itemId, body),
    onSuccess: (comment, { itemId }) => {
      patchItem(itemId, (item) => ({ ...item, comments: [...item.comments, comment] }));
      // Not while scores are still being saved: a refetch now would show the
      // server's older values over the ones just chosen. The last of those
      // writes refetches the list, comments included.
      if (queryClient.isMutating({ mutationKey: itemWriteKey }) === 0) {
        queryClient.invalidateQueries({ queryKey: itemsKey });
      }
    },
    onError: (err) => setActionError(errorMessage(err, "The comment could not be added.")),
  });

  const deleteAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return deleteCandidateAssessment(assessment.id);
    },
    onSuccess: () => {
      if (assessment && candidate) {
        forgetDeletedAssessment(queryClient, {
          assessmentId: assessment.id,
          candidateId: candidate.id,
        });
      }
      navigate(`/gradings/${numSessionId}`);
    },
  });
  const deleteAssessmentError = deleteAssessmentMutation.error
    ? errorMessage(deleteAssessmentMutation.error, "The assessment could not be deleted.")
    : null;

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
            ? { to: `/gradings/${sessionId}`, label: "Grading session" }
            : {
                to: sessionId ? `/gradings/${sessionId}` : "/gradings",
                label: sessionId ? "Grading session" : "Gradings",
              }
        }
        failed="The assessment summary could not be loaded, so scoring is paused rather than shown with counts that may be wrong. Reload to try again."
        label="Candidate assessment"
        loading="Loading the assessment…"
        missing="Candidate or grading session not found"
        status={status ?? "loading"}
        testId="caw"
      />
    );
  }

  const reviewPath = `/gradings/${sessionId}/assessments/${candidateId}/review`;
  // The rollup is served and only refetched once a score settles, so while an
  // item PATCH is in flight `stats` still describes the pre-edit assessment.
  // Clearing a required result would otherwise leave completion enabled, and a
  // completion request that won the race could seal the assessment before the
  // clear landed.
  const canComplete = stats.canComplete && !isSavingItems;
  const isAssessmentCompleted = assessment?.status === "COMPLETED";
  const isAssessmentMissing = assessment === null;
  // Whether the form can be prepared, the assessment started or completed is
  // served, by the rules those writes check.
  const canPrepare = candidate.can_prepare_assessment;
  const canStart = Boolean(assessment?.can_start);
  const isAssessmentNotStarted = assessment?.status === "NOT_STARTED";
  // Whether this viewer may change marks and comment now is the server's call
  // (the session is open, or it is locked and they are the authorised Master
  // and this candidate's final decision is not yet recorded): it is served,
  // not worked out here.
  const canEdit = !!assessment?.marks_open;
  // Marks still open once grading has ended: the Master correcting after the lock.
  const correctingAfterLock = canEdit && !session.marking_open;

  const metWidth = stats.totalItems > 0 ? (stats.metCount / stats.totalItems) * 100 : 0;
  const notMetWidth = stats.totalItems > 0 ? (stats.notMetCount / stats.totalItems) * 100 : 0;

  return (
    <section aria-labelledby="caw-title" className="page caw-run" data-testid="caw-workspace">
      <BackLink to={`/gradings/${session.id}`}>{session.title}</BackLink>

      <header className="caw-identity">
        <h1 className="caw-candidate-name" id="caw-title">
          {candidate.student_display_name}
        </h1>
        {candidate.student_wksa_id && <span className="caw-candidate-wksa meta">{candidate.student_wksa_id}</span>}
        <span aria-hidden="true" className="caw-identity-divider" />
        <CandidateRanks candidate={candidate} badges />
        <Badge tone="info">{candidate.age_band_display}</Badge>
        <Badge tone={assessmentTone(assessment?.status)} dot data-testid="caw-status-pill">
          {assessment?.status_display || "Not started"}
          {assessment?.started_at && ` · started ${formatTime(assessment.started_at)}`}
        </Badge>

        <div className="caw-identity-spacer" />

        {/* Provenance: who prepared the snapshot, and when it was frozen. */}
        {assessment?.generated_by_name && (
          <span className="meta">
            Form prepared by {assessment.generated_by_name}
            {assessment.generated_at && ` · ${formatDayMonth(assessment.generated_at)}`}
          </span>
        )}
        {assessment?.can_delete && (
          <Button variant="danger" small onClick={() => setDeleteOpen(true)} data-testid="caw-delete-assessment-btn">
            Delete assessment
          </Button>
        )}
      </header>

      {actionError && <Alert icon={<WarningIcon size={16} />}>{actionError}</Alert>}

      {isAssessmentMissing && (
        <div className="action-row caw-not-started-banner" data-testid="caw-missing-assessment-banner">
          <div className="caw-not-started-content">
            <h2>Prepare assessment form</h2>
            <p className="subtext">
              Prepare the candidate&rsquo;s assessment form from the syllabus before starting. It keeps the syllabus as
              it is today, so later changes to the syllabus never alter it.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => generateAssessmentMutation.mutate(candidate.id)}
            disabled={generateAssessmentMutation.isPending || !canPrepare}
            data-testid="generate-assessment-btn"
          >
            {generateAssessmentMutation.isPending
              ? "Preparing…"
              : !canPrepare
                ? "The form cannot be prepared now"
                : "Prepare assessment form"}
          </Button>
        </div>
      )}

      {/* After the lock only the authorised Master corrects a record, until their decision is made. */}
      {correctingAfterLock && (
        <Alert tone="warning" role="status" data-testid="caw-locked-correction-note">
          This session is locked. As the authorised Master you can still correct a mark or add a comment, with a reason,
          until this candidate&rsquo;s final decision is recorded. Each correction is kept and shown with the decision.
        </Alert>
      )}

      {/* A generated snapshot is started separately once the session is open. */}
      {isAssessmentNotStarted && (
        <div className="action-row caw-not-started-banner" data-testid="caw-not-started-banner">
          <div className="caw-not-started-content">
            <h2>Assessment ready to begin</h2>
            <p className="subtext">
              Candidates must have their assessment started before individual syllabus items can be scored.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => startAssessmentMutation.mutate()}
            disabled={startAssessmentMutation.isPending || !canStart}
            data-testid="start-assessment-btn"
          >
            {startAssessmentMutation.isPending
              ? "Starting…"
              : !canStart
                ? "Session must be Open to start"
                : "Start assessment"}
          </Button>
        </div>
      )}

      {/* The run itself: every requirement, in syllabus order, in one scroll. */}
      <div className="caw-run-scroll">
        {categoryGroups.length === 0 ? (
          <EmptyState title="This assessment form has no items." />
        ) : (
          categoryGroups.map((group) => (
            <div key={group.category}>
              <CategoryHeader group={group} />
              {group.items.map((item) => (
                <ScoredItemRow
                  key={item.id}
                  write={writeOptions(item.id)}
                  item={item}
                  canEdit={canEdit}
                  pendingResult={changing?.itemId === item.id ? changing.result : null}
                  isCommentOpen={openCommentId === item.id}
                  onMark={() => setChanging(null)}
                  onAskChange={(result) => {
                    setOpenCommentId(null);
                    setChanging({ itemId: item.id, result });
                  }}
                  onCancelChange={() =>
                    // Only this row's own prompt: a save finishing after you moved
                    // on to another item must not close that item's.
                    setChanging((current) => (current?.itemId === item.id ? null : current))
                  }
                  onToggleComment={() => {
                    setChanging(null);
                    setOpenCommentId((current) => (current === item.id ? null : item.id));
                  }}
                  onCloseComment={() => setOpenCommentId((current) => (current === item.id ? null : current))}
                  onAddComment={(body) => addCommentMutation.mutateAsync({ itemId: item.id, body })}
                />
              ))}
            </div>
          ))
        )}

        {categoryGroups.length > 0 && (
          <p className="caw-run-end meta">
            End of assessment form · {counted(categoryGroups.length, "category", "categories")}
            {assessment?.generated_at && ` · prepared ${formatDayMonth(assessment.generated_at)}`} from{" "}
            {candidate.age_band_display}
          </p>
        )}
      </div>

      {/* Persistent mat bar: the live count and the only completion action. */}
      <div className="caw-mat-bar" data-testid="caw-mat-bar">
        <div className="caw-mat-count" role="status" aria-live="polite">
          <span className="caw-mat-figure item-title">{`${stats.requiredAssessed} / ${stats.requiredItems}`}</span>
          <span className="meta">required assessed</span>
        </div>

        <Meter
          className="caw-mat-meter"
          segments={[
            { percent: metWidth, tone: "success" },
            { percent: notMetWidth, tone: "danger" },
          ]}
        />

        <span className="row row--inline row--1 caw-mat-tally-met">
          <CheckIcon size={13} />
          {`${stats.metCount} met`}
        </span>
        <span className="row row--inline row--1 caw-mat-tally-not-met">
          <CrossIcon size={13} />
          {`${stats.notMetCount} not met`}
        </span>
        <span className="row row--inline row--1 caw-mat-tally-remaining">{`${stats.remainingRequired} remaining`}</span>

        <div className="caw-identity-spacer" />

        {isAssessmentCompleted ? (
          <Link className={buttonClass({ variant: "secondary" })} to={reviewPath} data-testid="caw-view-review-btn">
            View completion record <ArrowRightIcon />
          </Link>
        ) : (
          <Button
            variant={canComplete ? "primary" : "secondary"}
            disabled={!canComplete}
            onClick={() => navigate(reviewPath)}
            title={
              isSavingItems
                ? "Saving the last result"
                : stats.canComplete
                  ? "Proceed to completion review"
                  : `${stats.remainingRequired} required items remain unassessed`
            }
            data-testid="caw-complete-assessment-btn"
          >
            {isSavingItems ? (
              "Saving…"
            ) : stats.canComplete ? (
              <>
                Complete assessment <ArrowRightIcon />
              </>
            ) : (
              `Complete assessment (${stats.remainingRequired} required remaining)`
            )}
          </Button>
        )}
      </div>

      {deleteOpen && assessment && (
        <DeleteAssessmentDialog
          candidateName={candidate.student_display_name}
          isPending={deleteAssessmentMutation.isPending}
          error={deleteAssessmentError}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => deleteAssessmentMutation.mutate()}
        />
      )}
    </section>
  );
}
