/**
 * Belt swatch shown beside a rank name on the assessment screens.
 *
 * Decorative only - every use sits next to the rank's own text, so the swatch
 * is `aria-hidden` and never the sole carrier of meaning (FDR-003).
 */
export function RankVisual({ rankName }: { rankName: string }) {
  const isStripe = rankName.toLowerCase().includes("stripe");
  const lower = rankName.toLowerCase();

  let color = "#94a3b8"; // default
  if (lower.includes("yellow")) color = "#eab308";
  else if (lower.includes("blue")) color = "#2563eb";
  else if (lower.includes("red")) color = "#dc2626";
  else if (lower.includes("brown")) color = "#78350f";
  else if (lower.includes("black") || lower.includes("dahn") || lower.includes("pu sa")) color = "#0f172a";

  if (isStripe) {
    return (
      <span
        className="caw-rank-stripes"
        style={{ "--rank-color": color } as React.CSSProperties}
        aria-hidden="true"
      >
        <span className="caw-stripe-bar" />
        <span className="caw-stripe-bar" />
      </span>
    );
  }

  return (
    <span
      className="caw-rank-dot"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}
