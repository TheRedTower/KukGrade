import type { DataImportBatch } from "./api";
import { importKinds } from "./importKinds";
import { CheckIcon, ExclamationIcon } from "./Icons";
import { fileSize, suffixOf } from "./importFiles";

/** What KukGrade found in an uploaded file, a line for each thing, with a mark for whether it is as hoped. */
export function FoundChecklist({
  batch,
  importedBefore,
  limit,
}: {
  batch: DataImportBatch;
  /** This exact file has been imported before. */
  importedBefore: boolean;
  /** The size limit, in words, when known. */
  limit?: string;
}) {
  const kind = importKinds[batch.kind];
  const items: { ok: boolean; title: string; detail: string }[] = [
    {
      ok: true,
      title:
        suffixOf(batch.original_filename) === "csv"
          ? "A CSV file KukGrade can read"
          : "An Excel workbook KukGrade can read",
      detail: `${fileSize(batch.file_size)}${limit ? `, under the ${limit} limit` : ""}.`,
    },
    ...kind.found(batch),
  ];
  if (importedBefore) {
    items.push({ ok: false, title: "This exact file has been imported before", detail: kind.alreadyImported });
  }

  return (
    <div>
      <h3 className="ix-h3">What KukGrade found</h3>
      <ul className="list-plain ix-checklist">
        {items.map((item) => (
          <li key={item.title}>
            <span aria-hidden="true" className="mark" data-tone={item.ok ? "success" : "warning"}>
              {item.ok ? <CheckIcon /> : <ExclamationIcon />}
            </span>
            <span>
              <p className="item-title">{item.title}</p>
              <p className="subtext">{item.detail}</p>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
