import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { errorMessage, getPersonStudents, linkHistoricalPerson } from "./api";
import { DetailPage } from "./DetailPage";
import { ErrorText } from "./ErrorText";
import { LoadingState } from "./LoadingState";
import { usePeopleContext } from "./peopleLists";
import { keys } from "./queryKeys";
import { RecordPage } from "./RecordPage";
import { recordStatus, useIdParam } from "./recordStatus";
import { SearchField } from "./SearchField";
import { useDebouncedValue } from "./useDebouncedValue";
import { useDecision, usePerson } from "./usePerson";
import "./Imports.css";

/**
 * Any student, found by name or WKSA ID, for a person no suggestion fits:
 * each with their rank now and age band, and flagged when that rank is below
 * the rank the person's records gave then (the server says which). Choosing
 * one links the person and goes back to their page.
 */
export function PersonStudentScreen() {
  const id = useIdParam();
  const navigate = useNavigate();
  const context = usePeopleContext();
  const person = usePerson(id);
  const [search, setSearch] = useState("");
  const searched = useDebouncedValue(search.trim());
  const found = useQuery({
    queryKey: keys.legacyPeople.students(id ?? 0, searched),
    queryFn: () => getPersonStudents(id!, { search: searched, page_size: 10 }),
    enabled: id !== null && searched.length >= 2,
  });
  const link = useDecision<unknown>(() => navigate(context.path({ person: id ?? undefined })));

  const status = recordStatus(id, person);
  if (status || !person.data) {
    return (
      <RecordPage
        back={{ to: context.path({}), label: "People" }}
        error={person.error}
        failed="This person could not be loaded."
        label="Choose the student"
        missing="Person not found"
        status={status ?? "loading"}
        onRetry={() => void person.refetch()}
      />
    );
  }
  const shown = person.data;
  const students = found.data?.results ?? [];

  return (
    <DetailPage
      back={{ to: context.path({ person: shown.id }), label: shown.name }}
      eyebrow="Past gradings · Sort the people"
      testId="pp-student"
      title={`Who is ${shown.name}?`}
    >
      <section aria-labelledby="pp-student-search" className="card stack stack--3">
        <h2 className="section-title" id="pp-student-search">
          Find the student
        </h2>
        <SearchField label="A name or WKSA ID" value={search} onChange={setSearch} />
        {found.isFetching && !found.data ? <LoadingState compact>Looking…</LoadingState> : null}
        {found.isError ? <ErrorText>{errorMessage(found.error, "No student could be looked for.")}</ErrorText> : null}
        {searched.length >= 2 && found.isSuccess && students.length === 0 ? (
          <p className="subtext">No student matches “{searched}”.</p>
        ) : null}
        <ul aria-label="Students found" className="list-plain stack stack--2">
          {students.map((student) => {
            return (
              <li key={student.id}>
                <button
                  className="queue-list__item"
                  disabled={link.isPending}
                  type="button"
                  onClick={() =>
                    link.mutate(() => linkHistoricalPerson(shown.id, { student: student.id, version: shown.version }))
                  }
                >
                  <span className="queue-list__text">
                    <span className="item-title">{student.full_name}</span>
                    <span className="subtext">
                      {[
                        `${student.current_rank_name} now`,
                        student.age_band_display,
                        student.status_display,
                        student.wksa_id,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {student.rank_fits === false ? (
                      <span className="subtext ix-warning-text">{student.rank_reason}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {link.isError ? <ErrorText>{errorMessage(link.error, "They could not be linked.")}</ErrorText> : null}
      </section>
    </DetailPage>
  );
}
