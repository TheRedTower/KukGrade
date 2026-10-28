import { useAuth } from "./auth";
import { CopyDetailsButton, DetailsList } from "./AboutDetailsView";
import { versionDetails } from "./aboutDetails";
import { useAboutQuery } from "./queries";

/** Where to ask for help, and the details to send with the question. */
export function AboutSupport() {
  const data = useAboutQuery().data;
  const { user } = useAuth();
  const details = data
    ? versionDetails(data, [
        ["Your browser", navigator.userAgent],
        ...(user ? ([["Your role", user.role_display]] as [string, string][]) : []),
      ])
    : [];

  return (
    <>
      <header>
        <h2>Support</h2>
        <p className="st-row-description">
          Start with your own school's administrator: they know how KukGrade is set up.
        </p>
      </header>

      <div className="ab-layout">
        <div className="ab-main">
          <section aria-labelledby="ab-steps" className="st-card st-pad">
            <h2 id="ab-steps">Asking for help</h2>
            <ol className="ab-steps">
              <li>
                <span aria-hidden="true" className="ab-number">
                  1
                </span>
                <p>
                  <strong>Copy your details.</strong>
                  <br />
                  <span className="st-row-description">
                    They list the version and build you are using. They hold no student names or
                    results.
                  </span>
                </p>
              </li>
              <li>
                <span aria-hidden="true" className="ab-number">
                  2
                </span>
                <p>
                  <strong>Say what you were doing.</strong>
                  <br />
                  <span className="st-row-description">
                    What you clicked, what you expected and what happened. Never include a
                    student's name or results.
                  </span>
                </p>
              </li>
              <li>
                <span aria-hidden="true" className="ab-number">
                  3
                </span>
                <p>
                  <strong>Send it.</strong>
                  <br />
                  <span className="st-row-description">
                    Email the project, or open a public issue for anything that is not private.
                  </span>
                </p>
              </li>
            </ol>
          </section>

          {data ? (
            <section aria-label="Where to ask" className="st-card">
              <div className="ab-contact">
                <div>
                  <strong>Email support</strong>
                  <p className="st-row-description">Questions, help, and code of conduct reports.</p>
                </div>
                <a className="ab-button" href={`mailto:${data.support_email}`}>
                  {data.support_email}
                </a>
              </div>
              <div className="ab-contact">
                <div>
                  <strong>Report a problem or suggest a change</strong>
                  <p className="st-row-description">Public. Do not include student information.</p>
                </div>
                <a className="ab-button" href={data.issues_url} rel="noopener noreferrer" target="_blank">
                  Open an issue ↗<span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              </div>
              <div className="ab-contact">
                <div>
                  <strong>Report a security weakness</strong>
                  <p className="st-row-description">Private. Please do not open a public issue.</p>
                </div>
                <a className="ab-button" href={`mailto:${data.security_email}`}>
                  {data.security_email}
                </a>
              </div>
            </section>
          ) : null}
        </div>

        <section aria-labelledby="ab-your-details" className="st-card st-pad" style={{ flex: "1 1 20rem" }}>
          <h2 id="ab-your-details">Your details</h2>
          <p className="st-row-description">Quote these with your question.</p>
          <DetailsList columns={1} details={details} />
          <div style={{ marginTop: "1rem" }}>
            <CopyDetailsButton details={details} />
          </div>
        </section>
      </div>
    </>
  );
}
