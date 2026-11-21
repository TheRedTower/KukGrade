// The facts the page states, each read from its one source in the repository.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Built from site/ (npm run build), so the repository root is one folder up.
const versionFile = resolve(process.cwd(), "../backend/kukgrade/version.py");
const version = /VERSION = "([^"]+)"/.exec(readFileSync(versionFile, "utf8"))?.[1];
if (!version) throw new Error("No VERSION in backend/kukgrade/version.py");

export const site = {
  version,
  school: "Kuk Sool Won of Colchester",
  repo: "https://github.com/TheRedTower/KukGrade",
  docs: "https://github.com/TheRedTower/KukGrade/tree/dev/docs#readme",
  licence: "https://github.com/TheRedTower/KukGrade/blob/dev/LICENSE",
  security: "https://github.com/TheRedTower/KukGrade/blob/dev/SECURITY.md",
  securityEmail: "security@kukgrade.co.uk",
  demo: "https://demo.kukgrade.co.uk",
};
