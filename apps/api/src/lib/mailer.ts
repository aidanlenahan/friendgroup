import nodemailer, { Transporter } from "nodemailer";

/** Escapes user-supplied strings before embedding them in HTML email bodies. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

let _transporter: Transporter | null = null;

/**
 * Returns a cached Nodemailer SMTP transporter configured from env vars.
 * Returns null when SMTP_USER / SMTP_PASS are not set (e.g. in CI or local
 * dev without real mail configured).
 */
export function getMailTransporter(): Transporter | null {
  if (_transporter) return _transporter;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    // secure=true → SMTPS (port 465). Set SMTP_SECURE=false for port 587 STARTTLS.
    secure: process.env.SMTP_SECURE !== "false",
    auth: { user, pass },
  });

  return _transporter;
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends a transactional email via the configured SMTP transporter.
 *
 * - In all environments: swallows SMTP errors and logs them so a transport failure
 *   never bubbles up and blocks an auth flow.
 * - In non-production: always prints the email details to stdout so developers can
 *   read OTP codes without needing a real inbox.
 */
export async function sendTransactionalEmail(opts: SendEmailOptions): Promise<void> {
  const from = process.env.EMAIL_FROM || "GEM (Group Event Manager) <noreply@example.com>";
  const transporter = getMailTransporter();

  if (transporter) {
    try {
      await transporter.sendMail({ from, ...opts });
    } catch (err) {
      console.error("[mailer] SMTP send failed", {
        to: opts.to,
        subject: opts.subject,
        error: (err as Error).message,
      });
    }
  } else {
    console.warn("[mailer] sendTransactionalEmail called but SMTP is not configured");
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[mailer:dev]", { to: opts.to, subject: opts.subject, text: opts.text });
  }
}

/**
 * Verify SMTP connectivity. Call once at startup; logs result but never throws.
 */
export async function verifyMailTransporter(): Promise<void> {
  const transporter = getMailTransporter();
  if (!transporter) {
    console.info("[mailer] SMTP not configured — notification emails disabled");
    return;
  }
  try {
    await transporter.verify();
    console.info("[mailer] SMTP connection verified OK");
  } catch (err) {
    console.error("[mailer] SMTP verify failed — emails will not be delivered:", (err as Error).message);
  }
}
