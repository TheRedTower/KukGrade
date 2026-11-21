// RFC 9116. Made at build time, so each release renews its expiry a year ahead.
import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  expires.setUTCHours(0, 0, 0, 0);
  const lines = [
    "Contact: mailto:security@kukgrade.co.uk",
    "Contact: https://github.com/TheRedTower/KukGrade/security/advisories/new",
    `Expires: ${expires.toISOString()}`,
    "Policy: https://github.com/TheRedTower/KukGrade/blob/dev/SECURITY.md",
    "Preferred-Languages: en",
    "Canonical: https://kukgrade.co.uk/.well-known/security.txt",
  ];
  return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
