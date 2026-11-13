import { useSiteSettingsQuery } from "./queries";
import { saveFile } from "./saveFile";

function downloadCsv(headers: string[]) {
  const csv = `${headers.join(",")}\n`;
  saveFile(new Blob([csv], { type: "text/csv" }), "kukgrade-student-roster-template.csv");
}

/**
 * The roster template download: the header row the server serves
 * (site settings, imports.template_headers). Not ready until the settings arrive.
 */
export function useTemplateDownload(): { ready: boolean; download: () => void } {
  const headers = useSiteSettingsQuery().data?.imports.template_headers;
  return {
    ready: headers !== undefined,
    download: () => {
      if (headers) downloadCsv(headers);
    },
  };
}
