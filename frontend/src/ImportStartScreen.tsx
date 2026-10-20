import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  ApiError,
  type CreateDataImportBatchResponse,
  type DataImportBatch,
  type DataImportKind,
  cancelDataImportBatch,
  chooseDataImportSheet,
  createDataImportBatch,
  errorMessage,
  getDataImportBatch,
} from "./api";
import { ImportStepBar } from "./ImportStepBar";
import { importKindTitle } from "./importSteps";
import { downloadStandardTemplate } from "./importTemplate";
import "./Imports.css";

// The server's own upload limit (IMPORT_UPLOAD_MAX_BYTES), checked here only
// to save uploading a file the server would refuse; the server still decides.
const MAX_BYTES = 5 * 1024 * 1024;

type Guide = { lead: string; fields: { name: string; hint: string; needed: boolean }[]; foot: string };

const GUIDES: Record<DataImportKind, Guide> = {
  STUDENT_ROSTER: {
    lead:
      "One student per row, with a heading on each column. The headings do not need to match: you pair them up next.",
    fields: [
      { name: "WKSA ID", hint: "Such as 123-4-567, or A-12345 for a black belt", needed: true },
      { name: "First name", hint: "", needed: true },
      { name: "Last name", hint: "", needed: true },
      { name: "Date of birth", hint: "Such as 14/03/2015", needed: true },
      { name: "Rank", hint: "Can be set once for the whole file", needed: true },
      { name: "Status", hint: "Active, Inactive or Left. Active if not given", needed: false },
    ],
    foot:
      "Anything missing can be typed in before importing, and any other column can be kept as extra information on the student.",
  },
  LEGACY_GRADINGS: {
    lead:
      "The grading record workbook, one sheet per grading. In Google Sheets, use File, Download, Microsoft Excel.",
    fields: [
      { name: "Name", hint: "As written in the sheet, often a first name only", needed: true },
      { name: "Outcome", hint: "Pass, Fail, Conditional or Did not attend", needed: false },
      { name: "Rank held", hint: "Such as Yellow Belt or DBN", needed: false },
      { name: "Rank tested for", hint: "A “?” is kept as doubtful", needed: false },
      { name: "Comments", hint: "Kept in full as the grading report", needed: false },
    ],
    foot: "Side tables such as Did not attend, and notes anywhere on a sheet, are kept too.",
  },
};

function parseKind(value: string | null): DataImportKind {
  return value === "LEGACY_GRADINGS" ? "LEGACY_GRADINGS" : "STUDENT_ROSTER";
}

function allowedSuffixes(kind: DataImportKind): string[] {
  return kind === "STUDENT_ROSTER" ? ["xlsx", "csv"] : ["xlsx"];
}

function suffixOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Why the browser can refuse a file before sending it, or null. */
function clientRefusal(file: File, kind: DataImportKind): string | null {
  if (!allowedSuffixes(kind).includes(suffixOf(file.name))) {
    return kind === "STUDENT_ROSTER"
      ? "Choose an Excel (.xlsx) or CSV (.csv) file."
      : "Choose the workbook as an Excel (.xlsx) file.";
  }
  if (file.size > MAX_BYTES) return "The file is larger than 5 MB.";
  return null;
}

function uploadFailure(error: unknown): string {
  if (error instanceof ApiError) {
    const fileMessage = error.messagesFor("file")[0];
    if (fileMessage) return fileMessage;
  }
  return errorMessage(error, "The file could not be read. Try again in a moment.");
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="40" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="40">
      <path d="M12 15V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M3 15v3a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3" />
    </svg>
  );
}

function GuideList({ kind }: { kind: DataImportKind }) {
  const guide = GUIDES[kind];
  return (
    <>
      <p className="ix-muted ix-small">{guide.lead}</p>
      <ul className="ix-guide-list">
        {guide.fields.map((field) => (
          <li key={field.name}>
            <span>
              <p style={{ fontWeight: 600 }}>{field.name}</p>
              {field.hint ? <p className="ix-muted ix-small">{field.hint}</p> : null}
            </span>
            <span className={`ix-tag${field.needed ? "" : " ix-muted"}`}>
              {field.needed ? "Needed" : kind === "STUDENT_ROSTER" ? "Optional" : "If present"}
            </span>
          </li>
        ))}
      </ul>
      <p className="ix-small" style={{ margin: 0 }}>
        {guide.foot}
      </p>
    </>
  );
}

function FoundChecklist({
  batch,
  created,
  kind,
}: {
  batch: DataImportBatch;
  created: CreateDataImportBatchResponse;
  kind: DataImportKind;
}) {
  const items: { ok: boolean; title: string; detail: string }[] = [
    {
      ok: true,
      title:
        suffixOf(batch.original_filename) === "csv"
          ? "A CSV file KukGrade can read"
          : "An Excel workbook KukGrade can read",
      detail: `${fileSize(batch.file_size)}, under the 5 MB limit.`,
    },
  ];
  if (kind === "STUDENT_ROSTER") {
    items.push(
      {
        ok: batch.row_counts.total > 0,
        title: counted(batch.row_counts.total, "row of students", "rows of students"),
        detail: batch.sheet
          ? `Read from the sheet “${batch.sheet}”. Blank rows are left out.`
          : "Blank rows are left out.",
      },
      {
        ok: true,
        title: counted(batch.detected_headers.length, "column", "columns"),
        detail: "You match them to KukGrade in the next step.",
      },
    );
  } else {
    items.push(
      {
        ok: batch.grading_sheets.length > 0,
        title: counted(batch.grading_sheets.length, "grading sheet", "grading sheets"),
        detail: batch.grading_sheets.length
          ? `Each sheet holds one grading: ${batch.grading_sheets.join(", ")}.`
          : "No sheet named for a grading was found.",
      },
      {
        ok: batch.row_counts.total > 0,
        title: counted(batch.row_counts.total, "record", "records"),
        detail: "Including side tables such as Did not attend, and sheet notes.",
      },
    );
    for (const warning of batch.warnings) {
      items.push({ ok: false, title: "Something was left out", detail: warning });
    }
  }
  if (created.already_imported_warning) {
    items.push({
      ok: false,
      title: "This exact file has been imported before",
      detail:
        kind === "STUDENT_ROSTER"
          ? "Anyone already in KukGrade is skipped, so nobody is added twice."
          : "Its records would be imported a second time. Check before you go on.",
    });
  }

  return (
    <div>
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>What KukGrade found</h3>
      <ul className="ix-checklist">
        {items.map((item) => (
          <li key={item.title}>
            <span aria-hidden="true" className={`ix-mark ${item.ok ? "ix-mark-ok" : "ix-mark-warn"}`}>
              {item.ok ? "✓" : "!"}
            </span>
            <span>
              <p style={{ fontWeight: 600 }}>{item.title}</p>
              <p className="ix-muted ix-small">{item.detail}</p>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Step 1 of an import: choose the file, see what KukGrade found (FDR-050). */
export function ImportStartScreen() {
  const [searchParams] = useSearchParams();
  const kind = parseKind(searchParams.get("kind"));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [created, setCreated] = useState<CreateDataImportBatchResponse | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const upload = useMutation({
    mutationFn: (file: File) => createDataImportBatch(file, kind),
    onSuccess: (response) => {
      setCreated(response);
      void queryClient.invalidateQueries({ queryKey: ["imports"] });
    },
  });
  const batchId = created?.id;
  const batch = useQuery({
    queryKey: ["imports", "batch", batchId],
    queryFn: () => getDataImportBatch(batchId!),
    enabled: batchId !== undefined,
  });
  const sheet = useMutation({
    mutationFn: (name: string) => chooseDataImportSheet(batchId!, name),
    onSuccess: (updated) => queryClient.setQueryData(["imports", "batch", batchId], updated),
  });
  const discard = useMutation({
    mutationFn: (id: number) => cancelDataImportBatch(id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["imports"] }),
  });

  function take(file: File | undefined) {
    if (!file || upload.isPending) return;
    const reason = clientRefusal(file, kind);
    setRefusal(reason);
    upload.reset();
    if (!reason) upload.mutate(file);
  }

  function onPicked(event: ChangeEvent<HTMLInputElement>) {
    take(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files?.[0]);
  }

  async function chooseAnother() {
    if (batchId !== undefined) await discard.mutateAsync(batchId).catch(() => undefined);
    setCreated(null);
    setGuideOpen(false);
    upload.reset();
  }

  async function cancelImport() {
    if (batchId !== undefined) await discard.mutateAsync(batchId).catch(() => undefined);
    navigate("/imports");
  }

  const loaded = created && batch.data ? batch.data : null;
  const fileError =
    refusal ??
    (upload.isError
      ? uploadFailure(upload.error)
      : batch.isError
        ? errorMessage(batch.error, "The file was read, but could not be shown. Try again in a moment.")
        : null);
  const accept = kind === "STUDENT_ROSTER" ? ".xlsx,.csv" : ".xlsx";
  const nextName = kind === "STUDENT_ROSTER" ? "Continue to match columns" : "Continue to match ranks";

  return (
    <section aria-labelledby="ix-start-title" className={`ix-page${loaded ? " ix-page-narrow" : ""}`}>
      <div>
        <Link className="ix-back" to="/imports">
          ‹ Imports
        </Link>
        <h1 id="ix-start-title" style={{ margin: "0.25rem 0 0" }}>
          {importKindTitle(kind)}
        </h1>
      </div>

      <ImportStepBar current={0} kind={kind} />

      {loaded && created ? (
        <section aria-labelledby="ix-your-file" className="ix-card ix-card-pad ix-section" style={{ gap: "1.25rem" }}>
          <h2 id="ix-your-file" style={{ margin: 0, fontSize: "1.375rem" }} tabIndex={-1}>
            Your file
          </h2>
          <div className="ix-file">
            <div className="ix-row-main" style={{ flexBasis: "14rem" }}>
              <p className="ix-strong">{loaded.original_filename}</p>
              <p className="ix-muted ix-small">{fileSize(loaded.file_size)}</p>
            </div>
            <button className="btn-ghost" disabled={discard.isPending} type="button" onClick={chooseAnother}>
              Choose a different file
            </button>
          </div>
          <FoundChecklist batch={loaded} created={created} kind={kind} />
          {kind === "STUDENT_ROSTER" && loaded.sheet_names.length > 1 ? (
            <label className="ix-field" style={{ maxWidth: "22rem" }}>
              Sheet to read
              <select
                disabled={sheet.isPending}
                value={loaded.sheet}
                onChange={(event) => sheet.mutate(event.target.value)}
              >
                {loaded.sheet_names.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <span className="ix-small" style={{ fontWeight: 400 }}>
                {sheet.isPending
                  ? "Reading that sheet…"
                  : `The workbook has ${loaded.sheet_names.length} sheets. KukGrade picked the one it opens on.`}
              </span>
            </label>
          ) : null}
          {sheet.isError ? (
            <p className="ix-danger-text" role="alert">
              {errorMessage(sheet.error, "That sheet could not be read.")}
            </p>
          ) : null}
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "0.25rem" }}>
            <button
              aria-controls="ix-guide"
              aria-expanded={guideOpen}
              className="ix-disclosure"
              type="button"
              onClick={() => setGuideOpen((open) => !open)}
            >
              <ChevronIcon />
              What KukGrade looks for
            </button>
            {guideOpen ? (
              <div className="ix-section" id="ix-guide" style={{ paddingTop: "0.5rem" }}>
                <GuideList kind={kind} />
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <div className="ix-split">
          <section aria-labelledby="ix-choose" className="ix-card ix-card-pad ix-section" style={{ gap: "1.25rem" }}>
            <div>
              <h2 id="ix-choose" style={{ margin: "0 0 0.25rem", fontSize: "1.375rem" }}>
                Choose your file
              </h2>
              <p className="ix-muted">
                {kind === "STUDENT_ROSTER"
                  ? "A spreadsheet of students, one per row. Nothing is saved until the last step."
                  : "The grading record workbook, downloaded from Google Sheets as Excel. Nothing is saved until the last step."}
              </p>
            </div>
            <div
              className={`ix-drop${dragging ? " ix-drop-active" : ""}`}
              onDragLeave={() => setDragging(false)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDrop={onDrop}
            >
              <span className="ix-muted">
                <UploadIcon />
              </span>
              <p style={{ fontSize: "1.05rem", fontWeight: 700 }}>Drag your file here</p>
              <p className="ix-muted ix-small">or</p>
              <input
                ref={inputRef}
                accept={accept}
                aria-label="Choose a file"
                className="ix-visually-hidden"
                tabIndex={-1}
                type="file"
                onChange={onPicked}
              />
              <button
                className="btn-primary"
                disabled={upload.isPending || (created !== null && batch.isPending)}
                type="button"
                onClick={() => inputRef.current?.click()}
              >
                {upload.isPending || (created !== null && batch.isPending) ? "Reading your file…" : "Choose a file"}
              </button>
              <p className="ix-muted ix-small">
                {kind === "STUDENT_ROSTER"
                  ? "Excel (.xlsx) or CSV, up to 5 MB and 1,000 rows"
                  : "Excel (.xlsx), up to 5 MB"}
              </p>
            </div>
            {fileError ? (
              <p className="ix-danger-text" role="alert" style={{ margin: 0 }}>
                {fileError}
              </p>
            ) : null}
          </section>
          <aside aria-labelledby="ix-looks-for" className="ix-card ix-card-pad ix-sunken ix-section">
            <h2 id="ix-looks-for" style={{ margin: 0, fontSize: "1.125rem" }}>
              What KukGrade looks for
            </h2>
            <GuideList kind={kind} />
            {kind === "STUDENT_ROSTER" ? (
              <button className="btn-secondary" style={{ alignSelf: "flex-start" }} type="button" onClick={downloadStandardTemplate}>
                Download the template
              </button>
            ) : null}
          </aside>
        </div>
      )}

      <div className="ix-actions ix-actions-split">
        <button className="btn-ghost" disabled={discard.isPending} type="button" onClick={cancelImport}>
          Cancel import
        </button>
        <div className="ix-actions">
          {!loaded ? (
            <span className="ix-muted ix-small" id="ix-continue-why">
              Choose a file first.
            </span>
          ) : null}
          <button
            aria-describedby={loaded ? undefined : "ix-continue-why"}
            className="btn-primary"
            disabled={!loaded || sheet.isPending}
            type="button"
            onClick={() => navigate(`/imports/${batchId}`)}
          >
            {nextName}
          </button>
        </div>
      </div>
    </section>
  );
}
