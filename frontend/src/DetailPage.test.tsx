import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { DetailPage } from "./DetailPage";
import { Progress } from "./Progress";

function renderPage(actions?: React.ReactNode) {
  render(
    <MemoryRouter>
      <DetailPage
        actions={actions}
        back={{ to: "/imports/1/people", label: "People" }}
        eyebrow="Past gradings · Step 3 of 5"
        progress={<Progress done={2} total={5} what="people sorted" />}
        status="Saved"
        testId="detail"
        title="Kai Park"
      >
        <p>Three gradings</p>
      </DetailPage>
    </MemoryRouter>,
  );
}

describe("DetailPage", () => {
  it("is one thing on a page of its own: its name, the way back, where it sits and how far", () => {
    renderPage(<button type="button">Save</button>);
    const page = screen.getByRole("region", { name: "Kai Park" });
    expect(page).toBe(screen.getByTestId("detail"));
    expect(screen.getByRole("link", { name: /People/ })).toHaveAttribute("href", "/imports/1/people");
    expect(screen.getByText("Past gradings · Step 3 of 5")).toBeVisible();
    expect(screen.getByText("2 of 5 people sorted")).toBeVisible();
    expect(screen.getByText("Three gradings")).toBeVisible();
  });

  it("keeps its primary action in the bar at the foot", () => {
    renderPage(<button type="button">Save</button>);
    const bar = screen.getByRole("button", { name: "Save" }).closest(".action-bar");
    expect(bar).not.toBeNull();
    expect(bar).toHaveTextContent("Saved");
  });

  it("has no bar when there is nothing to do", () => {
    renderPage();
    expect(document.querySelector(".action-bar")).toBeNull();
  });
});
