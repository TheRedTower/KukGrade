import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SearchField } from "./SearchField";

/** A list's search held by its parent, as the address holds it. */
function Held({ onSearch }: { onSearch: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <SearchField
        label="Search"
        value={value}
        onChange={(next) => {
          onSearch(next);
          setValue(next);
        }}
      />
      <button type="button" onClick={() => setValue("")}>
        Clear
      </button>
    </>
  );
}

describe("SearchField", () => {
  it("hands what was typed on once, when typing pauses", async () => {
    const onSearch = vi.fn();
    render(<Held onSearch={onSearch} />);

    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "Mia");
    expect(onSearch).not.toHaveBeenCalled();
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));

    expect(onSearch.mock.calls).toEqual([["Mia"]]);
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });

  it("shows a value changed from outside, and can be typed again after", async () => {
    const onSearch = vi.fn();
    render(<Held onSearch={onSearch} />);
    const box = screen.getByRole("searchbox", { name: "Search" });

    await userEvent.type(box, "Mia");
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(box).toHaveValue("");
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(box).toHaveValue("");

    await userEvent.type(box, "Mia");
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(onSearch.mock.calls).toEqual([["Mia"], ["Mia"]]);
  });
});
