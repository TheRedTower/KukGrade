import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { errorMessage } from "./api";
import { CopyDetailsButton, DetailsList } from "./AboutDetailsView";
import { versionDetails } from "./aboutDetails";
import { GitHubIcon } from "./Icons";
import { useAboutQuery } from "./queries";
import { ExternalLink } from "./ExternalLink";

/** What is running, and what to quote when asking for help. */
export function AboutOverview() {
  const about = useAboutQuery();
  const data = about.data;
  const details = data ? versionDetails(data) : [];

  return (
    <>
      <section aria-labelledby="st-about-hero" className="card card--flush st-hero">
        <span aria-hidden="true" className="st-hero-mark">
          K
        </span>
        <div className="st-hero-text">
          <h2 id="st-about-hero">
            Kuk<span className="st-accent">Grade</span>
          </h2>
          <p className="st-eyebrow eyebrow--muted">People · Progress · Purpose</p>
          <p className="st-row-description subtext">
            Grading management for Kuk Sool Won schools: students, syllabus, gradings and
            promotions. Free and open source, and run by your own school.
          </p>
        </div>
        <p className="st-version-tile">
          <span className="eyebrow--muted">Version</span>
          <strong className="stat__value">{data?.release ?? "…"}</strong>
        </p>
      </section>

      {about.isError ? (
        <Alert>
          {errorMessage(about.error, "The version could not be loaded.")}
        </Alert>
      ) : null}

      <section aria-labelledby="st-version-details" className="card stack">
        <div className="action-row">
          <div>
            <h2 id="st-version-details">Version details</h2>
            <p className="st-row-description subtext">Quote these if you ask for help.</p>
          </div>
          <CopyDetailsButton details={details} />
        </div>
        <DetailsList details={details} />
      </section>

      {data?.school ? (
        <section aria-labelledby="st-school" className="card card--flush">
          <div className="st-row">
            <div className="st-row-label">
              <h2 id="st-school" className="st-row-title item-title">
                Your school
              </h2>
              <p className="st-row-description subtext">Set by whoever runs KukGrade, so it is only shown here.</p>
            </div>
            <Badge tone="info">Administrators only</Badge>
          </div>
          <dl className="facts-list facts-list--inset">
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
        <section aria-label="Links" className="card card--flush st-links">
          <ExternalLink href={data.repository_url}>
            <GitHubIcon />
            <span>Source on GitHub</span>
            <span aria-hidden="true" className="st-link-arrow">
              ↗
            </span>
          </ExternalLink>
          <ExternalLink href={data.releases_url}>
            <span>Release notes</span>
            <span aria-hidden="true" className="st-link-arrow">
              ↗
            </span>
          </ExternalLink>
          <ExternalLink href={data.issues_url}>
            <span>Report a problem</span>
            <span aria-hidden="true" className="st-link-arrow">
              ↗
            </span>
          </ExternalLink>
        </section>
      ) : null}

      <section aria-labelledby="st-updates" className="card">
        <h2 id="st-updates">Updates</h2>
        <p className="st-row-description subtext">
          KukGrade does not look for updates by itself. Your administrator installs new versions,
          and this page shows the version in use.
        </p>
      </section>
    </>
  );
}
