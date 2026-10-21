import { useState } from "react";

import { errorMessage } from "./api";
import { formatDateTime } from "./dates";
import { CopyIcon, GitHubIcon } from "./Icons";
import { GITHUB_URL } from "./NavigationRail";
import { useAboutQuery } from "./queries";

const ISSUES_URL = `${GITHUB_URL}/issues`;

/** What is running, and what to quote when asking for help (FDR-058). */
export function SettingsAbout() {
  const about = useAboutQuery();
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);
  const data = about.data;

  const details = data
    ? [
        ["Application", __APP_VERSION__],
        ["Server", data.version],
        ["Built", data.built_at ? formatDateTime(data.built_at) : "Not recorded"],
        ["Commit", data.commit || "Not recorded"],
        ["Club time zone", data.time_zone],
        ["Database", data.database === "ok" ? "Ready" : "Not answering"],
      ]
    : [];

  async function copy() {
    const text = ["KukGrade", ...details.map(([name, value]) => `${name}: ${value}`)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="st-about">
      <section aria-labelledby="st-about-hero" className="st-card st-hero">
        <span aria-hidden="true" className="st-hero-mark">
          K
        </span>
        <div className="st-hero-text">
          <h2 id="st-about-hero">
            Kuk<span className="st-accent">Grade</span>
          </h2>
          <p className="st-eyebrow">People · Progress · Purpose</p>
          <p className="st-row-description">
            Grading management for Kuk Sool Won instructors and administrators. Built for the
            club, kept by the club.
          </p>
        </div>
        <p className="st-version-tile">
          <span>Version</span>
          <strong>{data?.version ?? "…"}</strong>
        </p>
      </section>

      {about.isError ? (
        <p className="form-error" role="alert">
          {errorMessage(about.error, "The version could not be loaded.")}
        </p>
      ) : null}

      <div className="st-about-columns">
        <section aria-label="Links" className="st-card st-links">
          <a href={GITHUB_URL} rel="noopener noreferrer" target="_blank">
            <GitHubIcon />
            <span>Source on GitHub</span>
            <span aria-hidden="true">↗</span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          <a href={ISSUES_URL} rel="noopener noreferrer" target="_blank">
            <span>Report a problem</span>
            <span aria-hidden="true">↗</span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </section>

        <div className="st-about-stack">
          <section aria-labelledby="st-version-details" className="st-card st-pad">
            <div className="st-about-head">
              <div>
                <h2 id="st-version-details">Version details</h2>
                <p className="st-row-description">Quote these if you ask for help.</p>
              </div>
              <button className="btn-primary" disabled={!data} onClick={copy} type="button">
                <CopyIcon />
                Copy details
              </button>
            </div>
            {copied === "done" ? (
              <p className="st-saved" role="status">
                Copied.
              </p>
            ) : null}
            {copied === "failed" ? (
              <p className="form-error" role="alert">
                Could not copy. Select the details and copy them by hand.
              </p>
            ) : null}
            <dl className="st-details">
              {details.map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd className={name === "Commit" ? "st-mono" : undefined}>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="st-updates" className="st-card st-pad">
            <h2 id="st-updates">Updates</h2>
            <p className="st-row-description">
              KukGrade does not look for updates by itself. Your administrator installs new
              versions, and this page shows the version in use.
            </p>
          </section>

          <section aria-labelledby="st-licence" className="st-card st-pad">
            <h2 id="st-licence">Licence</h2>
            <p className="st-row-description">
              To be decided. The terms will appear here, with a link to the full text.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
