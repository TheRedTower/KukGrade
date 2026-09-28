/**
 * Inline icons used on more than one screen, so each glyph is drawn once.
 * Screen-specific icons stay beside their screen; the nav and theme toggle
 * keep their own modules.
 */

type IconProps = { size?: number; className?: string };

function iconProps({ size = 16, className }: IconProps, strokeWidth = 2) {
  return {
    "aria-hidden": true,
    className,
    fill: "none",
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth,
    viewBox: "0 0 24 24",
    width: size,
  };
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...iconProps(props, 2.6)}>
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

export function CrossIcon(props: IconProps) {
  return (
    <svg {...iconProps(props, 2.6)}>
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
    </svg>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M12 3.5 21.5 20H2.5z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <rect height="11" rx="2" ry="2" width="18" x="3" y="11" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
    </svg>
  );
}
