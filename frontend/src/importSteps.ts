import type { DataImportKind, DataImportRow, SiteSettings } from "./api";
import { useSiteSettingsQuery } from "./queries";

// The wording the import screens share, so a step, a kind of import or a
// row is named the same way everywhere.

export type ImportSteps = SiteSettings["imports"]["kinds"][number]["steps"];

/**
 * The steps each kind of import runs through, named, as the server serves
 * them (site settings, imports.kinds); none while the settings load.
 */
export function useImportSteps(): (kind: DataImportKind) => ImportSteps {
  const kinds = useSiteSettingsQuery().data?.imports.kinds;
  return (kind) => kinds?.find((served) => served.kind === kind)?.steps ?? [];
}

export function importKindTitle(kind: DataImportKind): string {
  return kind === "STUDENT_ROSTER" ? "Import students" : "Import past gradings";
}

/** A row's person as the file names them. */
export function importRowName(row: DataImportRow, kind: DataImportKind): string {
  const name =
    kind === "STUDENT_ROSTER"
      ? [row.values.first_name, row.values.last_name].filter(Boolean).join(" ")
      : row.values.name;
  return name || "(no name)";
}
