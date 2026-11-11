import type { CandidateAssessmentItem } from "./api";
import type { CategoryGroup } from "./candidateAssessmentData";
import { CheckIcon, CrossIcon } from "./Icons";
import { RequirementBadge } from "./StatusBadge";


/** The mark shown against a requirement or core area on the proof. */
export function ResultMark({ result }: { result: CandidateAssessmentItem["result"] }) {
  if (result === "MET") {
    return (
      <span className="meta row row--inline row--1 acp-result-met">
        <CheckIcon size={13} />
        Met
      </span>
    );
  }
  if (result === "NOT_MET") {
    return (
      <span className="meta row row--inline row--1 acp-result-not-met">
        <CrossIcon size={13} />
        Not met
      </span>
    );
  }
  return <span className="meta row row--inline row--1 acp-result-none">Not assessed</span>;
}

/** Core areas carry a mark rather than a full ledger row. */
export function CoreAreaMark({ group }: { group: CategoryGroup }) {
  if (group.notMetCount > 0) {
    return (
      <span className="mark mark--small" data-tone="danger" aria-hidden="true">
        <CrossIcon size={13} />
      </span>
    );
  }
  if (group.notAssessedCount > 0) {
    return (
      <span className="mark mark--small" data-tone="neutral" aria-hidden="true">
        –
      </span>
    );
  }
  return (
    <span className="mark mark--small" data-tone="success" aria-hidden="true">
      <CheckIcon size={13} />
    </span>
  );
}

/**
 * One rank-specific ledger, headed by the category's own served display name.
 * `display_range` is the syllabus numbering the paper chart carries, which the
 * old review screen never showed; `notation` is a form's part ("Part 1 of 2"),
 * shown in the same column as the scoring and syllabus screens show it.
 */
export function LedgerTable({ group }: { group: CategoryGroup }) {
  const hasAnyRange = group.items.some((item) => item.display_range || item.notation);

  return (
    <>
      <h2 className="acp-section eyebrow--muted">{group.categoryDisplay}</h2>
      <table className="acp-ledger" data-testid={`acp-ledger-${group.category}`}>
        <thead>
          <tr className="eyebrow--muted">
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
                {item.korean_name && <span className="acp-ledger-korean" lang="ko"> {item.korean_name}</span>}
                {!item.required && <RequirementBadge required={false} />}
              </td>
              {hasAnyRange && (
                <td className="acp-ledger-range meta">{item.display_range || item.notation}</td>
              )}
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
