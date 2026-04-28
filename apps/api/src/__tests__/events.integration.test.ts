import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const API_BASE = process.env.API_BASE_URL || "http://localhost:4000";
const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://friendgroup:friendgroup@localhost:5432/friendgroup_dev";

let ownerToken = "";
let memberToken = "";
let groupId = "";
let eventId = "";

async function getDevToken(email: string): Promise<{ token: string; user: any }> {
  const response = await fetch(`${API_BASE}/auth/dev-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to get dev token: ${response.status} ${body}`);
  }

  return response.json() as Promise<{ token: string; user: any }>;
}

describe("Events integration", () => {
  beforeAll(async () => {
    const ownerResult = await getDevToken("owner@gem.dev");
    ownerToken = ownerResult.token;

    const memberResult = await getDevToken("member@gem.dev");
    memberToken = memberResult.token;

    // Fetch group from database
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      const result = await client.query<{ id: string }>(
        'SELECT id FROM "Group" LIMIT 1'
      );
      if (result.rows.length === 0) {
        throw new Error("No groups found in database for event tests");
      }
      groupId = result.rows[0].id;
    } finally {
      await client.end();
    }
  });

  it("POST /auth/dev-token returns token for seeded user", async () => {
    const response = await fetch(`${API_BASE}/auth/dev-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@gem.dev" }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as { token: string; user: any };
    expect(data.token).toBeDefined();
    expect(data.user.email).toBe("owner@gem.dev");
  });

  it("GET /events?groupId=... returns event list", async () => {
    const response = await fetch(`${API_BASE}/events?groupId=${groupId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as { events: any[] };
    expect(Array.isArray(data.events)).toBe(true);
  });

  it("POST /events creates event and verifies fields", async () => {
    const response = await fetch(`${API_BASE}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupId,
        title: "Integration Test Event",
        details: "Created by integration test",
        dateTime: new Date(Date.now() + 86400000).toISOString(),
        location: "Test Location",
      }),
    });

    expect(response.status).toBe(201);
    const data = (await response.json()) as { event: any };
    expect(data.event.title).toBe("Integration Test Event");
    expect(data.event.location).toBe("Test Location");
    eventId = data.event.id;
  });

  it("PATCH /events/:id updates event", async () => {
    const response = await fetch(`${API_BASE}/events/${eventId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Updated Integration Test Event",
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as { event: any };
    expect(data.event.title).toBe("Updated Integration Test Event");
  });

  it("POST /events/:id/rsvps creates RSVP and returns attendance counts", async () => {
    const rsvpResponse = await fetch(`${API_BASE}/events/${eventId}/rsvps`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "yes" }),
    });

    expect(rsvpResponse.status).toBe(201);

    const attendanceResponse = await fetch(
      `${API_BASE}/events/${eventId}/attendance`,
      {
        headers: { Authorization: `Bearer ${ownerToken}` },
      }
    );

    expect(attendanceResponse.status).toBe(200);
    const data = (await attendanceResponse.json()) as {
      counts: { yes: number; no: number; maybe: number };
    };
    expect(data.counts.yes).toBeGreaterThanOrEqual(1);
  });

  it("returns 403 when non-member tries to create event", async () => {
    // Create a fresh user token that's not a member of the group
    // We'll use the member token but try to create an event with a bogus groupId
    const response = await fetch(`${API_BASE}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${memberToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
        title: "Should Fail",
        dateTime: new Date().toISOString(),
      }),
    });

    expect(response.status).toBe(403);
  });

  it("DELETE /events/:id returns 204", async () => {
    // Create a temporary event to delete
    const createResponse = await fetch(`${API_BASE}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupId,
        title: "Event to Delete",
        dateTime: new Date(Date.now() + 86400000).toISOString(),
      }),
    });

    const created = (await createResponse.json()) as { event: any };

    const response = await fetch(`${API_BASE}/events/${created.event.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    expect(response.status).toBe(204);
  });
});
