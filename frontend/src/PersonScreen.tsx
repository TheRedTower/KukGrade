import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  type HistoricalPersonDetail,
  errorMessage,
  getHistoricalPeople,
  leavePersonForLater,
  linkHistoricalPerson,
  markNotAStudent,
  reopenHistoricalPerson,
} from "./api";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { useChoices } from "./choices";
import { ChoiceGroup } from "./ChoiceGroup";
import { ConfirmDialog } from "./ConfirmDialog";
import { DetailPage } from "./DetailPage";
import { ErrorText } from "./ErrorText";
import { recordMonth } from "./linkRecords";
import { PEOPLE_PAGE_SIZE, usePeopleContext, whoTheyMayBe } from "./peopleLists";
import { counted } from "./plural";
import { Progress } from "./Progress";
import { keys } from "./queryKeys";
import { RecordPage } from "./RecordPage";
import { recordStatus, useIdParam } from "./recordStatus";
import { useDecision, usePeopleSummary, usePerson } from "./usePerson";

type Person = HistoricalPersonDetail;
type PersonRecord = Person["records"][number];

/** A record as the workbook has it: the month, the ranks, the outcome. */
function recordLine(record: PersonRecord): string {
  const held = record.current_rank_name ?? record.source_current_rank_text;
  const tested = record.testing_for_rank_name ?? record.source_testing_for_rank_text;
  return [
    recordMonth(record),
    [held, tested].filter(Boolean).join(" → "),
    record.outcome_display || record.attendance_status_display || record.record_kind_display,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Their gradings in date order, each with the first line of what was written about it. */
function PersonRecords({ person }: { person: Person }) {
  return (
    <section aria-labelledby="pp-records" className="card stack stack--3">
      <h2 className="section-title" id="pp-records">
        Their gradings ({person.record_count})
      </h2>
      <ol className="list-plain stack stack--2">
        {person.records.map((record) => (
          <li className="stack stack--1" key={record.id}>
            <span className="item-title">{recordLine(record)}</span>
            <span className="subtext">
              Written “{record.source_name}”{record.report ? ` · ${record.report.split("\n")[0]}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * One person from the imported history on a page of their own: how they are
 * written, their gradings in date order, and who they may be, with the
 * reasons. The decisions open are the ones the server names; Next goes on
 * through the list the person was opened from.
 */
export function PersonScreen() {
  const id = useIdParam();
  const navigate = useNavigate();
  const context = usePeopleContext();
  const person = usePerson(id);
  const summary = usePeopleSummary(context.batch);
  const list = context.list;
  const { batch, search, page } = context;
  // The list as it was opened (its page and search), the same query the
  // list itself reads, then the page after it when this person ends it.
  const pageOf = (at: number) => ({
    queryKey: keys.legacyPeople.list(list?.value, batch, search, at),
    queryFn: () =>
      getHistoricalPeople({
        ...list!.query,
        batch,
        search: search || undefined,
        page: at,
        page_size: PEOPLE_PAGE_SIZE,
      }),
  });
  const neighbours = useQuery({ ...pageOf(page), enabled: list !== null });
  const ids = (neighbours.data?.results ?? []).map((other) => other.id);
  const at = ids.indexOf(id ?? 0);
  const following = useQuery({
    ...pageOf(page + 1),
    enabled: list !== null && Boolean(neighbours.data?.next) && (at === -1 ? ids.length === 0 : at === ids.length - 1),
  });
  const [asking, setAsking] = useState(false);
  const decide = useDecision<unknown>();

  const status = recordStatus(id, person);
  if (status || !person.data) {
    return (
      <RecordPage
        back={{ to: context.path({}), label: "People" }}
        error={person.error}
        failed="This person could not be loaded."
        label="Person"
        loading="Loading the person…"
        missing="Person not found"
        status={status ?? "loading"}
        onRetry={() => void person.refetch()}
      />
    );
  }

  const shown = person.data;
  const open = new Set(shown.decisions);
  const [best] = shown.candidates;
  const clear = shown.suggestion === "clear" && best !== undefined;
  // Next: the one after this person on the page; past the page's end, the
  // first of the page after; once this person has left the list (decided),
  // whoever now stands first.
  const onPage = at >= 0 ? ids[at + 1] : ids.find((other) => other !== shown.id);
  const fromNext = following.data?.results[0]?.id;
  const next: { person: number; page: number } | null =
    onPage !== undefined
      ? { person: onPage, page }
      : fromNext !== undefined
        ? { person: fromNext, page: page + 1 }
        : null;
  const version = shown.version;
  const counts = summary.data;

  function confirmJoined() {
    if (shown.state === "LINKED" && shown.student !== null) {
      const student = shown.student;
      decide.mutate(() => linkHistoricalPerson(shown.id, { student, version }));
    } else if (shown.state === "NOT_A_STUDENT" && shown.not_a_student_reason) {
      const reason = shown.not_a_student_reason;
      decide.mutate(() => markNotAStudent(shown.id, { reason, note: shown.note, version }));
    } else {
      decide.mutate(() => leavePersonForLater(shown.id, version));
    }
  }

  const primary = open.has("CONFIRM_JOINED") ? (
    <Button variant="primary" disabled={decide.isPending} onClick={confirmJoined}>
      Confirm the {counted(shown.awaiting_confirmation, "new record", "new records")}
    </Button>
  ) : open.has("LINK") && clear ? (
    <Button
      variant="primary"
      disabled={decide.isPending}
      onClick={() => decide.mutate(() => linkHistoricalPerson(shown.id, { student: best.student, version }))}
    >
      This is {best.full_name}
    </Button>
  ) : open.has("LINK") ? (
    <Link className={buttonClass({ variant: "primary" })} to={context.path({ person: shown.id, to: "student" })}>
      Find the student
    </Link>
  ) : null;

  return (
    <DetailPage
      actions={
        <>
          {next !== null ? (
            <Button variant={primary ? "secondary" : "primary"} onClick={() => navigate(context.path(next))}>
              Next
            </Button>
          ) : (
            <Link className={buttonClass({ variant: primary ? "secondary" : "primary" })} to={context.path({})}>
              Back to the list
            </Link>
          )}
          {primary}
        </>
      }
      back={{ to: context.path({}), label: list?.label ?? "People" }}
      eyebrow="Past gradings · Sort the people"
      progress={counts ? <Progress done={counts.sorted} total={counts.people} what="people sorted" /> : null}
      status={<p className="subtext">{whoTheyMayBe(shown)}</p>}
      testId="pp-person"
      title={shown.name}
    >
      {decide.isError ? (
        <ErrorText>{errorMessage(decide.error, "That could not be saved. Try again in a moment.")}</ErrorText>
      ) : null}
      <WhoTheyMayBe
        busy={decide.isPending}
        context={context}
        person={shown}
        onLink={(student) => decide.mutate(() => linkHistoricalPerson(shown.id, { student, version }))}
      />
      <section aria-labelledby="pp-other" className="card stack stack--3">
        <h2 className="section-title" id="pp-other">
          Something else
        </h2>
        <div className="row row--wrap">
          {open.has("NOT_A_STUDENT") ? (
            <Button variant="secondary" disabled={decide.isPending} onClick={() => setAsking(true)}>
              Not a current student
            </Button>
          ) : null}
          {open.has("LATER") ? (
            <Button
              variant="secondary"
              disabled={decide.isPending}
              onClick={() => decide.mutate(() => leavePersonForLater(shown.id, version))}
            >
              Leave for later
            </Button>
          ) : null}
          {open.has("REOPEN") ? (
            <Button
              variant="secondary"
              disabled={decide.isPending}
              onClick={() => decide.mutate(() => reopenHistoricalPerson(shown.id, version))}
            >
              Undo the decision
            </Button>
          ) : null}
          <Link className={buttonClass({ variant: "ghost" })} to={context.path({ person: shown.id, to: "split" })}>
            Split or merge
          </Link>
        </div>
      </section>
      <section aria-labelledby="pp-written" className="card stack stack--3">
        <h2 className="section-title" id="pp-written">
          Written as
        </h2>
        <ul aria-label="Spellings" className="list-plain row row--wrap">
          {shown.spellings.map((spelling) => (
            <li key={spelling}>
              <Badge tone="neutral">{spelling}</Badge>
            </li>
          ))}
        </ul>
        <p className="item-title">{shown.confidence_display}</p>
        {shown.reasons.length ? (
          <ul className="list-plain stack stack--1">
            {shown.reasons.map((reason) => (
              <li className="subtext" key={reason}>
                {reason}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <PersonRecords person={shown} />
      {asking ? (
        <NotAStudentDialog
          person={shown}
          onClose={() => setAsking(false)}
          onMark={(reason, note) =>
            decide.mutateAsync(() => markNotAStudent(shown.id, { reason, note, version })).then(() => setAsking(false))
          }
        />
      ) : null}
    </DetailPage>
  );
}

/** Who the person is, as decided, or who they may be, with the reasons each fits. */
function WhoTheyMayBe({
  person,
  busy,
  context,
  onLink,
}: {
  person: Person;
  busy: boolean;
  context: ReturnType<typeof usePeopleContext>;
  onLink: (student: number) => void;
}) {
  const decided = person.state !== "PROPOSED";
  const choosing = person.decisions.includes("LINK");
  const clear = person.suggestion === "clear";
  return (
    <section aria-labelledby="pp-who" className="card stack stack--3">
      <h2 className="section-title" id="pp-who">
        {decided ? "Decided" : "Who they may be"}
      </h2>
      {decided ? (
        <p className="item-title">
          {whoTheyMayBe(person)}
          {person.note ? ` · ${person.note}` : ""}
        </p>
      ) : null}
      {decided && person.decided_by_name ? <p className="subtext">By {person.decided_by_name}</p> : null}
      {person.awaiting_confirmation ? (
        <p className="subtext">
          {counted(person.awaiting_confirmation, "record has", "records have")} joined since, waiting to be confirmed.
        </p>
      ) : null}
      {choosing ? (
        person.candidates.length ? (
          <ul aria-label="Students they may be" className="list-plain stack stack--3">
            {person.candidates.map((candidate, index) => (
              <li className="stack stack--1" key={candidate.student}>
                <span className="item-title">
                  {index === 0 && clear ? "Suggested: " : ""}
                  {candidate.full_name}
                </span>
                <span className="subtext">
                  {[`${candidate.current_rank_name} now`, candidate.status_display, candidate.wksa_id].join(" · ")}
                </span>
                {candidate.reasons.length ? <span className="subtext">{candidate.reasons.join(" · ")}</span> : null}
                {index === 0 && clear ? null : (
                  <div>
                    <Button
                      aria-label={`This is ${candidate.full_name}`}
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onLink(candidate.student)}
                    >
                      This is them
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtext">No student in KukGrade looks like them.</p>
        )
      ) : null}
      {choosing && person.candidates.length ? (
        <div>
          <Link className={buttonClass({ variant: "ghost" })} to={context.path({ person: person.id, to: "student" })}>
            Someone else
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** Why the person is not a current student, with a note where the reason needs one. */
function NotAStudentDialog({
  person,
  onMark,
  onClose,
}: {
  person: Person;
  onMark: (reason: Exclude<Person["not_a_student_reason"], "">, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const reasons = useChoices().not_a_student_reasons;
  const [reason, setReason] = useState<(typeof reasons)[number]["value"] | "">("");
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const needsNote = reasons.find((choice) => choice.value === reason)?.note_required ?? false;
  return (
    <ConfirmDialog
      confirmDisabled={!reason || (needsNote && !note.trim())}
      confirmLabel="Mark not a student"
      error={failed}
      pending={pending}
      pendingLabel="Saving…"
      title={`Why is ${person.name} not a current student?`}
      onClose={onClose}
      onConfirm={() => {
        if (!reason) return;
        setPending(true);
        setFailed(null);
        onMark(reason, note.trim())
          .catch((error: unknown) => setFailed(errorMessage(error, "That could not be saved.")))
          .finally(() => setPending(false));
      }}
    >
      <p className="subtext">Their records stay unlinked. This can be undone.</p>
      <ChoiceGroup
        choices={reasons.map((choice) => ({ value: choice.value, label: choice.label }))}
        label="Reason"
        look="options"
        value={reason}
        onChange={setReason}
      />
      <div className="field field--sentence">
        <label htmlFor="pp-not-a-student-note">{needsNote ? "Say why" : "A note, if you want one"}</label>
        <textarea id="pp-not-a-student-note" value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
    </ConfirmDialog>
  );
}
