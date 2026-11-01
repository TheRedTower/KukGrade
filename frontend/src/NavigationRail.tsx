import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import type { AuthUser } from "./api";
import {
  AboutIcon,
  AuditIcon,
  GitHubIcon,
  GradingsIcon,
  ImportsIcon,
  OverviewIcon,
  SettingsIcon,
  SidebarIcon,
  SignOutIcon,
  StudentsIcon,
  SyllabusIcon,
  UsersIcon,
} from "./Icons";
import { KukGradeLogo } from "./KukGradeLogo";
import { useAboutQuery } from "./queries";
import { useNarrowScreen } from "./useNarrowScreen";
import { useSidebar } from "./useSidebar";
import "./NavigationRail.css";

function initialsOf(user: AuthUser): string {
  if (user.first_name && user.last_name) {
    return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
  }
  const parts = user.full_name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return (user.full_name[0] || user.email[0] || "U").toUpperCase();
}

function RailLink({
  to,
  end,
  icon,
  label,
  strip,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  label: string;
  strip: boolean;
}) {
  return (
    <NavLink
      className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
      end={end}
      title={strip ? label : undefined}
      to={to}
    >
      {icon}
      <span className="nav-label">{label}</span>
    </NavLink>
  );
}

/** The club, under the brand. The strip has no room for it. */
function ClubCard({ name }: { name: string | undefined }) {
  return (
    <div className="nav-club-card">
      <p className="nav-eyebrow">Your club</p>
      <p className="nav-club-name">{name}</p>
    </div>
  );
}

/**
 * The sidebar: the brand, which goes to the dashboard; the club;
 * the pages; and at its foot the signed-in person, Settings, About and the
 * project. It opens at full width or collapses to a strip of icons, and on a
 * phone it folds behind a Menu button.
 */
export function NavigationRail({
  clubName,
  user,
  onLogout,
  isLoggingOut,
}: {
  clubName: string | undefined;
  user: AuthUser;
  onLogout: () => void;
  isLoggingOut: boolean;
}) {
  const { collapsed, setCollapsed } = useSidebar();
  const narrow = useNarrowScreen();
  // On a phone the sidebar is always the full menu; the strip is for desktops.
  const strip = collapsed && !narrow;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  // Escape closes the phone menu and gives focus back to its button.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog open over the menu keeps Escape, and the focus, to itself.
      if (event.key !== "Escape" || document.querySelector('[aria-modal="true"]')) return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);
  const about = useAboutQuery().data;
  const version = about?.release;
  const initials = initialsOf(user);
  const aboutLabel = version ? `About KukGrade, version ${version}` : "About KukGrade";

  return (
    <aside
      aria-label="Sidebar"
      className={`nav-rail${strip ? " strip" : ""}${menuOpen ? " menu-open" : ""}`}
    >
      <div className="nav-top">
        <Link aria-label="KukGrade, go to the dashboard" className="nav-brand" to="/">
          {strip ? (
            <span aria-hidden="true" className="nav-mark">
              K
            </span>
          ) : (
            <KukGradeLogo className="nav-logo" />
          )}
        </Link>
        <button
          aria-controls="nav-panel"
          aria-expanded={menuOpen}
          className="nav-menu-button"
          ref={menuButton}
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          Menu
        </button>
      </div>

      {/* On a phone the menu closes once a page is chosen from it. */}
      <div
        className="nav-panel"
        id="nav-panel"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setMenuOpen(false);
        }}
      >
        {strip ? null : <ClubCard name={clubName} />}

        <nav aria-label="Main navigation" className="nav-links">
          <RailLink end icon={<OverviewIcon />} label="Overview" strip={strip} to="/" />
          <RailLink icon={<StudentsIcon />} label="Students" strip={strip} to="/students" />
          <RailLink icon={<GradingsIcon />} label="Gradings" strip={strip} to="/gradings" />
          <RailLink icon={<SyllabusIcon />} label="Syllabus" strip={strip} to="/syllabus" />
          {user.can_import_data ? <RailLink icon={<ImportsIcon />} label="Imports" strip={strip} to="/imports" /> : null}
          {user.can_read_audit_log ? <RailLink icon={<AuditIcon />} label="Audit" strip={strip} to="/audit" /> : null}
          {user.can_manage_users ? <RailLink icon={<UsersIcon />} label="Users" strip={strip} to="/users" /> : null}
        </nav>

        <div className="nav-foot">
          {strip ? (
            <div className="nav-strip-tools">
              <NavLink aria-label="Settings" className="nav-icon-button" title="Settings" to="/settings">
                <SettingsIcon />
              </NavLink>
              <Link aria-label={aboutLabel} className="nav-icon-button" title="About" to="/settings/about">
                <AboutIcon />
              </Link>
              {about ? (
                <a
                  aria-label="KukGrade on GitHub (opens in a new tab)"
                  className="nav-icon-button"
                  href={about.repository_url}
                  rel="noopener noreferrer"
                  target="_blank"
                  title="GitHub"
                >
                  <GitHubIcon />
                </a>
              ) : null}
              <Link
                aria-label={`${user.full_name}, ${user.role_display}: your account`}
                className="nav-icon-button"
                title={`${user.full_name} · ${user.role_display}`}
                to="/settings/account"
              >
                <span aria-hidden="true" className="avatar-circle">
                  {initials}
                </span>
              </Link>
            </div>
          ) : (
            <>
              <div className="nav-person">
                <Link
                  aria-label={`${user.full_name}, ${user.role_display}: your account`}
                  className="nav-person-link"
                  to="/settings/account"
                >
                  <span aria-hidden="true" className="avatar-circle">
                    {initials}
                  </span>
                  <span className="nav-person-text">
                    <span className="nav-person-name">{user.full_name}</span>
                    <span className="nav-person-role">{user.role_display}</span>
                  </span>
                </Link>
                <NavLink aria-label="Settings" className="nav-icon-button" title="Settings" to="/settings">
                  <SettingsIcon />
                </NavLink>
                <button
                  aria-label="Sign out"
                  className="nav-icon-button"
                  disabled={isLoggingOut}
                  onClick={onLogout}
                  title="Sign out"
                  type="button"
                >
                  <SignOutIcon />
                </button>
              </div>
              <p className="nav-about-line">
                <Link to="/settings/about">KukGrade{version ? ` ${version}` : ""}</Link>
                <span aria-hidden="true">·</span>
                <Link to="/settings/about">About</Link>
                {about ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <a href={about.repository_url} rel="noopener noreferrer" target="_blank">
                      GitHub<span className="visually-hidden"> (opens in a new tab)</span>
                    </a>
                  </>
                ) : null}
              </p>
            </>
          )}

          {narrow ? null : (
            <button
              aria-expanded={!strip}
              aria-label={strip ? "Expand sidebar" : "Collapse sidebar"}
              className="nav-collapse"
              onClick={() => setCollapsed(!collapsed)}
              type="button"
            >
              <SidebarIcon />
              {strip ? null : <span>Collapse sidebar</span>}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
