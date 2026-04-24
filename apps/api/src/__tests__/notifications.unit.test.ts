import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetVapidDetails = vi.fn();
const mockSendNotification = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: mockSetVapidDetails,
    sendNotification: mockSendNotification,
  },
}));

describe("notification domain helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSetVapidDetails.mockReset();
    mockSendNotification.mockReset();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    delete process.env.RESEND_API_KEY;
  });

  it("does not enable web push when VAPID keys are missing", async () => {
    const { configureWebPushFromEnv, isWebPushConfigured } = await import(
      "../lib/notifications.js"
    );

    expect(configureWebPushFromEnv()).toBe(false);
    expect(isWebPushConfigured()).toBe(false);
    expect(mockSetVapidDetails).not.toHaveBeenCalled();
  });

  it("configures web push and sends JSON payloads", async () => {
    process.env.VAPID_PUBLIC_KEY = "public-key";
    process.env.VAPID_PRIVATE_KEY = "private-key";
    process.env.VAPID_SUBJECT = "mailto:test@friendgroup.dev";

    const {
      configureWebPushFromEnv,
      isWebPushConfigured,
      sendPushNotification,
    } = await import("../lib/notifications.js");

    expect(configureWebPushFromEnv()).toBe(true);
    expect(isWebPushConfigured()).toBe(true);
    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      "mailto:test@friendgroup.dev",
      "public-key",
      "private-key"
    );

    await sendPushNotification(
      {
        endpoint: "https://push.example.com/subscription",
        authSecret: "auth-secret",
        p256dh: "p256dh-key",
      },
      {
        title: "Hello",
        type: "test",
      }
    );

    expect(mockSendNotification).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example.com/subscription",
        keys: {
          auth: "auth-secret",
          p256dh: "p256dh-key",
        },
      },
      JSON.stringify({ title: "Hello", type: "test" })
    );
  });

  it("builds email templates correctly", async () => {
    const { buildNotificationEmail } = await import(
      "../lib/notifications.js"
    );

    const template = buildNotificationEmail({
      title: "Event updated",
      body: "Game night moved to 8pm.",
      ctaUrl: "https://friendgroup.app/events/evt_123",
    });

    expect(template.html).toContain("Open Friendgroup");
    expect(template.text).toContain("Game night moved to 8pm.");
    expect(template.text).toContain("https://friendgroup.app/events/evt_123");
  });
});