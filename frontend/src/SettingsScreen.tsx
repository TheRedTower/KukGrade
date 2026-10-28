import { Navigate, NavLink, Route, Routes } from "react-router-dom";

import { SettingsAbout } from "./SettingsAbout";
import { SettingsAccount } from "./SettingsAccount";
import { SettingsAppearance } from "./SettingsAppearance";
import "./Settings.css";

const TABS = [
  { to: "/settings/account", label: "Account" },
  { to: "/settings/appearance", label: "Appearance" },
  { to: "/settings/about", label: "About" },
];

/** Settings as tabs of rows: Account, Appearance and About. */
export function SettingsScreen() {
  return (
    <section aria-labelledby="st-title" className="st-page">
      <h1 id="st-title">Settings</h1>
      <nav aria-label="Settings sections" className="st-tabs">
        {TABS.map((tab) => (
          <NavLink className={({ isActive }) => `st-tab${isActive ? " active" : ""}`} key={tab.to} to={tab.to}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route element={<Navigate replace to="/settings/account" />} index />
        <Route element={<SettingsAccount />} path="account" />
        <Route element={<SettingsAppearance />} path="appearance" />
        <Route element={<SettingsAbout />} path="about/*" />
        <Route element={<Navigate replace to="/settings/account" />} path="*" />
      </Routes>
    </section>
  );
}
