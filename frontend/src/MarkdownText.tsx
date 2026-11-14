import Markdown from "react-markdown";

import { slug } from "./aboutSlug";

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

/**
 * An About document's text. Loaded on its own, as the Markdown reader is the
 * largest part of Settings and only the About documents need it.
 */
export function renderMarkdown(content: string, repositoryUrl: string) {
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
            <a
              href={target}
              rel={opensTab ? "noopener noreferrer" : undefined}
              target={opensTab ? "_blank" : undefined}
            >
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
