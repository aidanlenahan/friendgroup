import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, Socket } from "socket.io-client";
import { Client } from "pg";

type TokenResponse = {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

type SeedRow = {
  group_id: string;
  owner_id: string;
  admin_id: string;
  member_id: string;
  tag_id: string;
};

type EventResponse = {
  event: {
    id: string;
    title: string;
    details: string | null;
    groupId: string;
    tags: Array<{ id: string; name: string }>;
  };
};

type MessagePayload = {
  id: string;
  content: string;
  pinned: boolean;
  eventId: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

const API_BASE = process.env.API_BASE_URL || "http://localhost:4000";
const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://gem:gem@localhost:5432/gem_dev";

let ownerToken = "";
let memberToken = "";
let groupId = "";
let tagId = "";
let memberUserId = "";
let eventId = "";
let createdMessageId = "";

async function getDevToken(email: string) {
  const response = await fetch(`${API_BASE}/auth/dev-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as TokenResponse;
}

async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  expectedStatus = 200
) {
  const response = await fetch(`${API_BASE}${path}`, init);
  const text = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus} for ${path}, got ${response.status}: ${text}`);
  }

  return text ? (JSON.parse(text) as T) : (null as T);
}

async function connectSocket(token: string) {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = io(API_BASE, {
      transports: ["websocket"],
      auth: { token },
      timeout: 10000,
    });

    const onConnect = () => {
      cleanup();
      resolve(socket);
    };

    const onError = (error: Error) => {
      cleanup();
      socket.close();
      reject(error);
    };

    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}

async function onceEvent<T>(socket: Socket, eventName: string) {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for socket event '${eventName}'`));
    }, 10000);

    const onValue = (value: T) => {
      cleanup();
      resolve(value);
    };

    const onError = (value: unknown) => {
      cleanup();
      reject(new Error(`Socket error while waiting for '${eventName}': ${JSON.stringify(value)}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off(eventName, onValue);
      socket.off("error", onError);
    };

    socket.on(eventName, onValue);
    socket.on("error", onError);
  });
}

describe("Phase 9 API integration and smoke coverage", () => {
  beforeAll(async () => {
    const owner = await getDevToken("owner@gem.dev");
    const member = await getDevToken("member@gem.dev");

    ownerToken = owner.token;
    memberToken = member.token;

    const client = new Client({ connectionString: DB_URL });
    await client.connect();

    try {
      const result = await client.query<SeedRow>(
        `
          SELECT
            g.id AS group_id,
            owner_user.id AS owner_id,
            admin_user.id AS admin_id,
            member_user.id AS member_id,
            t.id AS tag_id
          FROM "Group" g
          JOIN "User" owner_user ON owner_user.email = 'owner@gem.dev'
          JOIN "User" admin_user ON admin_user.email = 'admin@gem.dev'
          JOIN "User" member_user ON member_user.email = 'member@gem.dev'
          JOIN "Tag" t ON t."groupId" = g.id
          WHERE g.name = 'Demo Gem'
          ORDER BY t.name ASC
          LIMIT 1
        `
      );

      if (result.rows.length === 0) {
        throw new Error("Seed data not found for Phase 9 integration tests");
      }

      groupId = result.rows[0].group_id;
      tagId = result.rows[0].tag_id;
      memberUserId = result.rows[0].member_id;
    } finally {
      await client.end();
    }
  });

  afterAll(async () => {
    if (!eventId) {
      return;
    }

    const response = await fetch(`${API_BASE}/events/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    if (response.status !== 204 && response.status !== 404) {
      throw new Error(`Cleanup failed for event ${eventId}: ${response.status}`);
    }
  });

  it("covers event CRUD, RSVP, chat, notification preferences, and smoke flow", async () => {
    const uniqueSuffix = Date.now();

    const createPayload = {
      groupId,
      title: `Phase 9 Smoke Event ${uniqueSuffix}`,
      details: "Created by integration test",
      dateTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      tagIds: [tagId],
    };

    const created = await fetchJson<EventResponse>(
      "/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createPayload),
      },
      201
    );

    eventId = created.event.id;
    expect(created.event.groupId).toBe(groupId);
    expect(created.event.tags.map((tag) => tag.id)).toContain(tagId);

    const listed = await fetchJson<{ events: Array<{ id: string; title: string }> }>(
      `/events?groupId=${groupId}`,
      { headers: { Authorization: `Bearer ${memberToken}` } }
    );
    expect(listed.events.some((event) => event.id === eventId)).toBe(true);

    const preferenceList = await fetchJson<{
      preferences: Array<{ tagId: string; subscribed: boolean }>;
    }>(
      `/notifications/preferences/tags?groupId=${groupId}`,
      { headers: { Authorization: `Bearer ${memberToken}` } }
    );
    expect(preferenceList.preferences.some((pref) => pref.tagId === tagId)).toBe(true);

    const preferenceUpdate = await fetchJson<{
      preference: { tagId: string; subscribed: boolean };
    }>(
      `/notifications/preferences/tags/${tagId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${memberToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subscribed: true }),
      }
    );
    expect(preferenceUpdate.preference.tagId).toBe(tagId);
    expect(preferenceUpdate.preference.subscribed).toBe(true);

    const createdRsvp = await fetchJson<{
      rsvp: { eventId: string; userId: string; status: string };
    }>(
      `/events/${eventId}/rsvps`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${memberToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "yes" }),
      },
      201
    );
    expect(createdRsvp.rsvp.status).toBe("yes");

    const updatedRsvp = await fetchJson<{
      rsvp: { eventId: string; userId: string; status: string };
    }>(
      `/events/${eventId}/rsvps/${memberUserId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "maybe" }),
      }
    );
    expect(updatedRsvp.rsvp.status).toBe("maybe");

    const attendance = await fetchJson<{
      counts: { yes: number; no: number; maybe: number };
      attendees: Array<{ userId: string; status: string }>;
    }>(
      `/events/${eventId}/attendance`,
      { headers: { Authorization: `Bearer ${ownerToken}` } }
    );
    expect(attendance.counts.maybe).toBeGreaterThanOrEqual(1);
    expect(attendance.attendees.some((entry) => entry.userId === memberUserId)).toBe(true);

    const socket = await connectSocket(memberToken);
    try {
      const joinedEvent = onceEvent<{ eventId: string }>(socket, "joined:event");
      socket.emit("join:event", eventId);
      await expect(joinedEvent).resolves.toEqual({ eventId });

      const nextMessage = onceEvent<MessagePayload>(socket, "message:new");
      socket.emit("message:send", {
        eventId,
        content: `Smoke chat payload ${uniqueSuffix}`,
      });

      const message = await nextMessage;
      createdMessageId = message.id;
      expect(message.content).toContain(`Smoke chat payload ${uniqueSuffix}`);
      expect(message.user.email).toBe("member@gem.dev");
    } finally {
      socket.disconnect();
    }

    const messages = await fetchJson<{
      messages: Array<{ id: string; content: string; pinned: boolean }>;
      hasMore: boolean;
    }>(
      `/events/${eventId}/messages`,
      { headers: { Authorization: `Bearer ${ownerToken}` } }
    );
    expect(messages.messages.some((message) => message.id === createdMessageId)).toBe(true);

    const pinned = await fetchJson<{
      message: { id: string; pinned: boolean };
    }>(
      `/events/${eventId}/messages/${createdMessageId}/pin`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ownerToken}` },
      }
    );
    expect(pinned.message.id).toBe(createdMessageId);
    expect(pinned.message.pinned).toBe(true);

    const updatedEvent = await fetchJson<EventResponse>(
      `/events/${eventId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `Phase 9 Smoke Event ${uniqueSuffix} Updated`,
          details: "Updated by integration test",
          rating: 8,
          isLegendary: false,
          tagIds: [tagId],
        }),
      }
    );
    expect(updatedEvent.event.title).toContain("Updated");

    const deleteResponse = await fetch(`${API_BASE}/events/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(deleteResponse.status).toBe(204);
    eventId = "";
  });
});