import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { Badge } from "./Badge";
import { PageHeader } from "./PageHeader";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  ApiError,
  type CreateDataImportBatchResponse,
  type DataImportBatch,
  type DataImportKind,
  type SiteSettings,
  cancelDataImportBatch,
  chooseDataImportSheet,
  createDataImportBatch,
  errorMessage,
  getDataImportBatch,
} from "./api";
import { Alert } from "./Alert";
import { ErrorText } from "./ErrorText";
import { ImportStepBar } from "./ImportStepBar";
import { importKinds } from "./importKinds";
import { useTemplateDownload } from "./importTemplate";
import { useSiteSettingsQuery } from "./queries";
import "./Imports.css";
import { Button } from "./Button";
import { keys } from "./queryKeys";
import { ChevronRightIcon, UploadIcon } from "./Icons";

function parseKind(value: string | null): DataImportKind {
  return value === "LEGACY_GRADINGS" ? "LEGACY_GRADINGS" : "STUDENT_ROSTER";
}

function suffixOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sizeLimit(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MB`;
}

/** Why the browser can refuse a file before sending it, or null. */
type FileTypes = SiteSettings["imports"]["kinds"][number]["file_types"];

/** The file types in a phrase: "Excel (.xlsx) or CSV (.csv)". */
function typeWords(types: FileTypes): string {
  return types.map((type) => `${type.label} (.${type.value})`).join(" or ");
}

function clientRefusal(file: File, kind: DataImportKind, types: FileTypes, maxBytes: number | undefined): string | null {
  if (types.length && !types.some((type) => type.value === suffixOf(file.name))) {
    return importKinds[kind].wrongType(typeWords(types));
  }
  if (maxBytes !== undefined && file.size > maxBytes) {
    return `The file is larger than ${sizeLimit(maxBytes)}.`;
  }
  return null;
}

function uploadFailure(error: unknown): string {
  if (error instanceof ApiError) {
    const fileMessage = error.messagesFor("file")[0];
    if (fileMessage) return fileMessage;
  }
  return errorMessage(error, "The file could not be read. Try again in a moment.");
}



function GuideList({ kind }: { kind: DataImportKind }) {
  const guide = importKinds[kind].guide;
  return (
    <>
      <p className="subtext">{guide.lead}</p>
      <ul className="ix-guide-list">
        {guide.fields.map((field) => (
          <li key={field.name}>
            <span>
              <p className="item-title">{field.name}</p>
              {field.hint ? <p className="subtext">{field.hint}</p> : null}
            </span>
            <Badge tone={field.needed ? "info" : "neutral"}>
              {field.needed ? "Needed" : guide.optional}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="ix-flush">
        {guide.foot}
      </p>
    </>
  );
}

function FoundChecklist({
  batch,
  created,
  kind,
  limit,
}: {
  batch: DataImportBatch;
  created: CreateDataImportBatchResponse;
  kind: DataImportKind;
  limit: string | undefined;
}) {
  const items: { ok: boolean; title: string; detail: string }[] = [
    {
      ok: true,
      title:
        suffixOf(batch.original_filename) === "csv"
          ? "A CSV file KukGrade can read"
          : "An Excel workbook KukGrade can read",
      detail: `${fileSize(batch.file_size)}${limit ? `, under the ${limit} limit` : ""}.`,
    },
  ];
  items.push(...importKinds[kind].found(batch));
  if (created.already_imported_warning) {
    items.push({
      ok: false,
      title: "This exact file has been imported before",
      detail: importKinds[kind].alreadyImported,
    });
  }

  return (
    <div>
      <h3 className="ix-h3">What KukGrade found</h3>
      <ul className="ix-checklist">
        {items.map((item) => (
          <li key={item.title}>
            <span aria-hidden="true" className={`mark ${item.ok ? "mark--success" : "mark--warning"}`}>
              {item.ok ? "✓" : "!"}
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

/** Step 1 of an import: choose the file, see what KukGrade found. */
export function ImportStartScreen() {
  const [searchParams] = useSearchParams();
  const kind = parseKind(searchParams.get("kind"));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const imports = useSiteSettingsQuery().data?.imports;
  const template = useTemplateDownload();
  const maxBytes = imports?.max_bytes;
  const types = imports?.kinds.find((served) => served.kind === kind)?.file_types ?? [];
  const limit = maxBytes === undefined ? undefined : sizeLimit(maxBytes);
  const inputRef = useRef<HTMLInputElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [created, setCreated] = useState<CreateDataImportBatchResponse | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const upload = useMutation({
    mutationFn: (file: File) => createDataImportBatch(file, kind),
    onSuccess: (response) => {
      setCreated(response);
      void queryClient.invalidateQueries({ queryKey: keys.imports.all() });
    },
  });
  const batchId = created?.id;
  const batch = useQuery({
    queryKey: keys.imports.batch(batchId),
    queryFn: () => getDataImportBatch(batchId!),
    enabled: batchId !== undefined,
  });
  const sheet = useMutation({
    mutationFn: (name: string) => chooseDataImportSheet(batchId!, name),
    onSuccess: (updated) => queryClient.setQueryData(keys.imports.batch(batchId), updated),
  });
  const discard = useMutation({
    mutationFn: (id: number) => cancelDataImportBatch(id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.imports.all() }),
  });

  function take(file: File | undefined) {
    if (!file || upload.isPending) return;
    const reason = clientRefusal(file, kind, types, maxBytes);
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
  const accept = types.map((type) => `.${type.value}`).join(",");
  const { addsStudents, chooseLead, match, oneSheet, title } = importKinds[kind];
  const emptySheet = oneSheet && loaded !== null && (Boolean(loaded.sheet_error) || loaded.row_counts.total === 0);

  return (
    <section aria-labelledby="ix-start-title" className="page">
      <PageHeader back={{ to: "/imports", label: "Imports" }} title={title} titleId="ix-start-title" />

      <ImportStepBar current="CHOOSE_FILE" kind={kind} />

      {loaded && created ? (
        <section aria-labelledby="ix-your-file" className="card ix-section ix-roomy">
          <h2 className="ix-title ix-flush" id="ix-your-file" tabIndex={-1}>
            Your file
          </h2>
          <div className="ix-file">
            <div className="ix-row-main">
              <p className="item-title">{loaded.original_filename}</p>
              <p className="subtext">{fileSize(loaded.file_size)}</p>
            </div>
            <Button variant="ghost" disabled={discard.isPending} onClick={chooseAnother}>
              Choose a different file
            </Button>
          </div>
          <FoundChecklist batch={loaded} created={created} kind={kind} limit={limit} />
          {emptySheet ? (
            <Alert tone="warning">
              {loaded.sheet_error || "This sheet has no student rows."} Choose the sheet containing the roster before continuing.
            </Alert>
          ) : null}
          {oneSheet && loaded.sheet_names.length > 1 ? (
            <label className="field field--sentence ix-field-narrow">
              <span>Sheet to read</span>
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
              <span className="subtext">
                {sheet.isPending
                  ? "Reading that sheet…"
                  : `The workbook has ${loaded.sheet_names.length} sheets. KukGrade picked the one it opens on.`}
              </span>
            </label>
          ) : null}
          {sheet.isError ? (
            <ErrorText>
              {errorMessage(sheet.error, "That sheet could not be read.")}
            </ErrorText>
          ) : null}
          <details
            className="disclosure ix-fold"
            open={guideOpen}
            onToggle={(event) => setGuideOpen(event.currentTarget.open)}
          >
            <summary>
              <ChevronRightIcon />
              What KukGrade looks for
            </summary>
            <div className="ix-section disclosure__body">
              <GuideList kind={kind} />
            </div>
          </details>
        </section>
      ) : (
        <div className="ix-split">
          <section aria-labelledby="ix-choose" className="card ix-section ix-roomy">
            <div>
              <h2 className="ix-title" id="ix-choose">
                Choose your file
              </h2>
              <p className="subtext">
                {chooseLead}
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
              <span className="subtext">
                <UploadIcon size={40} />
              </span>
              <p className="item-title">Drag your file here</p>
              <p className="subtext">or</p>
              <input
                ref={inputRef}
                accept={accept}
                aria-label="Choose a file"
                className="visually-hidden"
                tabIndex={-1}
                type="file"
                onChange={onPicked}
              />
              <Button
                variant="primary"
                disabled={upload.isPending || (created !== null && batch.isPending)}
                onClick={() => inputRef.current?.click()}
              >
                {upload.isPending || (created !== null && batch.isPending) ? "Reading your file…" : "Choose a file"}
              </Button>
              <p className="subtext">
                {types.length ? `${typeWords(types)}, ` : null}
                {limit ? `up to ${limit}` : "size checked when uploaded"}
                {oneSheet && imports ? ` and ${imports.max_rows.toLocaleString("en-GB")} rows` : null}
              </p>
            </div>
            {fileError ? (
              <ErrorText className="ix-flush">
                {fileError}
              </ErrorText>
            ) : null}
          </section>
          <aside aria-labelledby="ix-looks-for" className="card ix-sunken ix-section">
            <h2 className="ix-minor" id="ix-looks-for">
              What KukGrade looks for
            </h2>
            <GuideList kind={kind} />
            {addsStudents ? (
              <Button variant="secondary" className="ix-start" disabled={!template.ready} onClick={template.download}>
                Download the template
              </Button>
            ) : null}
          </aside>
        </div>
      )}

      <div className="step-foot">
        <Button variant="ghost" disabled={discard.isPending} onClick={cancelImport}>
          Cancel import
        </Button>
        <div className="ix-actions">
          {!loaded ? (
            <span className="subtext" id="ix-continue-why">
              Choose a file first.
            </span>
          ) : null}
          <Button
            aria-describedby={loaded ? undefined : "ix-continue-why"}
            variant="primary"
            disabled={!loaded || sheet.isPending || emptySheet}
            onClick={() => navigate(`/imports/${batchId}`)}
          >
            Continue to match {match}
          </Button>
        </div>
      </div>
    </section>
  );
}
