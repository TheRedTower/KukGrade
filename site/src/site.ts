// The facts the page states, each read from its one source in the repository.
// The version comes from backend/kukgrade/version.py, read by astro.config.mjs.
declare const __KUKGRADE_VERSION__: string;

export const site = {
  version: __KUKGRADE_VERSION__,
  school: "Kuk Sool Won of Colchester",
  repo: "https://github.com/TheRedTower/KukGrade",
  docs: "https://github.com/TheRedTower/KukGrade/tree/dev/docs#readme",
  licence: "https://github.com/TheRedTower/KukGrade/blob/dev/LICENSE",
  security: "https://github.com/TheRedTower/KukGrade/blob/dev/SECURITY.md",
  securityEmail: "security@kukgrade.co.uk",
  demo: "https://demo.kukgrade.co.uk",
};
