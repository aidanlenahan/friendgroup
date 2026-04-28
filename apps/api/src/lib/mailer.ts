import nodemailer, { Transporter } from "nodemailer";

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
  const from = process.env.EMAIL_FROM || "GEM <noreply@example.com>";
  const transporter = getMailTransporter();

  if (transporter) {
    try {
      await transporter.sendMail({ from, ...opts });
    } catch (err) {
      console.error("[mailer] SMTP send failed:", (err as Error).message);
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[mailer:dev]", { to: opts.to, subject: opts.subject, text: opts.text });
  }
}
