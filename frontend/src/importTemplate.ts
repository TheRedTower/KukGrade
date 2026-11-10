import { useSiteSettingsQuery } from "./queries";

function downloadCsv(headers: string[]) {
  const csv = `${headers.join(",")}\n`;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kukgrade-student-roster-template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
