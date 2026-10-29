/**
 * Inline icons, so each glyph is drawn once with the same stroke props:
 * shared glyphs, the navigation rail's and the theme
 * toggle's. Screen-specific icons stay beside their screen. Every icon is
 * aria-hidden; the control around it supplies the accessible name.
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

export function XCircleIcon(props: IconProps) {
  return (
    <svg {...iconProps(props, 2.5)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9 9 15M9 9l6 6" />
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

// Navigation rail: 20px and styled by .nav-icon.
const NAV_ICON: IconProps = { size: 20, className: "nav-icon" };

export function OverviewIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M10 21v-7h4v7" />
    </svg>
  );
}

export function StudentsIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function GradingsIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      {/* Martial arts belt knot / medal motif */}
      <rect height="6" rx="1" width="18" x="3" y="6" />
      <path d="M10 12l-2 9 4-2 4 2-2-9" />
      <circle cx="12" cy="9" r="1.5" />
    </svg>
  );
}

export function ImportsIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      <path d="M12 3v11" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M3 14v4a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-4" />
    </svg>
  );
}

export function SyllabusIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8" />
      <path d="M8 11h6" />
    </svg>
  );
}

export function AuditIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect height="4" rx="1" width="8" x="8" y="2" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}

export function UsersIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      <path d="M10 15H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <circle cx="18" cy="15" r="3" />
      <path d="m14.305 16.53.923-.382" />
      <path d="m15.228 13.852-.923-.383" />
      <path d="m16.852 12.228-.383-.923" />
      <path d="m16.852 17.772-.383.924" />
      <path d="m19.148 12.228.383-.923" />
      <path d="m19.53 18.696-.382-.924" />
      <path d="m20.772 13.852.924-.383" />
      <path d="m20.772 16.148.924.383" />
    </svg>
  );
}

// Theme toggle.
export function SunIcon() {
  return (
    <svg {...iconProps({})}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg {...iconProps({})}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

export function MonitorIcon() {
  return (
    <svg {...iconProps({})}>
      <rect height="14" rx="1.5" width="20" x="2" y="3" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

// The sidebar's foot.
export function SettingsIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

export function AboutIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function GitHubIcon() {
  return (
    <svg aria-hidden="true" className="nav-icon" fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.4 9.4 0 0 1 12 6.84c.85 0 1.7.12 2.5.35 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.81c0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}

export function SignOutIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
  );
}

export function SidebarIcon() {
  return (
    <svg {...iconProps(NAV_ICON)}>
      <rect height="16" rx="2" width="18" x="3" y="4" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg {...iconProps({ size: 18 })}>
      <rect height="12" rx="2" width="12" x="9" y="9" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
