import { afterEach } from "vitest";

import {
  calendarDaysAgo,
  currentYear,
  formatDateTime,
  formatSessionDate,
  formatShortDate,
  setClubTimeZone,
  todayIsoDate,
} from "./dates";

afterEach(() => setClubTimeZone(undefined));

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

// Whatever zone the browser is in (CI runs UTC and America/Los_Angeles), the
// club's zone decides what day it is and what time a moment was.
describe("the club's time zone", () => {
  // 10:30 UTC on 15 Oct is 23:30 in Auckland (NZDT, UTC+13) the same day,
  // and 11:30 on the 15th in London (BST).
  const lateAuckland = new Date("2026-10-15T11:30:00Z");

  it("decides what day it is", () => {
    setClubTimeZone("Pacific/Auckland");
    expect(todayIsoDate(lateAuckland)).toBe("2026-10-16");
    setClubTimeZone("Europe/London");
    expect(todayIsoDate(lateAuckland)).toBe("2026-10-15");
    expect(currentYear(new Date("2026-12-31T23:30:00Z"))).toBe(2026);
    setClubTimeZone("Pacific/Auckland");
    expect(currentYear(new Date("2026-12-31T23:30:00Z"))).toBe(2027);
  });

  it("shows a timestamp as the club's clock reads", () => {
    setClubTimeZone("Pacific/Auckland");
    expect(formatDateTime("2026-10-15T11:30:00Z")).toMatch(/^16 October 2026.*00:30$/);
    setClubTimeZone("America/Los_Angeles");
    expect(formatDateTime("2026-10-15T11:30:00Z")).toMatch(/^15 October 2026.*04:30$/);
  });

  it("never moves a date-only value", () => {
    for (const zone of ["Pacific/Auckland", "Pacific/Kiritimati", "America/Los_Angeles"]) {
      setClubTimeZone(zone);
      expect(formatShortDate("2026-10-05")).toBe("5 Oct 2026");
      expect(formatSessionDate("2027-06-01")).toBe("Tuesday, 1 June 2027");
    }
  });

  it("counts days in the club's zone, across a clock change", () => {
    setClubTimeZone("Europe/London");
    // The clocks went back on 25 October: that day has 25 hours.
    const now = new Date("2026-10-26T09:00:00Z");
    expect(calendarDaysAgo("2026-10-25T00:30:00Z", now)).toBe(1);
    expect(calendarDaysAgo("2026-10-24T22:30:00Z", now)).toBe(2);
    setClubTimeZone("Pacific/Auckland");
    expect(calendarDaysAgo("2026-10-25T10:30:00Z", new Date("2026-10-25T13:30:00Z"))).toBe(1);
  });

  it("falls back to the browser's zone for a name it does not know", () => {
    setClubTimeZone("Not/AZone");
    expect(formatShortDate("2026-10-05")).toBe("5 Oct 2026");
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
