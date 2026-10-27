import { ThemeToggle } from "./AuthChrome";
import { SettingsRow } from "./SettingsRow";
import { useSidebar } from "./useSidebar";

/** How KukGrade looks for you, on this browser only. */
export function SettingsAppearance() {
  const { collapsed, setCollapsed } = useSidebar();

  return (
    <section aria-label="Appearance" className="st-card">
      <SettingsRow description="For this browser only. System follows your device." title="Theme">
        <ThemeToggle />
      </SettingsRow>
      <SettingsRow description="Start with it open, or as a strip of icons." title="Sidebar">
        <div aria-label="Sidebar" className="st-segments" role="group">
          <button aria-pressed={!collapsed} onClick={() => setCollapsed(false)} type="button">
            Open
          </button>
          <button aria-pressed={collapsed} onClick={() => setCollapsed(true)} type="button">
            Icons only
          </button>
        </div>
      </SettingsRow>
    </section>
  );
}
