import webpush from "web-push";

export type StoredPushSubscription = {
  endpoint: string;
  authSecret: string;
  p256dh: string;
};

let vapidConfigured = false;

export function configureWebPushFromEnv(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:owner@gem.dev";

  if (!publicKey || !privateKey) {
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export function isWebPushConfigured(): boolean {
  return vapidConfigured;
}

export async function sendPushNotification(
  subscription: StoredPushSubscription,
  payload: Record<string, unknown>
): Promise<void> {
  if (!vapidConfigured) {
    throw new Error("Web push is not configured");
  }

  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: {
        auth: subscription.authSecret,
        p256dh: subscription.p256dh,
      },
    },
    JSON.stringify(payload)
  );
}

export function buildNotificationEmail(params: {
  title: string;
  body: string;
  ctaUrl?: string;
}): { html: string; text: string } {
  const appName = "Friendgroup";
  const cta = params.ctaUrl
    ? `<p style=\"margin-top:20px;\"><a href=\"${params.ctaUrl}\" style=\"display:inline-block;background:#0f766e;color:#ffffff;padding:10px 14px;text-decoration:none;border-radius:6px;\">Open ${appName}</a></p>`
    : "";

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#0f172a;max-width:560px;margin:0 auto;padding:20px;">
    <h2 style="margin:0 0 12px 0;">${params.title}</h2>
    <p style="margin:0;">${params.body}</p>
    ${cta}
    <p style="margin-top:24px;color:#64748b;font-size:12px;">You are receiving this because you are a member of a Friendgroup group.</p>
  </div>
  `;

  const text = `${params.title}\n\n${params.body}${params.ctaUrl ? `\n\nOpen: ${params.ctaUrl}` : ""}`;

  return { html, text };
}
