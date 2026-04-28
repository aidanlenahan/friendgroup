import { describe, expect, it } from "vitest";
import { buildGoogleCalendarLink, buildIcsCalendar } from "../lib/calendar.js";

describe("calendar domain helpers", () => {
  const event = {
    id: "evt_phase9",
    title: "Board Games, Pizza; Planning",
    details: "Bring snacks\\nBring controllers",
    dateTime: new Date("2026-04-06T18:30:00.000Z"),
    updatedAt: new Date("2026-04-06T17:00:00.000Z"),
  };

  it("builds ICS output with escaped content and event links", () => {
    const result = buildIcsCalendar([event], {
      calendarName: "Demo GEM",
      webBaseUrl: "https://gem.app/",
      defaultDurationMinutes: 90,
    });

    expect(result).toContain("BEGIN:VCALENDAR");
    expect(result).toContain("UID:evt_phase9@gem.dev");
    expect(result).toContain("SUMMARY:Board Games\\, Pizza\\; Planning");
    expect(result).toContain("DESCRIPTION:Bring snacks\\\\nBring controllers");
    expect(result).toContain("Open in GEM:");
    expect(result).toContain("https://gem.app/events/evt_phase9");
    expect(result).toContain("DTEND:20260406T200000Z");
    expect(result).toContain("END:VCALENDAR");
  });

  it("builds Google Calendar deep links with event details", () => {
    const result = buildGoogleCalendarLink(event, "https://gem.app", 90);
    const url = new URL(result);

    expect(url.origin).toBe("https://calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("dates")).toBe(
      "20260406T183000Z/20260406T200000Z"
    );
    expect(url.searchParams.get("details")).toContain(
      "Open in GEM: https://gem.app/events/evt_phase9"
    );
  });
});