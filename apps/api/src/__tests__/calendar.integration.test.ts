import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

type IdRow = {
  event_id: string;
  group_id: string;
};

const API_BASE = process.env.API_BASE_URL || "http://localhost:4000";
const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://friendgroup:friendgroup@localhost:5432/friendgroup_dev";

let token = "";
let eventId = "";
let groupId = "";

async function getDevToken(email: string) {
  const response = await fetch(`${API_BASE}/auth/dev-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to get dev token: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { token: string };
  return data.token;
}

describe("Phase 8 calendar integration", () => {
  beforeAll(async () => {
    token = await getDevToken("owner@friendgroup.dev");

    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      const result = await client.query<IdRow>(
        'SELECT e.id as event_id, e."groupId" as group_id FROM "Event" e ORDER BY e."createdAt" DESC LIMIT 1'
      );

      if (result.rows.length === 0) {
        throw new Error("No events found in database for calendar tests");
      }

      eventId = result.rows[0].event_id;
      groupId = result.rows[0].group_id;
    } finally {
      await client.end();
    }
  });

  it("serves single-event ICS export", async () => {
    const response = await fetch(`${API_BASE}/events/${eventId}/calendar.ics`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") || "").toContain("text/calendar");

    const body = await response.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain(`UID:${eventId}@friendgroup.dev`);
  });

  it("serves Google Calendar deep-link payload", async () => {
    const response = await fetch(
      `${API_BASE}/events/${eventId}/calendar/google-link`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      provider: string;
      url: string;
      eventId: string;
    };

    expect(data.provider).toBe("google");
    expect(data.eventId).toBe(eventId);
    expect(data.url).toContain("https://calendar.google.com/calendar/render?");
    expect(data.url).toContain("action=TEMPLATE");
  });

  it("serves group ICS feed and exposes sync headers after webhook", async () => {
    const webhookResponse = await fetch(`${API_BASE}/calendar/sync/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId,
        eventId,
        reason: "manual",
      }),
    });

    expect(webhookResponse.status).toBe(202);

    const response = await fetch(`${API_BASE}/groups/${groupId}/calendar.ics`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") || "").toContain("text/calendar");
    expect(response.headers.get("x-friendgroup-calendar-revision")).toBeTruthy();
    expect(response.headers.get("x-friendgroup-calendar-last-synced-at")).toBeTruthy();

    const body = await response.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("BEGIN:VEVENT");
  });
});
