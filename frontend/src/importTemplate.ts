// The client-side roster template download. Every header must be one that
// data_imports/mappings.py's suggest_column_mapping recognises.
const STANDARD_TEMPLATE_HEADERS = [
  "WKSA ID",
  "First Name",
  "Last Name",
  "Date of Birth",
  "Current Rank",
  "Status",
];

export function downloadStandardTemplate() {
  const csv = `${STANDARD_TEMPLATE_HEADERS.join(",")}\n`;
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
