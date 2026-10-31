import { NavLink, Route, Routes } from "react-router-dom";

import "./About.css";
import { AboutConduct, AboutLicence, AboutSecurity } from "./AboutDocuments";
import { AboutCredits } from "./AboutCredits";
import { AboutOverview } from "./AboutOverview";
import { AboutSupport } from "./AboutSupport";
import { useAboutQuery } from "./queries";

const SECTIONS = [
  { to: "/settings/about", label: "Overview", end: true },
  { to: "/settings/about/licence", label: "Licence" },
  { to: "/settings/about/conduct", label: "Code of conduct" },
  { to: "/settings/about/security", label: "Security" },
  { to: "/settings/about/support", label: "Support" },
  { to: "/settings/about/credits", label: "Credits" },
];

/** About KukGrade: what is running, on what terms, and where to get help. */
export function SettingsAbout() {
  const about = useAboutQuery().data;

  return (
    <div className="split split--rail">
      <nav aria-label="About sections" className="st-card split__aside ab-rail">
        {SECTIONS.map((section) => (
          <NavLink end={section.end} key={section.to} to={section.to}>
            {section.label}
          </NavLink>
        ))}
        {about ? (
          <p className="ab-rail-foot">
            KukGrade {about.version}
            <br />
            {about.licence}
            <br />
            {about.copyright}
          </p>
        ) : null}
      </nav>
      <div className="ab-main">
        <Routes>
          <Route element={<AboutOverview />} index />
          <Route element={<AboutLicence />} path="licence" />
          <Route element={<AboutConduct />} path="conduct" />
          <Route element={<AboutSecurity />} path="security" />
          <Route element={<AboutSupport />} path="support" />
          <Route element={<AboutCredits />} path="credits" />
        </Routes>
      </div>
    </div>
  );
}
