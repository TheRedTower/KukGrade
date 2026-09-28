import { calendarDaysAgo, formatSessionDate, formatShortDate, todayIsoDate } from "./dates";

describe("todayIsoDate", () => {
  it("is the local calendar date, not the UTC one", () => {
    // 23:30 local on 15 October: a UTC conversion would roll over to the
    // 16th anywhere west of UTC (CI runs this suite in America/Los_Angeles).
    expect(todayIsoDate(new Date(2026, 9, 15, 23, 30))).toBe("2026-10-15");
  });

  it("pads single-digit months and days", () => {
    expect(todayIsoDate(new Date(2027, 0, 5, 9, 0))).toBe("2027-01-05");
  });
});

describe("formatSessionDate", () => {
  it("reads an API date as that calendar day, whatever the time zone", () => {
    expect(formatSessionDate("2027-06-01")).toBe("Tuesday, 1 June 2027");
  });

  it("shows anything unparseable as given", () => {
    expect(formatSessionDate("")).toBe("");
    expect(formatSessionDate("soon")).toBe("soon");
  });
});

describe("formatShortDate", () => {
  it("formats a date-only value as that calendar day", () => {
    expect(formatShortDate("2026-10-05")).toBe("5 Oct 2026");
  });

  it("uses the fallback for a missing value", () => {
    expect(formatShortDate(null)).toBe("—");
    expect(formatShortDate(undefined, "")).toBe("");
  });
});

describe("calendarDaysAgo", () => {
  const now = new Date(2026, 9, 15, 0, 30);

  it("counts local calendar days, not 24-hour periods", () => {
    expect(calendarDaysAgo("2026-10-15", now)).toBe(0);
    expect(calendarDaysAgo("2026-10-14", now)).toBe(1);
    expect(calendarDaysAgo(new Date(2026, 9, 14, 23, 50).toISOString(), now)).toBe(1);
  });

  it("is null for a value it cannot parse", () => {
    expect(calendarDaysAgo("soon", now)).toBeNull();
    expect(calendarDaysAgo(null, now)).toBeNull();
  });
});
