import type { CandidateAssessmentItem } from "./api";
import type { CategoryGroup } from "./candidateAssessmentData";
import { CheckIcon, CrossIcon } from "./Icons";
import { RequirementBadge } from "./StatusBadge";

export function SealIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** The mark shown against a requirement or core area on the proof. */
export function ResultMark({ result }: { result: CandidateAssessmentItem["result"] }) {
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

/** Core areas carry a mark rather than a full ledger row. */
export function CoreAreaMark({ group }: { group: CategoryGroup }) {
  if (group.notMetCount > 0) {
    return (
      <span className="mark mark--small mark--danger" aria-hidden="true">
        <CrossIcon size={13} />
      </span>
    );
  }
  if (group.notAssessedCount > 0) {
    return (
      <span className="mark mark--small mark--neutral" aria-hidden="true">
        –
      </span>
    );
  }
  return (
    <span className="mark mark--small mark--success" aria-hidden="true">
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
                {!item.required && <RequirementBadge required={false} />}
              </td>
              {hasAnyRange && (
                <td className="acp-ledger-range">{item.display_range || item.notation}</td>
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
