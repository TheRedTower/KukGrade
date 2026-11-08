import { useQuery } from "@tanstack/react-query";
import { type DataImportBatch, getDataImportRows } from "./api";
import { counted } from "./importSteps";
import { Button } from "./Button";
import type { RowFilter } from "./ImportRowsLedger";

/** How many of a roster's added rows match a filter, for the second look. */
function useAddedCount(batch: DataImportBatch, filter: "corrected" | "status" | "current_rank") {
  return useQuery({
    queryKey: ["imports", "rows", batch.id, "addedCount", filter],
    queryFn: () =>
      getDataImportRows(batch.id, {
        outcome: "READY",
        ...(filter === "corrected" ? { corrected: true } : { filled: filter }),
        page_size: 1,
      }),
  }).data?.count;
}

/** Students: what KukGrade filled in, for a second look. */
export function SecondLook({ batch, onShow }: { batch: DataImportBatch; onShow: (filter: RowFilter) => void }) {
  const fixed = useAddedCount(batch, "corrected") ?? 0;
  const givenStatus = useAddedCount(batch, "status") ?? 0;
  const givenRank = useAddedCount(batch, "current_rank") ?? 0;
  const items: { title: string; body: string; show?: RowFilter; count?: number }[] = [];
  if (givenStatus) {
    const status = batch.defaults.status ?? "ACTIVE";
    items.push({
      title: `${counted(givenStatus, "student", "students")} given the status ${status.charAt(0)}${status.slice(1).toLowerCase()}`,
      body: batch.defaults.status
        ? "The file gave them no status, so the status you set for the whole file was used."
        : "The file gave them no status, so KukGrade used Active.",
      show: "status",
      count: givenStatus,
    });
  }
  if (givenRank && batch.defaults.current_rank) {
    items.push({
      title: `${counted(givenRank, "student", "students")} given the rank ${batch.defaults.current_rank}`,
      body: "The file gave them no rank, so the rank you set for the whole file was used.",
      show: "current_rank",
      count: givenRank,
    });
  }
  if (fixed) {
    items.push({
      title: counted(fixed, "student with your fixes", "students with your fixes"),
      body: "Values you typed in or corrected before importing.",
      show: "corrected",
      count: fixed,
    });
  }
  if (batch.extra_columns.length) {
    items.push({
      title: `${batch.extra_columns.map((column) => `“${column}”`).join(", ")} kept`,
      body: "Shown under Extra information on each student’s page.",
    });
  }

  return (
    <section aria-labelledby="ix-look-h" className="card card--flush ix-gold-edge">
      <div className="ix-row">
        <div className="ix-row-main">
          <p className="ix-eyebrow eyebrow">Worth a second look</p>
          <h2 className="ix-title" id="ix-look-h">
            What KukGrade filled in for you
          </h2>
          <p className="subtext">
            Everything was imported. These are the details that did not all come straight from
            the file.
          </p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="ix-row ix-success-text">Every detail came straight from the file.</p>
      ) : (
        items.map((item) => (
          <div className="ix-row" key={item.title}>
            <div className="ix-row-main">
              <p className="item-title">{item.title}</p>
              <p className="subtext">{item.body}</p>
            </div>
            {item.show ? (
              <Button variant="secondary" onClick={() => onShow(item.show!)}>
                See the {item.count}
              </Button>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}
