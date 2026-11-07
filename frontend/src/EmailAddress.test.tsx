import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmailAddress, EmailList } from "./EmailAddress";

describe("EmailAddress", () => {
  it("reads as the address, with break points after the @ and before each dot", () => {
    const { container } = render(<EmailAddress address="instructor@demo.example.com" />);
    expect(container.textContent).toBe("instructor@demo.example.com");
    expect(container.innerHTML).toBe("instructor@<wbr>demo<wbr>.example<wbr>.com");
  });

  it("lists several addresses separated by commas", () => {
    const { container } = render(<EmailList addresses={["a@x.org", "b@y.org"]} />);
    expect(container.textContent).toBe("a@x.org, b@y.org");
  });
});
