import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { AuthUser } from "./api";
import {
  ABOUT,
  ABOUT_CREDITS,
  ADMINISTRATOR_CAPABILITIES,
  authUser,
  fetchSignedInAs,
  jsonResponse,
  signedInResponse,
} from "./appTestSupport";

const administrator = {
  ...authUser,
  ...ADMINISTRATOR_CAPABILITIES,
  role_display: "Administrator",
} satisfies AuthUser;

function visit(path: string) {
  window.history.replaceState({}, "", path);
}

/** Signed in, with some `/api/about/` answers replaced. */
function stubAbout(replacements: Record<string, unknown>, user: AuthUser = authUser) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => {
      const path = new URL(url, "http://localhost").pathname;
      return path in replacements ? jsonResponse(200, replacements[path]) : signedInResponse(url, user);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("About: the overview", () => {
  beforeEach(() => visit("/settings/about"));

  it("shows the version and what to quote when asking for help", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    const details = within(await screen.findByRole("region", { name: "Version details" }));
    expect(await details.findByText("Europe/London")).toBeVisible();
    expect(details.getByText("5198f1b")).toBeVisible();
    expect(details.getByText("Ready")).toBeVisible();
    expect(details.getAllByText("0.2.0")).toHaveLength(2);
    expect(screen.getByText(/does not look for updates by itself/)).toBeVisible();
  });

  it("names a release candidate by its number, in the page, the sidebar and the support text", async () => {
    const candidate = { ...ABOUT, release: "0.2.0-rc.4" };
    const signedIn = fetchSignedInAs(authUser);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/api/about/")
          ? jsonResponse(200, candidate)
          : signedIn(url),
      ),
    );

    render(<App />);

    const details = within(await screen.findByRole("region", { name: "Version details" }));
    expect(await details.findByText("0.2.0-rc.4")).toBeVisible();
    expect(screen.getByRole("link", { name: "KukGrade 0.2.0-rc.4" })).toBeInTheDocument();
  });

  it("takes the links from the server, each opening in a new tab", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    const links = within(await screen.findByRole("region", { name: "Links" }));
    expect(links.getByRole("link", { name: /Source on GitHub/ })).toHaveAttribute("href", ABOUT.repository_url);
    expect(links.getByRole("link", { name: /Release notes/ })).toHaveAttribute("href", ABOUT.releases_url);
    const issues = links.getByRole("link", { name: /Report a problem/ });
    expect(issues).toHaveAttribute("href", ABOUT.issues_url);
    expect(issues).toHaveAttribute("target", "_blank");
    expect(issues).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("names the licence and the copyright holder in the section list", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    const rail = within(await screen.findByRole("navigation", { name: "About sections" }));
    expect(await rail.findByText(/AGPL-3.0-only/)).toBeVisible();
    expect(rail.getByText(/Copyright © 2026 Example Owner/)).toBeVisible();
    for (const label of ["Overview", "Licence", "Code of conduct", "Security", "Support", "Credits"]) {
      expect(rail.getByRole("link", { name: label })).toBeVisible();
    }
  });

  it("copies the details to paste into a request for help", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Europe/London");
    await user.click(screen.getByRole("button", { name: "Copy details" }));

    expect(await screen.findByText("Copied.")).toBeVisible();
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain("Server: 0.2.0");
    expect(copied).toContain("Commit: 5198f1b");
    expect(copied).toContain("Club time zone: Europe/London");
    expect(copied).toContain("Database: Ready");
  });

  it("says so when the details cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        url.includes("/api/about/")
          ? jsonResponse(500, { error: { code: "server_error", message: "Server error." } })
          : signedInResponse(url, authUser),
      ),
    );

    render(<App />);

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy details" })).toBeDisabled();
  });

  it("shows an administrator the school's settings, and nobody else", async () => {
    stubAbout(
      { "/api/about/": { ...ABOUT, school: { club_name: "Riverside Kuk Sool Won", school_id_prefix: "456-7" } } },
      administrator,
    );

    const { unmount } = render(<App />);

    const school = within(await screen.findByRole("region", { name: "Your school" }));
    expect(school.getByText("Riverside Kuk Sool Won")).toBeVisible();
    expect(school.getByText("456-7")).toBeVisible();
    expect(school.getByText("Administrators only")).toBeVisible();
    unmount();

    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    render(<App />);
    await screen.findByRole("region", { name: "Version details" });
    expect(screen.queryByRole("region", { name: "Your school" })).not.toBeInTheDocument();
  });
});

describe("About: the licence", () => {
  beforeEach(() => visit("/settings/about/licence"));

  it("gives a short guide, then the licence file exactly as served", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Licence" })).toBeVisible();
    // The licence's own first lines name it.
    expect(await screen.findByText("GNU AFFERO GENERAL PUBLIC LICENSE, Version 3, 19 November 2007")).toBeVisible();
    expect(screen.getByRole("heading", { name: "In plain words" })).toBeVisible();
    expect(screen.getByText(/not legal advice/)).toBeVisible();
    const full = screen.getByRole("region", { name: "Full licence text" });
    expect(full).toHaveTextContent("TERMS AND CONDITIONS");
    expect(full).toHaveAttribute("tabindex", "0");
    expect(screen.getByText(ABOUT.copyright)).toBeVisible();
    expect(screen.getByRole("link", { name: /Get the source code/ })).toHaveAttribute("href", ABOUT.repository_url);
    expect(screen.getByRole("link", { name: /View on GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/example/kukgrade/blob/HEAD/LICENSE",
    );
  });
});

describe("About: the code of conduct", () => {
  beforeEach(() => visit("/settings/about/conduct"));

  it("shows the pledge in English and Korean, then the code as the repository holds it", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(<App />);

    const pledge = within(await screen.findByRole("region", { name: "The Kuk Sool Won Pledge" }));
    expect(pledge.getByText("First promise.")).toBeVisible();
    expect(pledge.getByText("첫째 맹세.")).toHaveAttribute("lang", "ko");

    const text = within(await screen.findByRole("article", { name: "Code of conduct text" }));
    // The file's own title is the page's, so its sections sit below the page heading.
    expect(text.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(text.getByRole("heading", { level: 3, name: "Our Pledge" })).toHaveAttribute("id", "our-pledge");

    const contents = within(screen.getByRole("navigation", { name: "Code of conduct, on this page" }));
    await user.click(contents.getByRole("button", { name: "Enforcement" }));
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe("About: security", () => {
  beforeEach(() => visit("/settings/about/security"));

  it("points a link to another file at the repository, and opens outside links in a new tab", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    const text = within(await screen.findByRole("article", { name: "Security text" }));
    expect(text.getByRole("link", { name: /the features/ })).toHaveAttribute(
      "href",
      "https://github.com/example/kukgrade/blob/HEAD/docs/features.md#roles",
    );
    const site = text.getByRole("link", { name: /the site/ });
    expect(site).toHaveAttribute("href", "https://example.org/");
    expect(site).toHaveAttribute("target", "_blank");
    const mail = text.getByRole("link", { name: "security" });
    expect(mail).toHaveAttribute("href", "mailto:security@example.org");
    expect(mail).not.toHaveAttribute("target");
  });

  it("says so when the document cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        url.includes("/documents/")
          ? jsonResponse(404, { error: { code: "not_found", message: "Not found." } })
          : signedInResponse(url, authUser),
      ),
    );

    render(<App />);

    expect(await screen.findByRole("alert")).toBeVisible();
  });
});

describe("About: support", () => {
  beforeEach(() => visit("/settings/about/support"));

  it("takes the contact addresses from the server", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    const where = within(await screen.findByRole("region", { name: "Where to ask" }));
    expect(where.getByRole("link", { name: ABOUT.support_email })).toHaveAttribute(
      "href",
      `mailto:${ABOUT.support_email}`,
    );
    expect(where.getByRole("link", { name: ABOUT.security_email })).toHaveAttribute(
      "href",
      `mailto:${ABOUT.security_email}`,
    );
    expect(where.getByRole("link", { name: /Open an issue/ })).toHaveAttribute("href", ABOUT.issues_url);
  });

  it("copies the version, the browser and the role, and no student data", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();

    render(<App />);

    const details = within(await screen.findByRole("region", { name: "Your details" }));
    expect(await details.findByText("Your role")).toBeVisible();
    expect(details.getByText("Instructor")).toBeVisible();
    await user.click(details.getByRole("button", { name: "Copy details" }));

    const copied = await navigator.clipboard.readText();
    expect(copied).toContain("Server: 0.2.0");
    expect(copied).toContain("Your browser: ");
    expect(copied).toContain("Your role: Instructor");
    expect(copied).not.toContain(authUser.email);
  });
});

describe("About: credits", () => {
  beforeEach(() => visit("/settings/about/credits"));

  it("lists the projects the server and the screens are built on, with their licences", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    const server = within(await screen.findByRole("region", { name: "The server" }));
    expect(server.getByRole("link", { name: /Django/ })).toHaveAttribute("href", "https://www.djangoproject.com/");
    expect(server.getByText("BSD-3-Clause")).toBeVisible();
    expect(server.getByText("A web framework.")).toBeVisible();

    const browser = within(screen.getByRole("region", { name: "The screens you use" }));
    // A project with no home page is named without a link.
    expect(browser.getByText("react")).toBeVisible();
    expect(browser.queryByRole("link")).not.toBeInTheDocument();

    const everything = screen.getByRole("link", { name: /Open the full list/ });
    expect(everything).toHaveAttribute("href", expect.stringMatching(/\/api\/about\/credits\/notices\/$/));
    expect(everything).toHaveAttribute("target", "_blank");
  });

  it("says so when this copy was not built with its credits", async () => {
    stubAbout({ "/api/about/credits/": { available: false, server: [], browser: [] } });

    render(<App />);

    expect(await screen.findByText(/was not packaged for release/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /Open the full list/ })).not.toBeInTheDocument();
  });

  it("leaves out the screens' table when there are none", async () => {
    stubAbout({ "/api/about/credits/": { ...ABOUT_CREDITS, browser: [] } });

    render(<App />);

    await screen.findByRole("region", { name: "The server" });
    expect(screen.queryByRole("region", { name: "The screens you use" })).not.toBeInTheDocument();
  });
});
