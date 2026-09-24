import type { CSSProperties } from "react";

/**
 * A belt's colour from its rank name: the coloured belts by name, and black
 * for Black stripe and every black-belt title (Dahn Bo Nim onwards) - the
 * same classification as the syllabus screen's BeltSwatch.
 */
function rankColor(rankName: string): string {
  const name = rankName.toLowerCase();
  if (name.includes("white")) return "#cbd5e1";
  if (name.includes("yellow")) return "#eab308";
  if (name.includes("blue")) return "#2563eb";
  if (name.includes("red")) return "#dc2626";
  if (name.includes("brown")) return "#78350f";
  return "#0f172a";
}

/**
 * A rank as a dot of belt colour, or two bars for a stripe rank. Each screen
 * sizes it with its own `<prefix>-rank-dot`, `<prefix>-rank-stripes` and
 * `<prefix>-stripe-bar` rules.
 */
export function RankVisual({
  rankName,
  classPrefix,
}: {
  rankName: string;
  classPrefix: "bgc" | "gsd" | "caw";
}) {
  const color = rankColor(rankName);

  if (rankName.toLowerCase().includes("stripe")) {
    return (
      <span
        className={`${classPrefix}-rank-stripes`}
        style={{ "--rank-color": color } as CSSProperties}
        aria-hidden="true"
      >
        <span className={`${classPrefix}-stripe-bar`} />
        <span className={`${classPrefix}-stripe-bar`} />
      </span>
    );
  }

  return (
    <span
      className={`${classPrefix}-rank-dot`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}
