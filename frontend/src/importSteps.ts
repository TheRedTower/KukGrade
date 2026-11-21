import type { DataImportKind, SiteSettings } from "./api";
import { useSiteSettingsQuery } from "./queries";

// The steps of an import, as the server names them. What differs between
// the kinds of import is in importKinds.ts.

export type ImportSteps = SiteSettings["imports"]["kinds"][number]["steps"];

/**
 * The steps each kind of import runs through, named, as the server serves
 * them (site settings, imports.kinds); none while the settings load.
 */
export function useImportSteps(): (kind: DataImportKind) => ImportSteps {
  const kinds = useSiteSettingsQuery().data?.imports.kinds;
  return (kind) => kinds?.find((served) => served.kind === kind)?.steps ?? [];
}
