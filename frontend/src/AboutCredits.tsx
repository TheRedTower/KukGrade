import { creditsNoticesUrl, errorMessage, type Credit } from "./api";
import { useCreditsQuery } from "./queries";
import { buttonClass } from "./buttonClass";
import { ResponsiveTable } from "./ResponsiveTable";

function CreditsTable({ credits, label }: { credits: Credit[]; label: string }) {
  return (
    <ResponsiveTable
      label={label}
      flush
      rows={credits}
      rowKey={(credit) => credit.name}
      columns={[
        {
          key: "project",
          header: "Project",
          primary: true,
          render: (credit) => (
            <>
              {credit.homepage ? (
                <a className="ab-credit-link" href={credit.homepage} rel="noopener noreferrer" target="_blank">
                  {credit.name}
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : (
                <strong>{credit.name}</strong>
              )}
              <br />
              <span className="st-row-description">{credit.version}</span>
            </>
          ),
        },
        { key: "summary", header: "What it is", render: (credit) => credit.summary },
        { key: "licence", header: "Licence", render: (credit) => credit.licence },
      ]}
    />
  );
}

/** The open source projects KukGrade is built on, as written when it was built. */
export function AboutCredits() {
  const query = useCreditsQuery();
  const credits = query.data;

  return (
    <>
      <header>
        <h2>Credits</h2>
        <p className="st-row-description">
          KukGrade stands on the work of many open source projects. This list is written when each
          version is built, so it matches what is running.
        </p>
      </header>

      {query.isError ? (
        <p className="form-error" role="alert">
          {errorMessage(query.error, "The credits could not be loaded.")}
        </p>
      ) : null}

      {credits && !credits.available ? (
        <p className="ab-note">
          This copy of KukGrade was not packaged for release, so it has no credits list. Releases
          have one.
        </p>
      ) : null}

      {credits?.available ? (
        <>
          <section aria-labelledby="ab-server" className="st-card">
            <div className="st-row">
              <h2 id="ab-server" className="st-row-title">
                The server
              </h2>
            </div>
            <CreditsTable credits={credits.server} label="Server projects" />
          </section>

          {credits.browser.length > 0 ? (
            <section aria-labelledby="ab-browser" className="st-card">
              <div className="st-row">
                <h2 id="ab-browser" className="st-row-title">
                  The screens you use
                </h2>
              </div>
              <CreditsTable credits={credits.browser} label="Screen projects" />
            </section>
          ) : null}

          <section aria-labelledby="ab-all" className="st-card st-pad">
            <div className="ab-head">
              <div>
                <h2 id="ab-all">Everything else</h2>
                <p className="st-row-description">
                  Every other Python and browser package, with its licence and copyright notice, in one file.
                </p>
              </div>
              <a className={buttonClass({ variant: "secondary" })} href={creditsNoticesUrl()} rel="noopener noreferrer" target="_blank">
                Open the full list<span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
