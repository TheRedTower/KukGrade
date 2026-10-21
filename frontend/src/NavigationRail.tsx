import { useState } from "react";
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
import { useAboutQuery, useSiteSettingsQuery } from "./queries";
import { useClubClock } from "./useClubClock";
import { useNarrowScreen } from "./useNarrowScreen";
import { useSidebar } from "./useSidebar";
import "./NavigationRail.css";

export const GITHUB_URL = "https://github.com/TheRedTower/KukGrade";

function initialsOf(user: AuthUser): string {
  if (user.first_name && user.last_name) {
    return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
  }
  const parts = user.full_name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return (user.full_name[0] || user.email[0] || "U").toUpperCase();
}

function RailLink({ to, end, icon, label }: { to: string; end?: boolean; icon: React.ReactNode; label: string }) {
  return (
    <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} end={end} title={label} to={to}>
      {icon}
      <span className="nav-label">{label}</span>
    </NavLink>
  );
}

/** The club and its time, under the brand (FDR-056). */
function ClubCard({ strip }: { strip: boolean }) {
  const site = useSiteSettingsQuery().data;
  const time = useClubClock();
  if (strip) {
    return (
      <p className="nav-club-tile" title={`${site?.club_name ?? "Your club"} · club time ${time}`}>
        <span className="visually-hidden">
          {site?.club_name}, club time {time}
        </span>
        <span aria-hidden="true">{time}</span>
      </p>
    );
  }
  return (
    <div className="nav-club-card">
      <p className="nav-eyebrow">Your club</p>
      <p className="nav-club-name">{site?.club_name}</p>
      <p className="nav-club-time">
        Club time {time}
        {site?.time_zone ? ` · ${site.time_zone}` : ""}
      </p>
    </div>
  );
}

/**
 * The sidebar (FDR-056): the brand, which goes to the dashboard; the club;
 * the pages; and at its foot the signed-in person, Settings, About and the
 * project. It opens at full width or collapses to a strip of icons, and on a
 * phone it folds behind a Menu button.
 */
export function NavigationRail({
  user,
  onLogout,
  isLoggingOut,
}: {
  user: AuthUser;
  onLogout: () => void;
  isLoggingOut: boolean;
}) {
  const { collapsed, setCollapsed } = useSidebar();
  const narrow = useNarrowScreen();
  // On a phone the sidebar is always the full menu; the strip is for desktops.
  const strip = collapsed && !narrow;
  const [menuOpen, setMenuOpen] = useState(false);
  const version = useAboutQuery().data?.version;
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
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          Menu
        </button>
      </div>

      <div className="nav-panel" id="nav-panel">
        <ClubCard strip={strip} />

        <nav aria-label="Main navigation" className="nav-links">
          <RailLink end icon={<OverviewIcon />} label="Overview" to="/" />
          <RailLink icon={<StudentsIcon />} label="Students" to="/students" />
          <RailLink icon={<GradingsIcon />} label="Gradings" to="/gradings" />
          <RailLink icon={<SyllabusIcon />} label="Syllabus" to="/syllabus" />
          {user.can_import_data ? <RailLink icon={<ImportsIcon />} label="Imports" to="/imports" /> : null}
          {user.can_read_audit_log ? <RailLink icon={<AuditIcon />} label="Audit" to="/audit" /> : null}
          {user.can_manage_users ? <RailLink icon={<UsersIcon />} label="Users" to="/users" /> : null}
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
              <a
                aria-label="KukGrade on GitHub (opens in a new tab)"
                className="nav-icon-button"
                href={GITHUB_URL}
                rel="noopener noreferrer"
                target="_blank"
                title="GitHub"
              >
                <GitHubIcon />
              </a>
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
                <span aria-hidden="true">·</span>
                <a href={GITHUB_URL} rel="noopener noreferrer" target="_blank">
                  GitHub<span className="visually-hidden"> (opens in a new tab)</span>
                </a>
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
