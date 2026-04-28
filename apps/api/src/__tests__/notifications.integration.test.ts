import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const API_BASE = process.env.API_BASE_URL || "http://localhost:4000";
const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://friendgroup:friendgroup@localhost:5432/friendgroup_dev";

let token = "";
let groupId = "";
let tagId = "";

async function getDevToken(email: string): Promise<string> {
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

describe("Notifications integration", () => {
  beforeAll(async () => {
    token = await getDevToken("owner@gem.dev");

    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      const groupResult = await client.query<{ id: string }>(
        'SELECT id FROM "Group" LIMIT 1'
      );
      if (groupResult.rows.length === 0) {
        throw new Error("No groups found in database for notification tests");
      }
      groupId = groupResult.rows[0].id;

      const tagResult = await client.query<{ id: string }>(
        `SELECT id FROM "Tag" WHERE "groupId" = $1 LIMIT 1`,
        [groupId]
      );
      if (tagResult.rows.length > 0) {
        tagId = tagResult.rows[0].id;
      }
    } finally {
      await client.end();
    }
  });

  it("GET /notifications/config returns vapidPublicKey shape", async () => {
    const response = await fetch(`${API_BASE}/notifications/config`);

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      vapidPublicKey: string | null;
      pushConfigured: boolean;
      emailConfigured: boolean;
    };
    expect(data).toHaveProperty("vapidPublicKey");
    expect(data).toHaveProperty("pushConfigured");
    expect(data).toHaveProperty("emailConfigured");
  });

  it("POST /notifications/subscribe upserts subscription", async () => {
    const response = await fetch(`${API_BASE}/notifications/subscribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
        keys: {
          auth: "test-auth-key-base64",
          p256dh: "test-p256dh-key-base64",
        },
      }),
    });

    expect(response.status).toBe(201);
    const data = (await response.json()) as { subscription: any };
    expect(data.subscription).toBeDefined();
    expect(data.subscription.endpoint).toBe(
      "https://fcm.googleapis.com/fcm/send/test-endpoint"
    );
  });

  it("GET /notifications/preferences/tags?groupId=... returns tag preferences", async () => {
    const response = await fetch(
      `${API_BASE}/notifications/preferences/tags?groupId=${groupId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      groupId: string;
      preferences: any[];
    };
    expect(data.groupId).toBe(groupId);
    expect(Array.isArray(data.preferences)).toBe(true);
  });

  it("PUT /notifications/preferences/tags/:tagId updates preference", async () => {
    if (!tagId) return; // Skip if no tags in DB

    const response = await fetch(
      `${API_BASE}/notifications/preferences/tags/${tagId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subscribed: true }),
      }
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      preference: { tagId: string; subscribed: boolean };
    };
    expect(data.preference.tagId).toBe(tagId);
    expect(data.preference.subscribed).toBe(true);
  });
});
