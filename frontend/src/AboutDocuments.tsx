import Markdown from "react-markdown";
import { Link } from "react-router-dom";

import { errorMessage } from "./api";
import { useAboutDocumentQuery, useAboutQuery, usePledgeQuery } from "./queries";
import { buttonClass } from "./buttonClass";

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

/** The section headings of a Markdown document, for its contents list. */
function sections(content: string): { id: string; text: string }[] {
  return [...content.matchAll(/^##\s+(.+?)\s*#*\s*$/gm)].map((match) => ({
    id: slug(match[1]),
    text: match[1],
  }));
}

function MarkdownText({ content, repositoryUrl }: { content: string; repositoryUrl: string }) {
  // The page already carries the document's title, so the file's own is left out.
  const body = content.replace(/^\s*#\s+.*\n/, "");
  return (
    <Markdown
      components={{
        // The page's h2 is the document's title, so its headings sit below it.
        h2: ({ children }) => (
          <h3 id={slug(textOf(children))} tabIndex={-1}>
            {children}
          </h3>
        ),
        h3: ({ children }) => (
          <h4 id={slug(textOf(children))} tabIndex={-1}>
            {children}
          </h4>
        ),
        a: ({ href = "", children }) => {
          // A link to another file in the repository points at it on GitHub.
          const target =
            EXTERNAL.test(href) || href.startsWith("#")
              ? href
              : `${repositoryUrl}/blob/HEAD/${href.replace(/^\.?\//, "")}`;
          const opensTab = /^https?:/i.test(target);
          return (
            <a href={target} rel={opensTab ? "noopener noreferrer" : undefined} target={opensTab ? "_blank" : undefined}>
              {children}
              {opensTab ? <span className="visually-hidden"> (opens in a new tab)</span> : null}
            </a>
          );
        },
      }}
    >
      {body}
    </Markdown>
  );
}

function DocumentHeader({ title, subtitle, sourceUrl }: { title: string; subtitle?: string; sourceUrl?: string }) {
  return (
    <header className="ab-head">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p className="st-row-description">{subtitle}</p> : null}
      </div>
      {sourceUrl ? (
        <a className={buttonClass({ variant: "secondary" })} href={sourceUrl} rel="noopener noreferrer" target="_blank">
          View on GitHub ↗<span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      ) : null}
    </header>
  );
}

function Problem({ error }: { error: unknown }) {
  return (
    <p className="form-error" role="alert">
      {errorMessage(error, "This page could not be loaded.")}
    </p>
  );
}

function ReadableDocument({ slugName, label }: { slugName: string; label: string }) {
  const query = useAboutDocumentQuery(slugName);
  const repositoryUrl = useAboutQuery().data?.repository_url ?? "";
  const doc = query.data;
  const contents = doc ? sections(doc.content) : [];

  function jump(id: string) {
    const heading = document.getElementById(id);
    if (!heading) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    heading.scrollIntoView({ behavior: calm ? "auto" : "smooth" });
    // So the next Tab carries on from the section that was jumped to.
    heading.focus({ preventScroll: true });
  }

  return (
    <>
      {query.isError ? <Problem error={query.error} /> : null}
      {doc ? (
        <div className="ab-doc-columns">
          {contents.length > 0 ? (
            <nav aria-label={`${label}, on this page`} className="st-card ab-contents">
              <p>On this page</p>
              {contents.map((entry) => (
                <button key={entry.id} onClick={() => jump(entry.id)} type="button">
                  {entry.text}
                </button>
              ))}
            </nav>
          ) : null}
          <article aria-label={`${label} text`} className="st-card ab-prose">
            <MarkdownText content={doc.content} repositoryUrl={repositoryUrl} />
          </article>
        </div>
      ) : null}
    </>
  );
}

/** How to report a weakness, and how the app protects student data. */
export function AboutSecurity() {
  const doc = useAboutDocumentQuery("security").data;
  return (
    <>
      <DocumentHeader
        sourceUrl={doc?.source_url}
        subtitle="How to report a weakness privately, and how KukGrade protects student data."
        title="Security"
      />
      <ReadableDocument label="Security" slugName="security" />
    </>
  );
}

/** The Kuk Sool Won pledge, then the project's own code of conduct. */
export function AboutConduct() {
  const pledge = usePledgeQuery();
  const doc = useAboutDocumentQuery("code-of-conduct").data;

  return (
    <>
      <DocumentHeader
        sourceUrl={doc?.source_url}
        subtitle="How members of this school and project treat each other."
        title="Code of conduct"
      />

      {pledge.isError ? <Problem error={pledge.error} /> : null}
      {pledge.data ? (
        <section aria-labelledby="ab-pledge" className="st-card st-pad">
          <p className="st-eyebrow">Kuk Sool Won</p>
          <h2 id="ab-pledge">{pledge.data.title}</h2>
          <ol className="ab-pledge">
            {pledge.data.points.map((point, index) => (
              <li key={point.english}>
                <span aria-hidden="true" className="ab-number">
                  {index + 1}
                </span>
                <p>{point.english}</p>
                <p className="ab-pledge-korean" lang="ko">
                  {point.korean}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <ReadableDocument label="Code of conduct" slugName="code-of-conduct" />
    </>
  );
}

/** The licence: a short plain-words guide, then the full text. */
export function AboutLicence() {
  const query = useAboutDocumentQuery("licence");
  const about = useAboutQuery().data;
  const doc = query.data;
  // The licence's own first lines name it, so the page never repeats them.
  const name = doc?.content
    .split("\n")
    .slice(0, 2)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <DocumentHeader sourceUrl={doc?.source_url} subtitle={name} title="Licence" />
      {query.isError ? <Problem error={query.error} /> : null}

      <section aria-labelledby="ab-plain" className="st-card st-pad">
        <h2 id="ab-plain">In plain words</h2>
        <p className="st-row-description">
          KukGrade is free software. This is a short guide, not legal advice: the full licence
          below is the only text that counts.
        </p>
        <div className="ab-three">
          <div>
            <h3>You may</h3>
            <ul>
              <li>Use KukGrade for your school, at no cost.</li>
              <li>Read how it works, and change it.</li>
              <li>Share it with other schools.</li>
            </ul>
          </div>
          <div>
            <h3>You must</h3>
            <ul>
              <li>Keep the licence and copyright notices.</li>
              <li>Share the source of a changed version under this same licence.</li>
              <li>Offer that source to people who use your changed version over a network.</li>
            </ul>
          </div>
          <div>
            <h3>There is no</h3>
            <ul>
              <li>Warranty. It is provided as it is.</li>
              <li>Liability for problems it causes.</li>
            </ul>
          </div>
        </div>
        <div className="ab-actions">
          {about ? (
            <a className={buttonClass({ variant: "primary" })} href={about.repository_url} rel="noopener noreferrer" target="_blank">
              Get the source code ↗<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          ) : null}
        </div>
        {about ? <p className="st-row-description" style={{ marginTop: "0.75rem" }}>{about.copyright}</p> : null}
      </section>

      {doc ? (
        <section aria-labelledby="ab-full" className="st-card st-pad">
          <h2 id="ab-full">Full licence</h2>
          <p className="st-row-description">The licence file that ships with this version.</p>
          {/* A scrolling box has to be reachable by keyboard to be read. */}
          <pre aria-label="Full licence text" className="ab-licence-text" role="region" tabIndex={0}>
            {doc.content}
          </pre>
        </section>
      ) : null}

      <p className="ab-note">
        Not sure what the licence means for your school? Ask on the{" "}
        <Link to="/settings/about/support">Support</Link> page. The project cannot give legal advice.
      </p>
    </>
  );
}
