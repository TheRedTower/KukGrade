import type { CSSProperties, ReactNode } from "react";

import { MonitorIcon, MoonIcon, SunIcon } from "./Icons";
import { KukGradeLogo } from "./KukGradeLogo";
import { useTheme, type ThemePreference } from "./useTheme";

// The pieces the signed-out pages share - sign-in and first-time setup - so
// they look alike and pick a theme the same way.

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "system", label: "System", icon: <MonitorIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
];

export function ThemeToggle() {
  const { preference, setTheme } = useTheme();
  const activeIndex = THEME_OPTIONS.findIndex((option) => option.value === preference);

  return (
    <div aria-label="Theme" className="theme-toggle" role="group">
      <div
        className="theme-toggle-track"
        style={{ "--theme-toggle-active-index": String(activeIndex) } as CSSProperties}
      >
        <div aria-hidden className="theme-toggle-thumb" />
        {THEME_OPTIONS.map((option) => (
          <button
            aria-pressed={preference === option.value}
            className="theme-toggle-option"
            key={option.value}
            onClick={() => setTheme(option.value)}
            title={option.label}
            type="button"
          >
            {option.icon}
            <span className="visually-hidden">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LoginBrandPanel() {
  return (
    <aside className="auth-brand">
      <div>
        <KukGradeLogo className="auth-logo" />
        <p className="auth-brand-tagline">Staff grading management</p>
        <p className="auth-brand-values">People &middot; Progress &middot; Purpose</p>
      </div>
      <div className="auth-brand-footer">
        <p>Built for instructors.</p>
        <p>Focused on what matters.</p>
      </div>
    </aside>
  );
}
