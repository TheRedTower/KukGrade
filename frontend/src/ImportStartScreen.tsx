import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { Badge } from "./Badge";
import { PageHeader } from "./PageHeader";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  ApiError,
  type DataImportKind,
  type SiteSettings,
  createDataImportBatch,
  errorMessage,
  getImportStarts,
} from "./api";
import { suffixOf } from "./importFiles";
import { ErrorText } from "./ErrorText";
import { ImportStepBar } from "./ImportStepBar";
import { importKinds } from "./importKinds";
import { useTemplateDownload } from "./importTemplate";
import { useSiteSettingsQuery } from "./queries";
import "./Imports.css";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { keys } from "./queryKeys";
import { UploadIcon } from "./Icons";
import { cx } from "./cx";

function parseKind(value: string | null): DataImportKind {
  return value === "LEGACY_GRADINGS" ? "LEGACY_GRADINGS" : "STUDENT_ROSTER";
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

function clientRefusal(
  file: File,
  kind: DataImportKind,
  types: FileTypes,
  maxBytes: number | undefined,
): string | null {
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
      <ul className="list-plain ix-guide-list">
        {guide.fields.map((field) => (
          <li key={field.name}>
            <span>
              <p className="item-title">{field.name}</p>
              {field.hint ? <p className="subtext">{field.hint}</p> : null}
            </span>
            <Badge tone={field.needed ? "info" : "neutral"}>{field.needed ? "Needed" : guide.optional}</Badge>
          </li>
        ))}
      </ul>
      <p className="ix-flush">{guide.foot}</p>
    </>
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

  // Past gradings wait for the students, as the server says.
  const starts = useQuery({ queryKey: keys.imports.starts(), queryFn: getImportStarts, staleTime: 0 });
  const whyNot = starts.data?.find((start) => start.kind === kind)?.why_not ?? null;
  const upload = useMutation({
    mutationFn: (file: File) => createDataImportBatch(file, kind),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: keys.imports.all() });
      // Straight on to what KukGrade found in the file.
      navigate(`/imports/${response.id}`, { state: { importedBefore: response.already_imported_warning } });
    },
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

  const fileError = refusal ?? (upload.isError ? uploadFailure(upload.error) : null);
  const accept = types.map((type) => `.${type.value}`).join(",");
  const { addsStudents, chooseLead, oneSheet, title } = importKinds[kind];

  return (
    <section aria-labelledby="ix-start-title" className="page">
      <PageHeader back={{ to: "/imports", label: "Imports" }} title={title} titleId="ix-start-title" />

      <ImportStepBar current="CHOOSE_FILE" kind={kind} />

      {whyNot ? (
        <section aria-labelledby="ix-first" className="card stack stack--4">
          <h2 className="ix-title" id="ix-first">
            Before you start
          </h2>
          <p className="subtext">{whyNot}</p>
          <Link className={buttonClass({ variant: "primary" }, "ix-start")} to="/imports/new?kind=STUDENT_ROSTER">
            Import students
          </Link>
        </section>
      ) : (
        <div className="ix-split">
          <section aria-labelledby="ix-choose" className="card stack stack--4 stack--fill">
            <div>
              <h2 className="ix-title" id="ix-choose">
                Choose your file
              </h2>
              <p className="subtext">{chooseLead}</p>
            </div>
            <div
              className={cx("ix-drop", dragging && "ix-drop-active")}
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
              <Button variant="primary" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
                {upload.isPending ? "Reading your file…" : "Choose a file"}
              </Button>
              <p className="subtext">
                {types.length ? `${typeWords(types)}, ` : null}
                {limit ? `up to ${limit}` : "size checked when uploaded"}
                {oneSheet && imports ? ` and ${imports.max_rows.toLocaleString("en-GB")} rows` : null}
              </p>
            </div>
            {fileError ? <ErrorText className="ix-flush">{fileError}</ErrorText> : null}
          </section>
          <aside aria-labelledby="ix-looks-for" className="card ix-sunken stack stack--3">
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
        <Link className={buttonClass({ variant: "ghost" })} to="/imports">
          Cancel import
        </Link>
      </div>
    </section>
  );
}
