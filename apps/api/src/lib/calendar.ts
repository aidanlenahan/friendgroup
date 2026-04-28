export type CalendarEventInput = {
  id: string;
  title: string;
  details?: string | null;
  dateTime: Date;
  endsAt?: Date | null;
  location?: string | null;
  updatedAt: Date;
};

type BuildCalendarOptions = {
  calendarName: string;
  webBaseUrl?: string;
  defaultDurationMinutes?: number;
};

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function toUtcIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * RFC 5545 §3.1 — fold long content lines at 75 octets.
 * Each continuation line must start with a single HTAB or SPACE.
 */
function foldLine(line: string): string {
  const MAX = 75;
  if (line.length <= MAX) return line;
  let result = "";
  let remaining = line;
  // First chunk: up to 75 chars
  result += remaining.slice(0, MAX);
  remaining = remaining.slice(MAX);
  // Subsequent chunks: 74 chars each (1 char used by the leading space)
  while (remaining.length > 0) {
    result += "\r\n " + remaining.slice(0, 74);
    remaining = remaining.slice(74);
  }
  return result;
}

function eventLink(eventId: string, webBaseUrl?: string) {
  if (!webBaseUrl) {
    return null;
  }

  const base = webBaseUrl.replace(/\/$/, "");
  return `${base}/events/${eventId}`;
}

function eventDescription(event: CalendarEventInput, webBaseUrl?: string) {
  const parts: string[] = [];

  if (event.details) {
    parts.push(event.details);
  }

  const link = eventLink(event.id, webBaseUrl);
  if (link) {
    parts.push(`Open in Gem: ${link}`);
  }

  return parts.join("\n\n");
}

function buildEventBlock(
  event: CalendarEventInput,
  webBaseUrl: string | undefined,
  defaultDurationMinutes: number
) {
  const start = event.dateTime;
  const end = event.endsAt ?? new Date(start.getTime() + defaultDurationMinutes * 60 * 1000);
  const uid = `${event.id}@gem.dev`;
  const summary = escapeIcsText(event.title);
  const description = escapeIcsText(eventDescription(event, webBaseUrl));
  const link = eventLink(event.id, webBaseUrl);

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toUtcIcsDate(event.updatedAt)}`,
    `LAST-MODIFIED:${toUtcIcsDate(event.updatedAt)}`,
    `DTSTART:${toUtcIcsDate(start)}`,
    `DTEND:${toUtcIcsDate(end)}`,
    `SEQUENCE:0`,
    `SUMMARY:${summary}`,
  ];

  if (description) {
    lines.push(`DESCRIPTION:${description}`);
  }

  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }

  if (link) {
    lines.push(`URL:${link}`);
  }

  lines.push("END:VEVENT");

  return lines;
}

export function buildIcsCalendar(
  events: CalendarEventInput[],
  options: BuildCalendarOptions
) {
  const defaultDurationMinutes = options.defaultDurationMinutes ?? 120;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gem//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
  ];

  for (const event of events) {
    lines.push(
      ...buildEventBlock(event, options.webBaseUrl, defaultDurationMinutes)
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function buildGoogleCalendarLink(
  event: CalendarEventInput,
  webBaseUrl?: string,
  defaultDurationMinutes = 120
) {
  const start = event.dateTime;
  const end = event.endsAt ?? new Date(start.getTime() + defaultDurationMinutes * 60 * 1000);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toUtcIcsDate(start)}/${toUtcIcsDate(end)}`,
  });

  const details = eventDescription(event, webBaseUrl);
  if (details) {
    params.set("details", details);
  }

  if (event.location) {
    params.set("location", event.location);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

