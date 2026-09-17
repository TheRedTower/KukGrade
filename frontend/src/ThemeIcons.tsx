/**
 * Minimal inline icons for the theme toggle only - not an adoption of an
 * icon library. The design register flags picking one consistent accessible
 * icon library as outstanding work; these three are scoped to this one
 * control until that happens.
 */

const commonProps = {
  "aria-hidden": true,
  fill: "none",
  height: 16,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 2,
  viewBox: "0 0 24 24",
  width: 16,
};

export function SunIcon() {
  return (
    <svg {...commonProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg {...commonProps}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

export function MonitorIcon() {
  return (
    <svg {...commonProps}>
      <rect height="14" rx="1.5" width="20" x="2" y="3" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
