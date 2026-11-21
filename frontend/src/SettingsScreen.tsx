import { Navigate, Route, Routes } from "react-router-dom";

import { PageHeader } from "./PageHeader";

import { SettingsAbout } from "./SettingsAbout";
import { SettingsAccount } from "./SettingsAccount";
import { SettingsAppearance } from "./SettingsAppearance";
import { SmoothNavLink } from "./SmoothNavLink";
import "./Settings.css";

const TABS = [
  { to: "/settings/account", label: "Account" },
  { to: "/settings/appearance", label: "Appearance" },
  { to: "/settings/about", label: "About" },
];

/** Settings as tabs of rows: Account, Appearance and About. */
export function SettingsScreen() {
  return (
    <section aria-labelledby="st-title" className="page st-page">
      <PageHeader title="Settings" titleId="st-title" />
      <nav aria-label="Settings sections" className="st-tabs">
        {TABS.map((tab) => (
          <SmoothNavLink className="menu-link st-tab" key={tab.to} to={tab.to}>
            {tab.label}
          </SmoothNavLink>
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
