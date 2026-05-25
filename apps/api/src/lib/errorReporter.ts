import { escapeHtml, isMailConfigured, sendTransactionalEmail } from "./mailer.js";

interface ErrorContext {
  source: "api" | "worker" | "process" | "client";
  method?: string;
  url?: string;
  userId?: string;
  jobId?: string;
  userAgent?: string;
}

// Fingerprint → last-sent timestamp. Prevents email floods for repeating errors.
const seen = new Map<string, number>();
const THROTTLE_MS = 15 * 60 * 1000;

function fingerprint(error: Error): string {
  const msg = error.message.slice(0, 200);
  // Use the first two non-blank stack frames as a location anchor
  const frames = (error.stack ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("at "))
    .slice(0, 2)
    .join("|");
  return `${msg}:${frames}`;
}

function shouldSend(fp: string): boolean {
  const now = Date.now();
  const last = seen.get(fp);
  if (last !== undefined && now - last < THROTTLE_MS) return false;
  seen.set(fp, now);
  // Evict stale entries to prevent unbounded growth
  if (seen.size > 500) {
    for (const [k, ts] of seen) {
      if (now - ts > THROTTLE_MS) seen.delete(k);
    }
  }
  return true;
}

function recipients(): string[] {
  return (process.env.ERROR_ALERT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

export async function reportError(
  error: Error,
  context: ErrorContext = { source: "api" }
): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  if (!isMailConfigured()) return;

  const to = recipients();
  if (to.length === 0) return;

  const fp = fingerprint(error);
  if (!shouldSend(fp)) return;

  const env = (process.env.NODE_ENV ?? "unknown").toUpperCase();
  const source = context.source.toUpperCase();
  const ts = new Date().toISOString();
  const stack = (error.stack ?? error.message).slice(0, 4000);

  const ctxFields: [string, string][] = (
    [
      ["Method", context.method],
      ["URL", context.url],
      ["User ID", context.userId],
      ["Job ID", context.jobId],
      ["User Agent", context.userAgent],
    ] as [string, string | undefined][]
  ).filter((pair): pair is [string, string] => Boolean(pair[1]));

  const ctxRows = ctxFields
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:4px 12px 4px 0;color:#94a3b8;font-size:12px;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>
          <td style="padding:4px 0;font-size:12px;font-family:monospace;word-break:break-all">${escapeHtml(v)}</td>
        </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f172a;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif">
  <div style="max-width:640px;margin:32px auto;padding:0 16px">
    <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;overflow:hidden">
      <div style="background:#7c3aed;padding:16px 24px">
        <p style="margin:0;font-size:11px;letter-spacing:.08em;color:#ddd6fe;text-transform:uppercase">GEM ${escapeHtml(env)} · ${escapeHtml(source)} Error</p>
        <h1 style="margin:4px 0 0;font-size:18px;font-weight:600;color:#fff">${escapeHtml(error.message.slice(0, 120))}</h1>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 16px;font-size:12px;color:#64748b">${escapeHtml(ts)}</p>
        ${
          ctxRows
            ? `<table style="border-collapse:collapse;margin-bottom:20px;width:100%">${ctxRows}</table>`
            : ""
        }
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;overflow-x:auto">
          <pre style="margin:0;font-size:11px;color:#94a3b8;white-space:pre-wrap;word-break:break-all">${escapeHtml(stack)}</pre>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

  const ctxText = ctxFields.map(([k, v]) => `${k}: ${v}`).join("\n");
  const text = [
    `[GEM ${env}] ${source} Error`,
    `Time: ${ts}`,
    ctxText,
    "",
    stack,
  ]
    .filter(Boolean)
    .join("\n");

  await sendTransactionalEmail({
    to: to.join(", "),
    subject: `[GEM ${env}] ${source}: ${error.message.slice(0, 80)}`,
    html,
    text,
  });
}
