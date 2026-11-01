import { errorMessage } from "./api";
import { CopyDetailsButton, DetailsList } from "./AboutDetailsView";
import { versionDetails } from "./aboutDetails";
import { GitHubIcon } from "./Icons";
import { useAboutQuery } from "./queries";

/** What is running, and what to quote when asking for help. */
export function AboutOverview() {
  const about = useAboutQuery();
  const data = about.data;
  const details = data ? versionDetails(data) : [];

  return (
    <>
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
            Grading management for Kuk Sool Won schools: students, syllabus, gradings and
            promotions. Free and open source, and run by your own school.
          </p>
        </div>
        <p className="st-version-tile">
          <span>Version</span>
          <strong>{data?.release ?? "…"}</strong>
        </p>
      </section>

      {about.isError ? (
        <p className="form-error" role="alert">
          {errorMessage(about.error, "The version could not be loaded.")}
        </p>
      ) : null}

      <section aria-labelledby="st-version-details" className="st-card st-pad">
        <div className="ab-head">
          <div>
            <h2 id="st-version-details">Version details</h2>
            <p className="st-row-description">Quote these if you ask for help.</p>
          </div>
          <CopyDetailsButton details={details} />
        </div>
        <DetailsList details={details} />
      </section>

      {data?.school ? (
        <section aria-labelledby="st-school" className="st-card">
          <div className="st-row">
            <div className="st-row-label">
              <h2 id="st-school" className="st-row-title">
                Your school
              </h2>
              <p className="st-row-description">Set by whoever runs KukGrade, so it is only shown here.</p>
            </div>
            <span className="ab-badge">Administrators only</span>
          </div>
          <dl className="ab-facts">
            <div>
              <dt>Club name</dt>
              <dd>{data.school.club_name}</dd>
            </div>
            <div>
              <dt>Student ID prefix</dt>
              <dd className="st-mono">{data.school.school_id_prefix}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{data.time_zone}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {data ? (
        <section aria-label="Links" className="st-card st-links">
          <a href={data.repository_url} rel="noopener noreferrer" target="_blank">
            <GitHubIcon />
            <span>Source on GitHub</span>
            <span aria-hidden="true" className="st-link-arrow">
              ↗
            </span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          <a href={data.releases_url} rel="noopener noreferrer" target="_blank">
            <span>Release notes</span>
            <span aria-hidden="true" className="st-link-arrow">
              ↗
            </span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          <a href={data.issues_url} rel="noopener noreferrer" target="_blank">
            <span>Report a problem</span>
            <span aria-hidden="true" className="st-link-arrow">
              ↗
            </span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </section>
      ) : null}

      <section aria-labelledby="st-updates" className="st-card st-pad">
        <h2 id="st-updates">Updates</h2>
        <p className="st-row-description">
          KukGrade does not look for updates by itself. Your administrator installs new versions,
          and this page shows the version in use.
        </p>
      </section>
    </>
  );
}
