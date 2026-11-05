import { useRef, useState } from "react";
import { keys } from "./queryKeys";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "./Breadcrumbs";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { Alert } from "./Alert";
import { useAuth } from "./auth";
import { addAssessmentItemComment, CandidateAssessmentItem, CandidateAssessmentItemResult, deleteCandidateAssessment, generateCandidateAssessment, updateCandidateAssessment, updateCandidateAssessmentItem, errorMessage } from "./api";
import { RankBelt } from "./Belt";
import { forgetDeletedAssessment, useCandidateAssessmentData } from "./candidateAssessmentData";
import { formatDayMonth, formatTime } from "./dates";
import { CheckIcon, CrossIcon, WarningIcon } from "./Icons";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Meter } from "./Meter";
import { buttonClass } from "./buttonClass";
import { assessmentTone } from "./badgeClass";
import { AssessmentItemRow, CategoryHeader, DeleteAssessmentDialog } from "./AssessmentParts";
import "./CandidateAssessment.css";

export function CandidateAssessmentScreen() {
  const { sessionId, candidateId } = useParams<{ sessionId: string; candidateId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const numSessionId = sessionId ? Number(sessionId) : undefined;
  const numCandidateId = candidateId ? Number(candidateId) : undefined;

  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // At most one row may be confirming a clear or writing a comment at a time -
  // both are held here rather than in the row so opening one closes the other.
  const [confirmingClearId, setConfirmingClearId] = useState<number | null>(null);
  const [openCommentId, setOpenCommentId] = useState<number | null>(null);

  const {
    session,
    candidate,
    assessment,
    categoryGroups,
    stats,
    isLoading,
    hasLoadError,
  } = useCandidateAssessmentData(numSessionId, numCandidateId);

  const generateAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!candidate) throw new Error("Candidate not found");
      return generateCandidateAssessment(candidate.id);
    },
    onSuccess: (generated) => {
      setActionError(null);
      queryClient.setQueryData(keys.candidateAssessments.byCandidate(numCandidateId), generated);
      queryClient.invalidateQueries({ queryKey: keys.gradingCandidates.all() });
    },
    onError: (err) => {
      setActionError(errorMessage(err, "Failed to prepare the assessment form."));
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
      setActionError(errorMessage(err, "Failed to start assessment."));
    },
  });

  // Item writes. Several can be in flight at once - scoring is fast -
  // so each keeps to its own item: writes to one item go out in the order
  // they were made, so the server keeps the last; each confirms or rolls back
  // only that item, and only if nothing newer was written to it since; and
  // the item list and rollup are refetched once, when every write has landed,
  // because a refetch between writes would overwrite those still in flight.
  const itemsKey = keys.candidateAssessmentItems(assessment?.id);
  const itemWriteKey = ["assessmentItemWrite", assessment?.id];
  const pendingItemWrites = useIsMutating({ mutationKey: itemWriteKey });
  const itemWriteChains = useRef(new Map<number, Promise<unknown>>());
  const itemWriteSeq = useRef(new Map<number, number>());

  const patchItem = (
    itemId: number,
    change: (item: CandidateAssessmentItem) => CandidateAssessmentItem,
  ) => {
    queryClient.setQueryData<{ results: CandidateAssessmentItem[] }>(itemsKey, (data) =>
      data
        ? { ...data, results: data.results.map((item) => (item.id === itemId ? change(item) : item)) }
        : data,
    );
  };
  const isLatestWrite = (itemId: number, seq: number) =>
    itemWriteSeq.current.get(itemId) === seq;

  // A comment is added, never changed, so it needs none of the write ordering
  // above: it is shown as soon as the server has it.
  const addCommentMutation = useMutation({
    mutationFn: ({ itemId, body }: { itemId: number; body: string }) => addAssessmentItemComment(itemId, body),
    onSuccess: (comment, { itemId }) => {
      patchItem(itemId, (item) => ({ ...item, comments: [...item.comments, comment] }));
      queryClient.invalidateQueries({ queryKey: itemsKey });
    },
    onError: (err) => setActionError(errorMessage(err, "Could not add this comment.")),
  });

  const updateItemMutation = useMutation({
    mutationKey: itemWriteKey,
    mutationFn: ({ itemId, result }: { itemId: number; result: CandidateAssessmentItemResult }) => {
      const payload = { result };
      const previous = itemWriteChains.current.get(itemId) ?? Promise.resolve();
      const write = previous
        .catch(() => undefined)
        .then(() => updateCandidateAssessmentItem(itemId, payload));
      itemWriteChains.current.set(itemId, write);
      return write;
    },
    onMutate: async ({ itemId, result }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const seq = (itemWriteSeq.current.get(itemId) ?? 0) + 1;
      itemWriteSeq.current.set(itemId, seq);
      const before = queryClient
        .getQueryData<{ results: CandidateAssessmentItem[] }>(itemsKey)
        ?.results.find((item) => item.id === itemId);
      patchItem(itemId, (item) => ({
        ...item,
        result,
      }));
      return { itemId, seq, before };
    },
    onSuccess: (saved, _vars, context) => {
      if (context && isLatestWrite(context.itemId, context.seq)) {
        patchItem(context.itemId, () => saved);
      }
    },
    onError: (err, _vars, context) => {
      if (context?.before && isLatestWrite(context.itemId, context.seq)) {
        const before = context.before;
        patchItem(context.itemId, () => before);
      }
      setActionError(errorMessage(err, "Could not save this result."));
    },
    onSettled: () => {
      // This write still counts as pending here, so 1 means it is the last.
      if (queryClient.isMutating({ mutationKey: itemWriteKey }) > 1) return;
      queryClient.invalidateQueries({ queryKey: itemsKey });
      // The rollup is served, so a scored item has to refetch it or the mat
      // bar and category headers go stale.
      queryClient.invalidateQueries({ queryKey: keys.candidateAssessmentSummary(assessment?.id) });
      queryClient.invalidateQueries({ queryKey: keys.candidateAssessments.byCandidate(numCandidateId) });
    },
  });
  const isSavingItems = pendingItemWrites > 0;

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

  if (isLoading) {
    return (
      <section aria-label="Candidate assessment" className="page caw-page" data-testid="caw-loading">
        <LoadingState>Loading the assessment…</LoadingState>
      </section>
    );
  }

  if (hasLoadError) {
    return (
      <section aria-label="Candidate assessment" className="page caw-page" data-testid="caw-load-error">
        <Alert action={<Link to={`/gradings/${sessionId}`} className={buttonClass({ variant: "secondary" })}>
            ← Return to session roster
          </Link>}>
          The assessment summary could not be loaded, so scoring is paused rather than shown with counts that may be wrong. Reload to try again.
        </Alert>
      </section>
    );
  }

  if (!session || !candidate) {
    return (
      <section aria-label="Candidate assessment" className="page caw-page" data-testid="caw-not-found">
        <Alert action={<Link to={`/gradings/${sessionId}`} className={buttonClass({ variant: "secondary" })}>
            ← Return to session roster
          </Link>}>
          Candidate or grading session not found.
        </Alert>
      </section>
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
  // The statuses assessment generation accepts (ASSESSMENT_GENERATION_SESSION_
  // STATUSES); a candidate registered after opening is prepared here too.
  const canPrepare = session.status === "DRAFT" || session.status === "OPEN";
  const isAssessmentNotStarted = assessment?.status === "NOT_STARTED";
  const isAssessmentInProgress = assessment?.status === "IN_PROGRESS";
  const isEditable = !!isAssessmentInProgress && !isAssessmentCompleted;

  const metWidth = stats.totalItems > 0 ? (stats.metCount / stats.totalItems) * 100 : 0;
  const notMetWidth = stats.totalItems > 0 ? (stats.notMetCount / stats.totalItems) * 100 : 0;

  return (
    <section aria-labelledby="caw-title" className="page caw-run" data-testid="caw-workspace">
      <Breadcrumbs
        items={[
          { label: "Gradings", to: "/gradings" },
          { label: session.title, to: `/gradings/${session.id}` },
          { label: candidate.student_display_name },
        ]}
      />

      <header className="caw-identity">
        <h1 className="caw-candidate-name" id="caw-title">{candidate.student_display_name}</h1>
        {candidate.student_wksa_id && (
          <span className="caw-candidate-wksa">{candidate.student_wksa_id}</span>
        )}
        <span aria-hidden="true" className="caw-identity-divider" />
        <Badge tone="neutral">
          {candidate && <RankBelt rankId={candidate.from_rank} />}
          <span>{candidate?.from_rank_name ?? ""}</span>
        </Badge>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="caw-rank-arrow">
          <path d="M4 12h15M14 7l5 5-5 5" />
        </svg>
        <Badge tone="neutral">
          <RankBelt rankId={candidate.testing_for_rank} />
          <span>{candidate.testing_for_rank_name}</span>
        </Badge>
        <Badge tone="info">{candidate.age_band_display}</Badge>
        <Badge
          tone={assessmentTone(assessment?.status)}
          dot
          data-testid="caw-status-pill"
        >
          {assessment?.status_display || "Not started"}
          {assessment?.started_at && ` · started ${formatTime(assessment.started_at)}`}
        </Badge>

        <div className="caw-identity-spacer" />

        {/* Provenance: who prepared the snapshot, and when it was frozen. */}
        {assessment?.generated_by_email && (
          <span className="caw-provenance">
            Form prepared by {assessment.generated_by_email}
            {assessment.generated_at && ` · ${formatDayMonth(assessment.generated_at)}`}
          </span>
        )}
        {currentUser?.can_delete_assessments && assessment && (
          <Button
            variant="danger"
            small
            onClick={() => setDeleteOpen(true)}
            data-testid="caw-delete-assessment-btn"
          >
            Delete assessment
          </Button>
        )}
      </header>

      {actionError && (
        <Alert icon={<WarningIcon size={16} />}>{actionError}</Alert>
      )}

      {isAssessmentMissing && (
        <div className="action-row caw-not-started-banner" data-testid="caw-missing-assessment-banner">
          <div className="caw-not-started-content">
            <h2>Prepare assessment form</h2>
            <p>
              Prepare the candidate&rsquo;s assessment form from the syllabus before starting. It keeps the syllabus as it is today, so later changes to the syllabus never alter it.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => generateAssessmentMutation.mutate()}
            disabled={generateAssessmentMutation.isPending || !canPrepare}
            data-testid="generate-assessment-btn"
          >
            {generateAssessmentMutation.isPending
              ? "Preparing..."
              : !canPrepare
              ? "Session must be draft or open to prepare"
              : "Prepare assessment form"}
          </Button>
        </div>
      )}

      {/* A generated snapshot is started separately once the session is open. */}
      {isAssessmentNotStarted && (
        <div className="action-row caw-not-started-banner" data-testid="caw-not-started-banner">
          <div className="caw-not-started-content">
            <h2>Assessment ready to begin</h2>
            <p>
              Candidates must have their assessment started before individual syllabus items
              can be scored.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => startAssessmentMutation.mutate()}
            disabled={startAssessmentMutation.isPending || session.status !== "OPEN"}
            data-testid="start-assessment-btn"
          >
            {startAssessmentMutation.isPending
              ? "Starting..."
              : session.status !== "OPEN"
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
                <AssessmentItemRow
                  key={item.id}
                  item={item}
                  isEditable={isEditable}
                  isConfirmingClear={confirmingClearId === item.id}
                  isCommentOpen={openCommentId === item.id}
                  onAskClear={() => {
                    setOpenCommentId(null);
                    setConfirmingClearId(item.id);
                  }}
                  onCancelClear={() => setConfirmingClearId(null)}
                  onToggleComment={() => {
                    setConfirmingClearId(null);
                    setOpenCommentId((current) => (current === item.id ? null : item.id));
                  }}
                  onUpdateResult={(result) => {
                    setConfirmingClearId(null);
                    updateItemMutation.mutate({ itemId: item.id, result });
                  }}
                  onAddComment={(body) => addCommentMutation.mutateAsync({ itemId: item.id, body })}
                />
              ))}
            </div>
          ))
        )}

        {categoryGroups.length > 0 && (
          <p className="caw-run-end">
            End of assessment form · {categoryGroups.length}{" "}
            {categoryGroups.length === 1 ? "category" : "categories"}
            {assessment?.generated_at && ` · prepared ${formatDayMonth(assessment.generated_at)}`} from{" "}
            {candidate.age_band_display}
          </p>
        )}
      </div>

      {/* Persistent mat bar: the live count and the only completion action. */}
      <div className="caw-mat-bar" data-testid="caw-mat-bar">
        <div className="caw-mat-count" role="status" aria-live="polite">
          <span className="caw-mat-figure">{`${stats.requiredAssessed} / ${stats.requiredItems}`}</span>
          <span className="caw-mat-figure-label">required assessed</span>
        </div>

        <Meter
          className="caw-mat-meter"
          segments={[
            { percent: metWidth, tone: "success" },
            { percent: notMetWidth, tone: "danger" },
          ]}
        />

        <span className="caw-mat-tally caw-mat-tally-met">
          <CheckIcon size={13} />
          {`${stats.metCount} met`}
        </span>
        <span className="caw-mat-tally caw-mat-tally-not-met">
          <CrossIcon size={13} />
          {`${stats.notMetCount} not met`}
        </span>
        <span className="caw-mat-tally caw-mat-tally-remaining">
          {`${stats.remainingRequired} remaining`}
        </span>

        <div className="caw-identity-spacer" />

        {isAssessmentCompleted ? (
          <Link className={buttonClass({ variant: "secondary" })} to={reviewPath} data-testid="caw-view-review-btn">
            View completion record →
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
            {isSavingItems
              ? "Saving..."
              : stats.canComplete
              ? "Complete assessment →"
              : `Complete assessment (${stats.remainingRequired} required remaining)`}
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
