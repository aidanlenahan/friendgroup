export type CalendarEventInput = {
  id: string;
  title: string;
  details?: string | null;
  dateTime: Date;
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
    parts.push(`Open in Friendgroup: ${link}`);
  }

  return parts.join("\n\n");
}

function buildEventBlock(
  event: CalendarEventInput,
  webBaseUrl: string | undefined,
  defaultDurationMinutes: number
) {
  const start = event.dateTime;
  const end = new Date(start.getTime() + defaultDurationMinutes * 60 * 1000);
  const uid = `${event.id}@friendgroup.dev`;
  const summary = escapeIcsText(event.title);
  const description = escapeIcsText(eventDescription(event, webBaseUrl));

  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toUtcIcsDate(event.updatedAt)}`,
    `LAST-MODIFIED:${toUtcIcsDate(event.updatedAt)}`,
    `DTSTART:${toUtcIcsDate(start)}`,
    `DTEND:${toUtcIcsDate(end)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT",
  ];
}

export function buildIcsCalendar(
  events: CalendarEventInput[],
  options: BuildCalendarOptions
) {
  const defaultDurationMinutes = options.defaultDurationMinutes ?? 120;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Friendgroup//Calendar//EN",
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
  return `${lines.join("\r\n")}\r\n`;
}

export function buildGoogleCalendarLink(
  event: CalendarEventInput,
  webBaseUrl?: string,
  defaultDurationMinutes = 120
) {
  const start = event.dateTime;
  const end = new Date(start.getTime() + defaultDurationMinutes * 60 * 1000);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toUtcIcsDate(start)}/${toUtcIcsDate(end)}`,
  });

  const details = eventDescription(event, webBaseUrl);
  if (details) {
    params.set("details", details);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
