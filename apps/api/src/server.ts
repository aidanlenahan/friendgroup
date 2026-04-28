import "dotenv/config"; // reloaded: 2026-04-16
import * as Sentry from "@sentry/node";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { PrismaClient } from "./generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { Redis } from "ioredis";
import { randomUUID, scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, storedKey] = hash.split(":");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(storedKey, "hex");
  return derivedKey.length === storedBuf.length && timingSafeEqual(derivedKey, storedBuf);
}
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Queue, Worker } from "bullmq";
import { errorHandler } from "./lib/errors.js";
import { validateRequest, schemas } from "./lib/validation.js";
import { requireAuth } from "./middleware/auth.js";
import {
  canAccessEvent,
  requireGroupMembership,
  requireRole,
} from "./middleware/authorization.js";
import {
  checkDatabase,
  checkRedis,
  checkStorage,
  HealthStatus,
} from "./lib/health.js";
import { createChatServer } from "./lib/chat.js";
import {
  buildNotificationEmail,
  configureWebPushFromEnv,
  isWebPushConfigured,
  sendPushNotification,
} from "./lib/notifications.js";
import { isMailConfigured, sendTransactionalEmail } from "./lib/mailer.js";
import { buildGoogleCalendarLink, buildIcsCalendar } from "./lib/calendar.js";

// Initialize clients
const connectionString = process.env.DATABASE_URL || "postgresql://friendgroup:friendgroup@localhost:5432/friendgroup_dev";
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "minioadmin",
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

const s3Bucket = process.env.S3_BUCKET || "friendgroup-media";
const mediaMaxFileBytes = Number(process.env.MEDIA_MAX_FILE_BYTES || 10 * 1024 * 1024);
const mediaMaxEventBytes = Number(process.env.MEDIA_MAX_EVENT_BYTES || 200 * 1024 * 1024);
const mediaMaxUserBytes = Number(process.env.MEDIA_MAX_USER_BYTES || 1024 * 1024 * 1024); // 1 GB default
const mediaMaxUserFiles = Number(process.env.MEDIA_MAX_USER_FILES || 100); // 100 photos per user
const uploadUrlTtlSeconds = Number(process.env.MEDIA_UPLOAD_URL_TTL_SECONDS || 15 * 60);
const allowedMediaMimeTypes = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif", "image/avif",
]);

const pushConfigured = configureWebPushFromEnv();

// Admin emails — read from env var only (no hardcoded fallback)
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const queueConnection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const workerConnection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const notificationQueue = new Queue<NotificationFanoutJobData>(
  "notification-fanout",
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  }
);

const calendarSyncQueue = new Queue<CalendarSyncJobData>("calendar-sync", {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

const notificationWorker = new Worker<NotificationFanoutJobData>(
  "notification-fanout",
  async (job) => {
    const data = job.data;

    const memberships = await prisma.membership.findMany({
      where: { groupId: data.groupId },
      select: { userId: true },
    });

    const baseRecipients = new Set(
      memberships
        .map((membership) => membership.userId)
        .filter((userId) => userId !== data.actorUserId)
    );

    let recipientIds = new Set(baseRecipients);

    if (Array.isArray(data.recipientUserIds) && data.recipientUserIds.length > 0) {
      recipientIds = new Set(data.recipientUserIds.filter((userId) => baseRecipients.has(userId)));
    }

    if (Array.isArray(data.tagIds) && data.tagIds.length > 0) {
      const prefs = await prisma.userTagPreference.findMany({
        where: {
          userId: { in: Array.from(recipientIds) },
          tagId: { in: data.tagIds },
          subscribed: true,
        },
        select: { userId: true },
      });

      recipientIds = new Set(prefs.map((pref) => pref.userId));
    }

    // Filter out recipients who have muted the actor
    if (data.actorUserId && recipientIds.size > 0) {
      const mutes = await prisma.userMute.findMany({
        where: { mutedId: data.actorUserId, muterId: { in: Array.from(recipientIds) } },
        select: { muterId: true },
      });
      for (const { muterId } of mutes) {
        recipientIds.delete(muterId);
      }
    }

    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(recipientIds) } },
      select: { id: true, email: true },
    });

    for (const user of users) {
      try {
        await prisma.notificationEvent.create({
          data: {
            type: data.type,
            recipientId: user.id,
            eventId: data.eventId,
            title: data.title,
            body: data.body,
            sentAt: new Date(),
          },
        });
      } catch (error) {
        const message = (error as Error).message || "";
        // A queued fanout can outlive event deletion; skip stale FK writes.
        if (message.includes("NotificationEvent_eventId_fkey")) {
          app.log.warn(
            { eventId: data.eventId, recipientId: user.id },
            "Skipping notificationEvent insert for deleted event"
          );
          continue;
        }
        throw error;
      }

      // Check per-type notification preferences before sending
      const pushPref = await prisma.userNotificationPreference.findUnique({
        where: { userId_type_channel: { userId: user.id, type: data.type, channel: "push" } },
      });
      const pushEnabled = pushPref ? pushPref.enabled : true; // default true

      const emailPref = await prisma.userNotificationPreference.findUnique({
        where: { userId_type_channel: { userId: user.id, type: data.type, channel: "email" } },
      });
      const emailEnabled = emailPref ? emailPref.enabled : true; // default true

      if (pushEnabled) {
        const subscription = await prisma.notificationSubscription.findUnique({
          where: { userId: user.id },
        });

        if (subscription && isWebPushConfigured()) {
          try {
            await sendPushNotification(
              {
                endpoint: subscription.endpoint,
                authSecret: subscription.authSecret,
                p256dh: subscription.p256dh,
              },
              {
                title: data.title,
                body: data.body,
                eventId: data.eventId,
                type: data.type,
              }
            );
          } catch (error) {
            const statusCode = (error as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              await prisma.notificationSubscription.delete({
                where: { userId: user.id },
              });
            }
          }
        }
      }

      if (emailEnabled && isMailConfigured()) {
        const webBase = (process.env.WEB_BASE_URL || "").replace(/\/$/, "");
        const ctaUrl = data.eventId
          ? `${webBase}/events/${data.eventId}`
          : webBase || undefined;
        const email = buildNotificationEmail({
          title: data.title,
          body: data.body,
          ctaUrl,
        });
        await sendTransactionalEmail({
          to: user.email,
          subject: data.title,
          html: email.html,
          text: email.text,
        });
      }
    }
  },
  { connection: workerConnection }
);

notificationWorker.on("failed", (job, error) => {
  if (sentryEnabled) {
    Sentry.captureException(error, {
      tags: { worker: "notification-fanout" },
      extra: { jobId: job?.id },
    });
  }
  console.error("Notification fanout job failed", {
    jobId: job?.id,
    error: error.message,
  });
});

const calendarSyncWorker = new Worker<CalendarSyncJobData>(
  "calendar-sync",
  async (job) => {
    const now = new Date();
    const revision = String(now.getTime());
    const key = `calendar:group:${job.data.groupId}:sync`;

    await workerConnection.hset(key, {
      revision,
      lastSyncedAt: now.toISOString(),
      reason: job.data.reason,
      eventId: job.data.eventId ?? "",
    });
  },
  { connection: workerConnection }
);

calendarSyncWorker.on("failed", (job, error) => {
  if (sentryEnabled) {
    Sentry.captureException(error, {
      tags: { worker: "calendar-sync" },
      extra: { jobId: job?.id },
    });
  }
  console.error("Calendar sync job failed", {
    jobId: job?.id,
    error: error.message,
  });
});

const authSecret = process.env.AUTH_SECRET;
if (!authSecret || authSecret.length < 32) {
  throw new Error("AUTH_SECRET must be set and at least 32 characters");
}

const calendarWebhookSecret = process.env.CALENDAR_WEBHOOK_SECRET;
if (!calendarWebhookSecret) {
  throw new Error("CALENDAR_WEBHOOK_SECRET must be set");
}

const configuredWebOrigins = (process.env.WEB_ALLOWED_ORIGINS ?? process.env.WEB_BASE_URL ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (configuredWebOrigins.length === 0) {
  throw new Error("Set WEB_BASE_URL or WEB_ALLOWED_ORIGINS to allowed web origins");
}

const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";

const configuredWebSocketOrigins = configuredWebOrigins.map((origin) => {
  if (origin.startsWith("https://")) return origin.replace("https://", "wss://");
  if (origin.startsWith("http://")) return origin.replace("http://", "ws://");
  return origin;
});

// Create Fastify app.
// trustProxy: 1 = trust exactly one upstream proxy hop (cloudflared), so request.ip
// resolves to the real client IP rather than the Cloudflare edge IP.
const app = Fastify({
  logger: {
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "body.password",
        "body.token",
        "body.code",
        "body.otp",
        "body.betaCode",
        "body.calendarToken",
      ],
      censor: "[REDACTED]",
    },
  },
  trustProxy: 1,
});

const sentryDsn = process.env.SENTRY_DSN_API || process.env.SENTRY_DSN;
const sentryEnabled = Boolean(sentryDsn);

if (sentryEnabled) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    beforeSend(event) {
      if (event.request?.data) {
        delete event.request.data;
      }
      if (event.request?.cookies) {
        delete event.request.cookies;
      }
      if (event.request?.headers?.authorization) {
        event.request.headers.authorization = "[REDACTED]";
      }
      return event;
    },
  });
}

const processStartedAtMs = Date.now();
let requestCount = 0;
const responseStatusBuckets: Record<string, number> = {
  "2xx": 0,
  "3xx": 0,
  "4xx": 0,
  "5xx": 0,
};
const responseLatencyMsWindow: number[] = [];

function getStatusBucket(statusCode: number) {
  if (statusCode >= 500) return "5xx";
  if (statusCode >= 400) return "4xx";
  if (statusCode >= 300) return "3xx";
  return "2xx";
}

function pushLatencySample(latencyMs: number) {
  responseLatencyMsWindow.push(latencyMs);
  if (responseLatencyMsWindow.length > 500) {
    responseLatencyMsWindow.shift();
  }
}

function percentile(sortedValues: number[], p: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index];
}

const listEventsQuerySchema = z.object({
  groupId: schemas.id,
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const createEventBodySchema = z.object({
  groupId: schemas.id,
  title: schemas.title,
  details: schemas.details,
  dateTime: schemas.dateTime,
  endsAt: z.string().datetime().optional(),
  isPrivate: z.boolean().optional(),
  maxAttendees: z.number().int().positive().optional(),
  location: z.string().max(500).optional(),
  tagIds: z.array(schemas.id).max(3, "You can add up to 3 tags per event").optional(),
});

const updateEventParamsSchema = z.object({
  id: schemas.id,
});

const updateEventBodySchema = z.object({
  title: schemas.title.optional(),
  details: schemas.details,
  dateTime: schemas.dateTime.optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isPrivate: z.boolean().optional(),
  maxAttendees: z.number().int().positive().nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  isLegendary: z.boolean().optional(),
  tagIds: z.array(schemas.id).max(3, "You can add up to 3 tags per event").optional(),
});

const rsvpBodySchema = z.object({
  status: schemas.rsvpStatus,
  expectedUpdatedAt: z.string().datetime().optional(),
});

const rsvpParamsSchema = z.object({
  id: schemas.id,
  userId: schemas.id,
});

const inviteBodySchema = z.object({
  userId: schemas.id,
});

const devTokenSchema = z.object({
  email: schemas.email,
});

const registerBodySchema = z.object({
  firstName: z.string().min(1).max(15),
  lastName: z.string().min(1).max(15),
  email: schemas.email.max(30),
  password: z.string().min(8).max(32).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
    "Password must have at least one uppercase letter, one lowercase letter, and one number"
  ),
  betaCode: z.string().min(1).max(100).optional(),
});

const loginBodySchema = z.object({
  emailOrUsername: z.string().min(1).max(255),
  password: z.string().min(1).max(128),
});

const verifyEmailBodySchema = z.object({
  userId: schemas.id,
  code: z.string().length(6).regex(/^\d{6}$/),
});

const resendVerificationBodySchema = z.object({
  userId: schemas.id,
});

const requestLoginCodeBodySchema = z.object({
  email: schemas.email,
});

const verifyLoginCodeBodySchema = z.object({
  email: schemas.email,
  code: z.string().length(6).regex(/^\d{6}$/),
});

const forgotPasswordBodySchema = z.object({
  email: schemas.email,
});

const verifyResetCodeBodySchema = z.object({
  email: schemas.email,
  code: z.string().length(6).regex(/^\d{6}$/),
});

const resetPasswordBodySchema = z.object({
  token: z.string().min(64).max(64),
  password: z.string().min(8).max(32).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
    "Password must have at least one uppercase letter, one lowercase letter, and one number"
  ),
});

const messageParamsSchema = z.object({
  id: schemas.id,
  messageId: schemas.id,
});

const messageListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: schemas.id.optional(),
});

const notificationSubscribeBodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    auth: z.string().min(1),
    p256dh: z.string().min(1),
  }),
});

const notificationPushTestBodySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(1000).optional(),
});

const notificationEmailTestBodySchema = z.object({
  subject: z.string().min(1).max(140).optional(),
  message: z.string().min(1).max(2000).optional(),
});

const notificationPrefParamsSchema = z.object({
  tagId: schemas.id,
});

const notificationPrefBodySchema = z.object({
  subscribed: z.boolean(),
});

const notificationPrefQuerySchema = z.object({
  groupId: schemas.id,
});

const mediaUploadUrlBodySchema = z.object({
  eventId: schemas.id,
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

const avatarUploadUrlBodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(200),
});

const mediaCompleteBodySchema = z.object({
  eventId: schemas.id,
  objectKey: z.string().min(1).max(1024),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

const mediaListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const calendarGroupParamsSchema = z.object({
  groupId: schemas.id,
});

const calendarSyncWebhookBodySchema = z.object({
  groupId: schemas.id,
  eventId: schemas.id.optional(),
  reason: z
    .enum([
      "manual",
      "event_created",
      "event_updated",
      "event_deleted",
      "event_invite_changed",
    ])
    .default("manual"),
});

// ============================================================================
// New Zod Schemas (Phase 10+)
// ============================================================================

const groupIdParamsSchema = z.object({
  groupId: schemas.id,
});

const createGroupBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  avatarUrl: z.string().url().optional(),
  betaCode: z.string().optional(),
});

const updateGroupBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

const groupMemberBodySchema = z.object({
  email: schemas.email,
});

const groupMemberRemoveParamsSchema = z.object({
  groupId: schemas.id,
  userId: schemas.id,
});

const updateUserBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  username: z.string().min(2).max(40).regex(/^[a-zA-Z0-9_]+$/).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  theme: z.enum(["dark", "light"]).optional(),
});

const useBetaCodeBodySchema = z.object({
  code: z.string().min(1).max(100),
  type: z.enum(["registration", "group_creation"]),
});

const createBetaCodeBodySchema = z.object({
  code: z.string().min(4).max(100).optional(),
  type: z.enum(["registration", "group_creation"]),
  count: z.number().int().min(1).max(100).optional(),
});

const updateMemberRoleBodySchema = z.object({
  role: z.enum(["admin", "member"]),
});

const joinGroupBodySchema = z.object({
  inviteCode: z.string().length(12),
});

const memberApprovalParamsSchema = z.object({
  groupId: schemas.id,
  userId: schemas.id,
});

const createTagBodySchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const updateTagBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

const tagParamsSchema = z.object({
  groupId: schemas.id,
  tagId: schemas.id,
});

const createChannelBodySchema = z.object({
  name: z.string().min(1).max(100),
  isInviteOnly: z.boolean().optional(),
});

const channelParamsSchema = z.object({
  groupId: schemas.id,
  channelId: schemas.id,
});

const channelMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: schemas.id.optional(),
});

const reactionBodySchema = z.object({
  emoji: z.string().min(1).max(32),
});

const reactionParamsSchema = z.object({
  id: schemas.id,
  messageId: schemas.id,
  emoji: z.string().min(1).max(32),
});

const reactionAddParamsSchema = z.object({
  id: schemas.id,
  messageId: schemas.id,
});

const notificationPreferencesBodySchema = z.array(
  z.object({
    type: z.enum(["chat_message", "event_created", "event_changed", "invite", "rsvp_update"]),
    channel: z.enum(["push", "email"]),
    enabled: z.boolean(),
  })
);

const eventRatingBodySchema = z.object({
  value: z.number().int().min(1).max(5),
});

const eventTagsBodySchema = z.object({
  tagIds: z.array(schemas.id).max(3, "You can add up to 3 tags per event"),
});

type NotificationFanoutJobData = {
  type: "chat_message" | "event_created" | "event_changed" | "invite" | "rsvp_update";
  groupId: string;
  actorUserId?: string;
  eventId?: string;
  channelId?: string;
  tagIds?: string[];
  recipientUserIds?: string[];
  title: string;
  body: string;
};

type CalendarSyncJobData = {
  groupId: string;
  reason: "manual" | "event_created" | "event_updated" | "event_deleted" | "event_invite_changed";
  eventId?: string;
};

async function queueCalendarSync(
  groupId: string,
  reason: CalendarSyncJobData["reason"],
  eventId?: string
) {
  await calendarSyncQueue.add("sync", {
    groupId,
    reason,
    eventId,
  });
}

async function getCalendarSyncMeta(groupId: string) {
  const key = `calendar:group:${groupId}:sync`;
  const meta = await redis.hgetall(key);

  return {
    revision: meta.revision || null,
    lastSyncedAt: meta.lastSyncedAt || null,
    reason: meta.reason || null,
  };
}

// Register plugins
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", ...configuredWebOrigins, ...configuredWebSocketOrigins],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
    },
  },
});

await app.register(cors, {
  origin: configuredWebOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

await app.register(jwt, {
  secret: authSecret,
});

await app.register(rateLimit, {
  global: false,
  redis,
  keyGenerator: (request) => (request as any).user?.id ?? request.ip,
});

// Attach clients to app context for route handlers
app.decorate("prisma", prisma);
app.decorate("redis", redis);
app.decorate("s3", s3);

// Register error handler
app.setErrorHandler((error, request, reply) => {
  const normalizedError = error instanceof Error ? error : new Error(String(error));

  if (sentryEnabled && (error as { statusCode?: number }).statusCode !== 404) {
    Sentry.captureException(normalizedError, {
      tags: {
        method: request.method,
        route: request.routeOptions.url,
      },
      extra: {
        path: request.url,
        userId: (request as { user?: { id?: string } }).user?.id,
      },
    });
  }

  return errorHandler(normalizedError, request, reply);
});

app.addHook("onResponse", async (request, reply) => {
  requestCount += 1;
  responseStatusBuckets[getStatusBucket(reply.statusCode)] += 1;
  pushLatencySample(reply.elapsedTime);
});

// ============================================================================
// Health Check Routes
// ============================================================================

app.get("/health", async (request, reply) => {
  return reply.send({ status: "ok", timestamp: new Date().toISOString() });
});

app.get<{ Reply: HealthStatus }>("/health/db", async (request, reply) => {
  const status = await checkDatabase(prisma);
  const code = status.status === "ok" ? 200 : 503;
  return reply.status(code).send(status);
});

app.get<{ Reply: HealthStatus }>("/health/redis", async (request, reply) => {
  const status = await checkRedis(redis);
  const code = status.status === "ok" ? 200 : 503;
  return reply.status(code).send(status);
});

app.get<{ Reply: HealthStatus }>("/health/storage", async (request, reply) => {
  const status = await checkStorage(s3);
  const code = status.status === "ok" ? 200 : 503;
  return reply.status(code).send(status);
});

app.get("/metrics", {
  preHandler: async (request, reply) => {
    await requireAdminEmail(request, reply, prisma);
  },
}, async (request, reply) => {
  const sortedLatencies = [...responseLatencyMsWindow].sort((a, b) => a - b);
  const [notificationQueueCounts, calendarQueueCounts] = await Promise.all([
    notificationQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
    calendarSyncQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
  ]);

  return reply.send({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - processStartedAtMs) / 1000),
    requests: {
      total: requestCount,
      byStatusBucket: responseStatusBuckets,
      latencyMs: {
        samples: sortedLatencies.length,
        p50: percentile(sortedLatencies, 50),
        p95: percentile(sortedLatencies, 95),
        p99: percentile(sortedLatencies, 99),
      },
    },
    queues: {
      notificationFanout: notificationQueueCounts,
      calendarSync: calendarQueueCounts,
    },
    sentry: {
      enabled: sentryEnabled,
      environment: process.env.NODE_ENV || "development",
    },
  });
});

app.get("/health/all", async (request, reply) => {
  const [db, redisStatus, storage] = await Promise.all([
    checkDatabase(prisma),
    checkRedis(redis),
    checkStorage(s3),
  ]);

  const statuses = [db, redisStatus, storage];
  const overallStatus = statuses.every((s) => s.status === "ok")
    ? "ok"
    : statuses.some((s) => s.status === "unhealthy")
      ? "unhealthy"
      : "degraded";

  return reply.status(overallStatus === "ok" ? 200 : 503).send({
    status: overallStatus,
    checks: { db, redis: redisStatus, storage },
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Event and RSVP Routes (Phase 2)
// ============================================================================

app.get("/", async (request, reply) => {
  return reply.send({
    name: "Gem API",
    status: "running",
    endpoints: [
      "/auth/dev-token",
      "/auth/register",
      "/auth/verify-email",
      "/auth/resend-verification",
      "/auth/login",
      "/auth/request-login-code",
      "/auth/verify-login-code",
      "/auth/forgot-password",
      "/auth/reset-password",
      "/health",
      "/health/db",
      "/health/redis",
      "/health/storage",
      "/notifications/config",
      "/notifications/subscribe",
      "/notifications/test/push",
      "/notifications/test/email",
      "/notifications/preferences/tags",
      "/media/upload-url",
      "/media/complete",
      "/events/:id/media",
      "/events",
      "/events/:id/messages",
      "/events/:id/messages/:messageId/pin",
      "/events/:id/calendar.ics",
      "/events/:id/calendar/google-link",
      "/groups/:groupId/calendar.ics",
      "/calendar/group-feed/:token.ics",
      "/calendar/sync/webhook",
    ],
  });
});

const devTokenRateLimitMax = Number.parseInt(process.env.DEV_TOKEN_RATE_LIMIT_MAX ?? "", 10);
const effectiveDevTokenRateLimitMax = Number.isFinite(devTokenRateLimitMax)
  ? devTokenRateLimitMax
  : process.env.NODE_ENV === "production"
    ? 10
    : 1000;

app.post("/auth/dev-token", { config: { rateLimit: { max: effectiveDevTokenRateLimitMax, timeWindow: "1 minute" } } }, async (request, reply) => {
  if (process.env.NODE_ENV === "production") {
    return reply.status(404).send({ error: "Not found" });
  }

  const body = await validateRequest(devTokenSchema, request.body);

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true, email: true, name: true, username: true, avatarUrl: true, theme: true },
  });

  if (!user) {
    return reply.status(404).send({
      error: "User not found for dev token",
      code: "NOT_FOUND",
    });
  }

  const token = await reply.jwtSign({ sub: user.id, email: user.email }, { expiresIn: jwtExpiresIn });
  return reply.send({ token, user: { ...user, isAdmin: ADMIN_EMAILS.includes(user.email.toLowerCase()) } });
});

// ============================================================================
// Auth Routes — Registration and Login
// ============================================================================

const registrationBetaRequired = process.env.REGISTRATION_BETA_REQUIRED === "true";

function generateOtpCode(): string {
  // Cryptographically random 6-digit code
  const buf = randomBytes(3);
  const num = ((buf[0] << 16) | (buf[1] << 8) | buf[2]) % 1_000_000;
  return num.toString().padStart(6, "0");
}

async function sendEmailCode(to: string, code: string, subject: string, body: string) {
  await sendTransactionalEmail({
    to,
    subject,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 12px 0;">Gem</h2>
        <p style="margin:0 0 20px 0;">${body}</p>
        <p style="font-size:2.2em;letter-spacing:0.35em;font-weight:700;margin:0 0 20px 0;">${code}</p>
        <p style="color:#64748b;font-size:12px;margin:0;">This code expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
    text: `${body}\n\nYour code: ${code}\n\nThis code expires in 10 minutes.`,
  });
  if (process.env.NODE_ENV !== "production") {
    app.log.info({ to, code }, "[DEV] Email code");
  }
}

app.post("/auth/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = await validateRequest(registerBodySchema, request.body);

  // Check email uniqueness
  const existingEmail = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true },
  });
  if (existingEmail) {
    return reply.status(409).send({ error: "Email already in use", code: "EMAIL_TAKEN" });
  }

  // Invite code check
  if (registrationBetaRequired) {
    if (!body.betaCode) {
      return reply.status(403).send({
        error: "An invite code is required to register",
        code: "BETA_CODE_REQUIRED",
      });
    }
    // Check persistent code first (Redis override ?? env var)
    const redisOverride = await redis.get("admin:registration_invite_code");
    const persistentCode = redisOverride ?? process.env.REGISTRATION_INVITE_CODE;
    const matchesPersistent = persistentCode && body.betaCode === persistentCode;

    // Check one-time DB code
    const oneTimeCode = !matchesPersistent
      ? await prisma.betaCode.findUnique({ where: { code: body.betaCode } })
      : null;
    const matchesOneTime = oneTimeCode && oneTimeCode.type === "registration" && oneTimeCode.usedAt === null;

    if (!matchesPersistent && !matchesOneTime) {
      return reply.status(403).send({
        error: "Invalid invite code",
        code: "BETA_CODE_INVALID",
      });
    }

    // If it was a one-time code, consume it inside the transaction below
    if (matchesOneTime) {
      (request as any)._registrationOneTimeCodeId = oneTimeCode!.id;
    }
  }

  const fullName = `${body.firstName} ${body.lastName}`;
  const baseUsername = (body.firstName + body.lastName).toLowerCase().replace(/[^a-z0-9]/g, "");

  // Ensure username uniqueness — append suffix if needed
  let username = baseUsername;
  let suffix = 1;
  while (true) {
    const taken = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!taken) break;
    username = `${baseUsername}${suffix}`;
    suffix++;
  }

  const passwordHash = await hashPassword(body.password);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        name: fullName,
        email: body.email,
        username,
        passwordHash,
        emailVerified: false,
      },
      select: { id: true, email: true, name: true, username: true, avatarUrl: true, theme: true },
    });

    // If a one-time registration code was used, consume it now (inside transaction)
    const oneTimeCodeId = (request as any)._registrationOneTimeCodeId;
    if (oneTimeCodeId) {
      await tx.betaCode.update({
        where: { id: oneTimeCodeId },
        data: { usedById: newUser.id, usedAt: new Date() },
      });
    }

    return newUser;
  });

  // Store 6-digit OTP in Redis (10 min TTL)
  const otpCode = generateOtpCode();
  await redis.setex(`verify:email:${user.id}`, 600, otpCode);

  await sendEmailCode(
    user.email,
    otpCode,
    "Verify your Gem account",
    "Enter this code to verify your email address:"
  );

  return reply.status(201).send({
    message: "Account created. Check your email for a verification code.",
    userId: user.id,
    emailSent: true,
  });
});

app.post("/auth/verify-email", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = await validateRequest(verifyEmailBodySchema, request.body);

  const stored = await redis.get(`verify:email:${body.userId}`);
  if (!stored || stored !== body.code) {
    return reply.status(400).send({ error: "Invalid or expired verification code", code: "INVALID_CODE" });
  }

  const user = await prisma.user.update({
    where: { id: body.userId },
    data: { emailVerified: true, emailVerificationToken: null },
    select: { id: true, email: true, name: true, username: true, avatarUrl: true, theme: true },
  });

  await redis.del(`verify:email:${body.userId}`);
  await redis.del(`verify:cooldown:${body.userId}`);

  const token = await reply.jwtSign({ sub: user.id, email: user.email }, { expiresIn: jwtExpiresIn });
  return reply.send({ token, user: { ...user, isAdmin: ADMIN_EMAILS.includes(user.email.toLowerCase()) } });
});

app.post("/auth/resend-verification", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = await validateRequest(resendVerificationBodySchema, request.body);

  const cooldown = await redis.get(`verify:cooldown:${body.userId}`);
  if (cooldown) {
    const ttl = await redis.ttl(`verify:cooldown:${body.userId}`);
    return reply.status(429).send({
      error: "Please wait before resending",
      code: "RESEND_COOLDOWN",
      secondsRemaining: ttl,
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: body.userId },
    select: { id: true, email: true, emailVerified: true },
  });
  if (!user || user.emailVerified) {
    return reply.status(400).send({ error: "User not found or already verified", code: "INVALID_REQUEST" });
  }

  const otpCode = generateOtpCode();
  await redis.setex(`verify:email:${body.userId}`, 600, otpCode);
  await redis.setex(`verify:cooldown:${body.userId}`, 60, "1");

  await sendEmailCode(
    user.email,
    otpCode,
    "Verify your Gem account",
    "Enter this code to verify your email address:"
  );

  return reply.send({ message: "Verification code resent" });
});

app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = await validateRequest(loginBodySchema, request.body);

  // Accept email or @username
  const isEmail = body.emailOrUsername.includes("@");
  const user = isEmail
    ? await prisma.user.findUnique({
        where: { email: body.emailOrUsername },
        select: {
          id: true, email: true, name: true, username: true,
          avatarUrl: true, theme: true, passwordHash: true, emailVerified: true,
        },
      })
    : await prisma.user.findUnique({
        where: { username: body.emailOrUsername },
        select: {
          id: true, email: true, name: true, username: true,
          avatarUrl: true, theme: true, passwordHash: true, emailVerified: true,
        },
      });

  const invalidCreds = { error: "Invalid email or password", code: "INVALID_CREDENTIALS" };

  if (!user || !user.passwordHash) {
    return reply.status(401).send(invalidCreds);
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    return reply.status(401).send(invalidCreds);
  }

  if (!user.emailVerified) {
    return reply.status(403).send({
      error: "Email not verified. Check your inbox for a verification code.",
      code: "EMAIL_NOT_VERIFIED",
      userId: user.id,
    });
  }

  const { passwordHash: _omit, emailVerified: _ev, ...safeUser } = user;
  const token = await reply.jwtSign({ sub: safeUser.id, email: safeUser.email }, { expiresIn: jwtExpiresIn });
  return reply.send({ token, user: { ...safeUser, isAdmin: ADMIN_EMAILS.includes(safeUser.email.toLowerCase()) } });
});

app.post("/auth/request-login-code", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = await validateRequest(requestLoginCodeBodySchema, request.body);

  // Always return 200 to avoid user enumeration (don't reveal if email exists)
  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true, email: true, emailVerified: true },
  });

  if (user) {
    const cooldown = await redis.get(`login:cooldown:${user.id}`);
    if (!cooldown) {
      const otpCode = generateOtpCode();
      await redis.setex(`login:code:${user.id}`, 600, otpCode);
      await redis.setex(`login:cooldown:${user.id}`, 60, "1");
      await sendEmailCode(
        user.email,
        otpCode,
        "Your Gem sign-in code",
        "Use this code to sign in to Gem:"
      );
    }
  }

  return reply.send({ message: "If that email exists, a sign-in code has been sent." });
});

app.post("/auth/verify-login-code", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = await validateRequest(verifyLoginCodeBodySchema, request.body);

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true, email: true, name: true, username: true, avatarUrl: true, theme: true, emailVerified: true },
  });

  if (!user) {
    return reply.status(401).send({ error: "Invalid code", code: "INVALID_CODE" });
  }

  const stored = await redis.get(`login:code:${user.id}`);
  if (!stored || stored !== body.code) {
    return reply.status(401).send({ error: "Invalid or expired code", code: "INVALID_CODE" });
  }

  await redis.del(`login:code:${user.id}`);
  await redis.del(`login:cooldown:${user.id}`);

  // If user hadn't verified email yet, email-code login verifies them
  if (!user.emailVerified) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
    await redis.del(`verify:email:${user.id}`);
  }

  const { emailVerified: _ev, ...safeUser } = user;
  const token = await reply.jwtSign({ sub: safeUser.id, email: safeUser.email }, { expiresIn: jwtExpiresIn });
  return reply.send({ token, user: { ...safeUser, isAdmin: ADMIN_EMAILS.includes(safeUser.email.toLowerCase()) } });
});

app.post("/auth/forgot-password", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const body = await validateRequest(forgotPasswordBodySchema, request.body);

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true, email: true },
  });

  if (user) {
    // Invalidate any existing unused tokens for this user first
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: { userId: user.id, token: rawToken, expiresAt },
    });

    // Also generate a 6-digit OTP so the user can verify directly on the page
    const otpCode = generateOtpCode();
    await redis.setex(`reset:code:${user.id}`, 3600, otpCode);

    const resetUrl = `${process.env.WEB_BASE_URL}/reset-password?token=${rawToken}`;

    await sendTransactionalEmail({
      to: user.email,
      subject: "Reset your Gem password",
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="margin:0 0 12px 0;">Gem</h2>
          <p style="margin:0 0 20px 0;">We received a request to reset your password. You can reset it by clicking the button below <strong>or</strong> by entering the 6-digit code on the reset page. Both expire in 1 hour.</p>
          <p style="margin:0 0 8px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:8px;font-weight:600;">Reset Password</a>
          </p>
          <p style="margin:0 0 20px 0;color:#64748b;font-size:13px;">Or enter this 6-digit code on the page where you requested the reset:</p>
          <div style="font-size:36px;font-weight:700;letter-spacing:12px;color:#ffffff;background:#1e293b;padding:16px 24px;border-radius:8px;display:inline-block;margin:0 0 20px 0;">${otpCode}</div>
          <p style="color:#64748b;font-size:12px;margin:0;">If you did not request a password reset, you can safely ignore this email. The link and code will expire automatically.</p>
        </div>
      `,
      text: `Reset your Gem password\n\nClick this link to reset your password (expires in 1 hour):\n${resetUrl}\n\nOr enter this 6-digit code on the page where you requested the reset: ${otpCode}\n\nIf you did not request this, ignore this email.`,
    });

    if (process.env.NODE_ENV !== "production") {
      app.log.info({ to: user.email, resetUrl, otpCode }, "[DEV] Password reset link + code");
    }
  }

  // Anti-enumeration: always return 200 regardless of whether email exists
  return reply.send({ message: "If that email is registered, a reset link has been sent." });
});

app.post("/auth/verify-reset-code", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const body = await validateRequest(verifyResetCodeBodySchema, request.body);

  const invalidError = { error: "Invalid or expired code", code: "INVALID_CODE" };

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true },
  });

  if (!user) {
    return reply.status(401).send(invalidError);
  }

  const stored = await redis.get(`reset:code:${user.id}`);
  if (!stored || stored !== body.code) {
    return reply.status(401).send(invalidError);
  }

  // Find the active reset token to hand back to the client
  const record = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    select: { token: true },
    orderBy: { expiresAt: "desc" },
  });

  if (!record) {
    return reply.status(401).send(invalidError);
  }

  // Consume the Redis code so it can't be reused
  await redis.del(`reset:code:${user.id}`);

  return reply.send({ token: record.token });
});

app.post("/auth/reset-password", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const body = await validateRequest(resetPasswordBodySchema, request.body);

  const record = await prisma.passwordResetToken.findUnique({
    where: { token: body.token },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt !== null || record.expiresAt < new Date()) {
    return reply.status(400).send({ error: "Invalid or expired reset link", code: "INVALID_TOKEN" });
  }

  const passwordHash = await hashPassword(body.password);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  return reply.send({ message: "Password updated. You can now sign in." });
});

// ============================================================================
// Notification Routes (Phase 5)
// ============================================================================

app.get("/notifications/config", async (request, reply) => {
  return reply.send({
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    pushConfigured,
    emailConfigured: isMailConfigured(),
  });
});

app.post("/notifications/subscribe", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(notificationSubscribeBodySchema, request.body);

  const subscription = await prisma.notificationSubscription.upsert({
    where: { userId: currentUser.id },
    update: {
      endpoint: body.endpoint,
      authSecret: body.keys.auth,
      p256dh: body.keys.p256dh,
    },
    create: {
      userId: currentUser.id,
      endpoint: body.endpoint,
      authSecret: body.keys.auth,
      p256dh: body.keys.p256dh,
    },
  });

  return reply.status(201).send({ subscription });
});

app.post("/notifications/test/push", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(notificationPushTestBodySchema, request.body);

  if (!pushConfigured) {
    return reply.status(503).send({
      error: "Push is not configured: missing VAPID keys",
      code: "PUSH_NOT_CONFIGURED",
    });
  }

  const subscription = await prisma.notificationSubscription.findUnique({
    where: { userId: currentUser.id },
  });

  if (!subscription) {
    return reply.status(404).send({
      error: "No push subscription found for user",
      code: "NOT_FOUND",
    });
  }

  try {
    await sendPushNotification(
      {
        endpoint: subscription.endpoint,
        authSecret: subscription.authSecret,
        p256dh: subscription.p256dh,
      },
      {
        title: body.title ?? "Gem test push",
        body: body.body ?? "Push notifications are configured correctly.",
        type: "test",
      }
    );
  } catch (error) {
    const pushError = error as { statusCode?: number; body?: string; message?: string };
    app.log.error({
      msg: "Push notification send failed",
      statusCode: pushError.statusCode,
      body: pushError.body,
      errorMessage: pushError.message,
    });

    const statusCode = pushError.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await prisma.notificationSubscription.delete({
        where: { userId: currentUser.id },
      });
    }

    return reply.status(502).send({
      error: "Failed to send push notification",
      code: "PUSH_SEND_FAILED",
      detail: pushError.body ?? pushError.message,
    });
  }

  return reply.send({ delivered: true });
});

app.post("/notifications/test/email", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(notificationEmailTestBodySchema, request.body);

  if (!isMailConfigured()) {
    return reply.status(503).send({
      error: "Email not configured. Set SMTP_USER and SMTP_PASS in the environment.",
      code: "EMAIL_NOT_CONFIGURED",
    });
  }

  const subject = body.subject ?? "Gem test email";
  const message =
    body.message ?? "Your email notification channel is configured correctly.";
  const template = buildNotificationEmail({
    title: subject,
    body: message,
    ctaUrl: process.env.WEB_BASE_URL,
  });

  await sendTransactionalEmail({
    to: currentUser.email,
    subject,
    html: template.html,
    text: template.text,
  });

  return reply.send({ sent: true });
});

app.get("/notifications/preferences/tags", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const query = await validateRequest(notificationPrefQuerySchema, request.query);

  await requireGroupMembership(prisma, currentUser.id, query.groupId);

  const [tags, prefs] = await Promise.all([
    prisma.tag.findMany({
      where: { groupId: query.groupId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.userTagPreference.findMany({
      where: {
        userId: currentUser.id,
        tag: { groupId: query.groupId },
      },
      select: { tagId: true, subscribed: true },
    }),
  ]);

  const prefMap = new Map(prefs.map((pref) => [pref.tagId, pref.subscribed]));

  return reply.send({
    groupId: query.groupId,
    preferences: tags.map((tag) => ({
      tagId: tag.id,
      tagName: tag.name,
      subscribed: prefMap.get(tag.id) ?? false,
    })),
  });
});

app.put("/notifications/preferences/tags/:tagId", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(notificationPrefParamsSchema, request.params);
  const body = await validateRequest(notificationPrefBodySchema, request.body);

  const tag = await prisma.tag.findUnique({
    where: { id: params.tagId },
    select: { id: true, groupId: true, name: true },
  });

  if (!tag) {
    return reply.status(404).send({ error: "Tag not found", code: "NOT_FOUND" });
  }

  await requireGroupMembership(prisma, currentUser.id, tag.groupId);

  const preference = await prisma.userTagPreference.upsert({
    where: {
      userId_tagId: {
        userId: currentUser.id,
        tagId: tag.id,
      },
    },
    update: {
      subscribed: body.subscribed,
    },
    create: {
      userId: currentUser.id,
      tagId: tag.id,
      subscribed: body.subscribed,
    },
  });

  return reply.send({
    preference: {
      tagId: tag.id,
      tagName: tag.name,
      subscribed: preference.subscribed,
    },
  });
});

// ============================================================================
// Media Routes (Phase 6)
// ============================================================================

app.post("/media/upload-url", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(mediaUploadUrlBodySchema, request.body);

  const access = await canAccessEvent(prisma, body.eventId, currentUser.id);

  if (body.sizeBytes > mediaMaxFileBytes) {
    return reply.status(413).send({
      error: `File exceeds per-file limit of ${mediaMaxFileBytes} bytes`,
      code: "FILE_TOO_LARGE",
    });
  }

  // Images only
  if (!allowedMediaMimeTypes.has(body.mimeType)) {
    return reply.status(415).send({
      error: "Only image files are allowed (JPEG, PNG, GIF, WebP, HEIC, AVIF)",
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  }

  // Per-user file count check (max 100 photos)
  const userFileCount = await prisma.mediaAsset.count({
    where: { uploaderId: currentUser.id },
  });
  if (userFileCount >= mediaMaxUserFiles) {
    return reply.status(413).send({
      error: `You have reached the maximum of ${mediaMaxUserFiles} photos`,
      code: "USER_MEDIA_FILE_LIMIT_EXCEEDED",
    });
  }

  const usage = await prisma.mediaAsset.aggregate({
    where: { eventId: body.eventId },
    _sum: { sizeBytes: true },
  });
  const currentEventBytes = usage._sum.sizeBytes ?? 0;

  if (currentEventBytes + body.sizeBytes > mediaMaxEventBytes) {
    return reply.status(413).send({
      error: `Event media quota exceeded (${mediaMaxEventBytes} bytes)` ,
      code: "EVENT_MEDIA_QUOTA_EXCEEDED",
    });
  }

  // Per-user total storage quota
  const userUsage = await prisma.mediaAsset.aggregate({
    where: { uploaderId: currentUser.id },
    _sum: { sizeBytes: true },
  });
  const currentUserBytes = userUsage._sum.sizeBytes ?? 0;
  if (currentUserBytes + body.sizeBytes > mediaMaxUserBytes) {
    return reply.status(413).send({
      error: "Your personal storage quota has been exceeded",
      code: "USER_MEDIA_QUOTA_EXCEEDED",
    });
  }

  const safeName = body.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const objectKey = `${access.event.id}/${Date.now()}-${randomUUID()}-${safeName}`;

  const putCommand = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: objectKey,
    ACL: "private",
    ContentType: body.mimeType,
    ContentLength: body.sizeBytes,
  });

  const uploadUrl = await getSignedUrl(s3, putCommand, {
    expiresIn: uploadUrlTtlSeconds,
  });

  return reply.send({
    uploadUrl,
    objectKey,
    expiresInSeconds: uploadUrlTtlSeconds,
    requiredHeaders: {
      "Content-Type": body.mimeType,
    },
  });
});

app.post("/media/complete", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(mediaCompleteBodySchema, request.body);

  const access = await canAccessEvent(prisma, body.eventId, currentUser.id);

  if (!body.objectKey.startsWith(`${body.eventId}/`)) {
    return reply.status(400).send({
      error: "objectKey must be scoped to the event",
      code: "INVALID_OBJECT_KEY",
    });
  }

  if (body.sizeBytes > mediaMaxFileBytes) {
    return reply.status(413).send({
      error: `File exceeds per-file limit of ${mediaMaxFileBytes} bytes`,
      code: "FILE_TOO_LARGE",
    });
  }

  // Images only (double-check at commit time)
  if (!allowedMediaMimeTypes.has(body.mimeType)) {
    return reply.status(415).send({
      error: "Only image files are allowed (JPEG, PNG, GIF, WebP, HEIC, AVIF)",
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  }

  // Per-user file count (double-check at commit time)
  const userFileCount = await prisma.mediaAsset.count({
    where: { uploaderId: currentUser.id },
  });
  if (userFileCount >= mediaMaxUserFiles) {
    return reply.status(413).send({
      error: `You have reached the maximum of ${mediaMaxUserFiles} photos`,
      code: "USER_MEDIA_FILE_LIMIT_EXCEEDED",
    });
  }

  const usage = await prisma.mediaAsset.aggregate({
    where: { eventId: body.eventId },
    _sum: { sizeBytes: true },
  });
  const currentEventBytes = usage._sum.sizeBytes ?? 0;

  if (currentEventBytes + body.sizeBytes > mediaMaxEventBytes) {
    return reply.status(413).send({
      error: `Event media quota exceeded (${mediaMaxEventBytes} bytes)`,
      code: "EVENT_MEDIA_QUOTA_EXCEEDED",
    });
  }

  // Per-user total storage quota (double-check at commit time)
  const userUsage = await prisma.mediaAsset.aggregate({
    where: { uploaderId: currentUser.id },
    _sum: { sizeBytes: true },
  });
  const currentUserBytes = userUsage._sum.sizeBytes ?? 0;
  if (currentUserBytes + body.sizeBytes > mediaMaxUserBytes) {
    return reply.status(413).send({
      error: "Your personal storage quota has been exceeded",
      code: "USER_MEDIA_QUOTA_EXCEEDED",
    });
  }

  const baseUrl = (process.env.S3_PUBLIC_BASE_URL || process.env.S3_ENDPOINT || "")
    .replace(/\/$/, "");
  const publicUrl = `${baseUrl}/${s3Bucket}/${body.objectKey}`;

  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      eventId: access.event.id,
      uploaderId: currentUser.id,
      url: publicUrl,
      filename: body.filename,
      sizeBytes: body.sizeBytes,
      mimeType: body.mimeType,
    },
  });

  return reply.status(201).send({ mediaAsset });
});

// POST /media/avatar-upload-url — generate a presigned URL for uploading a user avatar
app.post("/media/avatar-upload-url", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(avatarUploadUrlBodySchema, request.body);

  const ext = body.filename.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") ?? "jpg";
  const objectKey = `avatars/${currentUser.id}/${Date.now()}-${randomUUID()}.${ext}`;

  const putCommand = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: objectKey,
    ACL: "private",
    ContentType: body.contentType,
  });

  const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn: uploadUrlTtlSeconds });
  const baseUrl = (process.env.S3_PUBLIC_BASE_URL || process.env.S3_ENDPOINT || "").replace(/\/$/, "");
  const publicUrl = `${baseUrl}/${s3Bucket}/${objectKey}`;

  return reply.send({ uploadUrl, publicUrl, objectKey });
});

// GET /media/proxy/* — proxy media objects from S3/MinIO through the API
// Needed for mobile and cross-network access where MinIO is not directly reachable.
app.get("/media/proxy/*", async (request, reply) => {
  const fullPath = (request.params as Record<string, string>)["*"];
  if (!fullPath) {
    return reply.status(400).send({ error: "Invalid media path" });
  }

  const [bucket, ...keyParts] = fullPath.split("/");
  const key = keyParts.join("/");

  if (!bucket || !key) {
    return reply.status(400).send({ error: "Invalid media path" });
  }

  // Security: only allow access to the configured bucket and avatars prefix
  if (bucket !== s3Bucket || !key.startsWith("avatars/")) {
    return reply.status(403).send({ error: "Access denied" });
  }

  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    reply.type(object.ContentType || "application/octet-stream");
    if (object.ContentLength) {
      reply.header("Content-Length", object.ContentLength);
    }
    reply.header("Cache-Control", "public, max-age=31536000");
    return reply.send(object.Body);
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") {
      return reply.status(404).send({ error: "Not found" });
    }
    app.log.error({ err }, "Error proxying media object");
    return reply.status(500).send({ error: "Failed to proxy media" });
  }
});

app.get("/events/:id/media", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const query = await validateRequest(mediaListQuerySchema, request.query);

  await canAccessEvent(prisma, params.id, currentUser.id);

  const media = await prisma.mediaAsset.findMany({
    where: { eventId: params.id },
    include: {
      uploader: {
        select: { id: true, name: true, email: true },
      },
      likes: { select: { userId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: query.limit,
  });

  const totalBytes = media.reduce((acc, item) => acc + item.sizeBytes, 0);

  return reply.send({
    eventId: params.id,
    media: media.map((m) => ({
      ...m,
      likeCount: m.likes.length,
      likedByMe: m.likes.some((l) => l.userId === currentUser.id),
      likes: undefined,
    })),
    limits: {
      maxFileBytes: mediaMaxFileBytes,
      maxEventBytes: mediaMaxEventBytes,
    },
    summary: {
      count: media.length,
      returnedBytes: totalBytes,
    },
  });
});

// POST /media/:assetId/like — toggle like on a media asset
app.post("/media/:assetId/like", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { assetId } = request.params as { assetId: string };

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: { id: true, eventId: true },
  });
  if (!asset) {
    return reply.status(404).send({ error: "Media asset not found", code: "NOT_FOUND" });
  }

  // Ensure caller can access the event
  await canAccessEvent(prisma, asset.eventId, currentUser.id);

  const existing = await prisma.mediaAssetLike.findUnique({
    where: { assetId_userId: { assetId, userId: currentUser.id } },
  });

  if (existing) {
    await prisma.mediaAssetLike.delete({ where: { id: existing.id } });
    return reply.send({ liked: false });
  } else {
    await prisma.mediaAssetLike.create({ data: { assetId, userId: currentUser.id } });
    return reply.send({ liked: true });
  }
});

app.get("/events/:id", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { id } = request.params as { id: string };

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      tags: true,
      rsvps: true,
      invites: true,
      ratings: { select: { value: true, userId: true } },
    },
  });

  if (!event) {
    return reply.status(404).send({ error: "Event not found" });
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: currentUser.id, groupId: event.groupId } },
  });

  if (!membership) {
    return reply.status(403).send({ error: "Access denied" });
  }

  const isAdmin = ["owner", "admin"].includes(membership.role);
  const isCreator = event.createdById === currentUser.id;
  const isInvited = event.invites.some((invite) => invite.userId === currentUser.id);

  if (!isAdmin && !isCreator && event.invites.length > 0 && !isInvited) {
    return reply.status(403).send({ error: "Access denied" });
  }

  const avgRating = event.ratings.length > 0
    ? Math.round((event.ratings.reduce((s, r) => s + r.value, 0) / event.ratings.length) * 10) / 10
    : null;
  const myRating = event.ratings.find((r) => r.userId === currentUser.id)?.value ?? null;

  return reply.send({ event: { ...event, avgRating, myRating, ratingCount: event.ratings.length }, isAdmin, isCreator });
});

app.get("/events", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const query = await validateRequest(listEventsQuerySchema, request.query);

  const membership = await requireGroupMembership(
    prisma,
    currentUser.id,
    query.groupId
  );

  const events = await prisma.event.findMany({
    where: {
      groupId: query.groupId,
      dateTime: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      },
    },
    orderBy: { dateTime: "asc" },
    include: {
      tags: true,
      rsvps: true,
      invites: true,
      ratings: { select: { value: true, userId: true } },
    },
  });

  const filteredEvents = events.filter((event) => {
    const isAdmin = ["owner", "admin"].includes(membership.role);
    if (isAdmin || event.createdById === currentUser.id) {
      return true;
    }
    if (event.invites.length === 0) {
      return true;
    }
    return event.invites.some((invite) => invite.userId === currentUser.id);
  });

  const eventsWithRatings = filteredEvents.map((event) => {
    const avgRating = event.ratings.length > 0
      ? Math.round((event.ratings.reduce((s, r) => s + r.value, 0) / event.ratings.length) * 10) / 10
      : null;
    const myRating = event.ratings.find((r) => r.userId === currentUser.id)?.value ?? null;
    return { ...event, avgRating, myRating, ratingCount: event.ratings.length };
  });

  return reply.send({ events: eventsWithRatings });
});

app.post("/events", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(createEventBodySchema, request.body);

  await requireGroupMembership(prisma, currentUser.id, body.groupId);

  const event = await prisma.event.create({
    data: {
      groupId: body.groupId,
      createdById: currentUser.id,
      title: body.title,
      details: body.details,
      dateTime: new Date(body.dateTime),
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
      isPrivate: body.isPrivate ?? false,
      maxAttendees: body.maxAttendees,
      location: body.location,
      tags: body.tagIds
        ? {
            connect: body.tagIds.map((id: string) => ({ id })),
          }
        : undefined,
    },
    include: {
      tags: true,
      rsvps: true,
    },
  });

  await notificationQueue.add("fanout", {
    type: "event_created",
    groupId: body.groupId,
    actorUserId: currentUser.id,
    eventId: event.id,
    tagIds: event.tags.map((tag) => tag.id),
    title: `New event: ${event.title}`,
    body: `${currentUser.name} created an event in your group.`,
  });

  await queueCalendarSync(body.groupId, "event_created", event.id);

  return reply.status(201).send({ event });
});

app.patch("/events/:id", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const body = await validateRequest(updateEventBodySchema, request.body);

  const access = await canAccessEvent(prisma, params.id, currentUser.id);
  if (!access.isAdmin && !access.isCreator) {
    return reply.status(403).send({
      error: "Only event creator or admin can update events",
      code: "FORBIDDEN",
    });
  }

  const event = await prisma.event.update({
    where: { id: params.id },
    data: {
      title: body.title,
      details: body.details,
      dateTime: body.dateTime ? new Date(body.dateTime) : undefined,
      endsAt: body.endsAt !== undefined ? (body.endsAt ? new Date(body.endsAt) : null) : undefined,
      isPrivate: body.isPrivate,
      maxAttendees: body.maxAttendees,
      location: body.location,
      isLegendary: body.isLegendary,
      tags: body.tagIds
        ? {
            set: body.tagIds.map((id: string) => ({ id })),
          }
        : undefined,
    },
    include: {
      tags: true,
      rsvps: true,
    },
  });

  await notificationQueue.add("fanout", {
    type: "event_changed",
    groupId: access.event.groupId,
    actorUserId: currentUser.id,
    eventId: event.id,
    tagIds: event.tags.map((tag) => tag.id),
    title: `Event updated: ${event.title}`,
    body: `${currentUser.name} updated event details.`,
  });

  await queueCalendarSync(access.event.groupId, "event_updated", event.id);

  return reply.send({ event });
});

app.delete("/events/:id", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);

  const access = await canAccessEvent(prisma, params.id, currentUser.id);
  if (!access.isAdmin && !access.isCreator) {
    return reply.status(403).send({
      error: "Only event creator or admin can delete events",
      code: "FORBIDDEN",
    });
  }

  await prisma.event.delete({ where: { id: params.id } });
  await queueCalendarSync(access.event.groupId, "event_deleted", params.id);
  return reply.status(204).send();
});

app.post("/events/:id/rsvps", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const body = await validateRequest(rsvpBodySchema, request.body);
  const access = await canAccessEvent(prisma, params.id, currentUser.id);

  const where = {
    eventId_userId: {
      eventId: params.id,
      userId: currentUser.id,
    },
  };

  const existing = await prisma.rSVP.findUnique({
    where,
    select: { id: true, updatedAt: true },
  });

  if (!existing) {
    const created = await prisma.rSVP.create({
      data: {
        eventId: params.id,
        userId: currentUser.id,
        status: body.status,
      },
    });

    if (access.event.createdById !== currentUser.id) {
      await notificationQueue.add("fanout", {
        type: "rsvp_update",
        groupId: access.event.groupId,
        actorUserId: currentUser.id,
        eventId: params.id,
        recipientUserIds: [access.event.createdById],
        title: `RSVP on ${access.event.title}`,
        body: `${currentUser.name} responded ${body.status} to your event.`,
      });
    }

    return reply.status(201).send({ rsvp: created });
  }

  if (body.expectedUpdatedAt) {
    const conditionalUpdate = await prisma.rSVP.updateMany({
      where: {
        eventId: params.id,
        userId: currentUser.id,
        updatedAt: new Date(body.expectedUpdatedAt),
      },
      data: {
        status: body.status,
      },
    });

    if (conditionalUpdate.count === 0) {
      const latest = await prisma.rSVP.findUnique({
        where,
        select: { updatedAt: true },
      });

      return reply.status(409).send({
        error: "RSVP was modified by another request. Refresh and try again.",
        code: "RSVP_CONFLICT",
        latestUpdatedAt: latest?.updatedAt?.toISOString() ?? null,
      });
    }

    const updated = await prisma.rSVP.findUnique({ where });
    if (access.event.createdById !== currentUser.id) {
      await notificationQueue.add("fanout", {
        type: "rsvp_update",
        groupId: access.event.groupId,
        actorUserId: currentUser.id,
        eventId: params.id,
        recipientUserIds: [access.event.createdById],
        title: `RSVP updated on ${access.event.title}`,
        body: `${currentUser.name} changed their RSVP to ${body.status}.`,
      });
    }
    return reply.status(201).send({ rsvp: updated });
  }

  const rsvp = await prisma.rSVP.update({
    where,
    data: {
      status: body.status,
    },
  });

  if (access.event.createdById !== currentUser.id) {
    await notificationQueue.add("fanout", {
      type: "rsvp_update",
      groupId: access.event.groupId,
      actorUserId: currentUser.id,
      eventId: params.id,
      recipientUserIds: [access.event.createdById],
      title: `RSVP updated on ${access.event.title}`,
      body: `${currentUser.name} changed their RSVP to ${body.status}.`,
    });
  }

  return reply.status(201).send({ rsvp });
});

app.patch("/events/:id/rsvps/:userId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(rsvpParamsSchema, request.params);
  const body = await validateRequest(rsvpBodySchema, request.body);

  const access = await canAccessEvent(prisma, params.id, currentUser.id);
  if (!access.isAdmin && params.userId !== currentUser.id) {
    return reply.status(403).send({
      error: "Only admins can update other users' RSVPs",
      code: "FORBIDDEN",
    });
  }

  const where = {
    eventId_userId: {
      eventId: params.id,
      userId: params.userId,
    },
  };

  const existing = await prisma.rSVP.findUnique({ where, select: { updatedAt: true } });
  if (!existing) {
    return reply.status(404).send({ error: "RSVP not found", code: "NOT_FOUND" });
  }

  if (body.expectedUpdatedAt) {
    const conditionalUpdate = await prisma.rSVP.updateMany({
      where: {
        eventId: params.id,
        userId: params.userId,
        updatedAt: new Date(body.expectedUpdatedAt),
      },
      data: {
        status: body.status,
      },
    });

    if (conditionalUpdate.count === 0) {
      const latest = await prisma.rSVP.findUnique({
        where,
        select: { updatedAt: true },
      });

      return reply.status(409).send({
        error: "RSVP was modified by another request. Refresh and try again.",
        code: "RSVP_CONFLICT",
        latestUpdatedAt: latest?.updatedAt?.toISOString() ?? null,
      });
    }

    const updated = await prisma.rSVP.findUnique({ where });
    return reply.send({ rsvp: updated });
  }

  const rsvp = await prisma.rSVP.update({
    where,
    data: {
      status: body.status,
    },
  });

  return reply.send({ rsvp });
});

app.get("/events/:id/attendance", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);

  await canAccessEvent(prisma, params.id, currentUser.id);

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      rsvps: {
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
  });

  if (!event) {
    return reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
  }

  const counts = event.rsvps.reduce(
    (acc, rsvp) => {
      if (rsvp.status === "yes") acc.yes += 1;
      if (rsvp.status === "no") acc.no += 1;
      if (rsvp.status === "maybe") acc.maybe += 1;
      return acc;
    },
    { yes: 0, no: 0, maybe: 0 }
  );

  return reply.send({
    eventId: event.id,
    counts,
    attendees: event.rsvps,
  });
});

app.post("/events/:id/invites", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const body = await validateRequest(inviteBodySchema, request.body);

  const access = await canAccessEvent(prisma, params.id, currentUser.id);
  if (!access.isAdmin && !access.isCreator) {
    return reply.status(403).send({
      error: "Only event creator or admin can invite users",
      code: "FORBIDDEN",
    });
  }

  await requireGroupMembership(prisma, body.userId, access.event.groupId);
  if (body.userId === currentUser.id) {
    return reply.status(400).send({
      error: "Cannot invite yourself",
      code: "BAD_REQUEST",
    });
  }

  const invite = await prisma.eventInvite.upsert({
    where: {
      eventId_userId: {
        eventId: params.id,
        userId: body.userId,
      },
    },
    update: {
      invitedById: currentUser.id,
    },
    create: {
      eventId: params.id,
      userId: body.userId,
      invitedById: currentUser.id,
    },
  });

  await notificationQueue.add("fanout", {
    type: "invite",
    groupId: access.event.groupId,
    actorUserId: currentUser.id,
    eventId: params.id,
    recipientUserIds: [body.userId],
    title: "You were invited to an event",
    body: `${currentUser.name} invited you to join an event.`,
  });

  await queueCalendarSync(access.event.groupId, "event_invite_changed", params.id);

  return reply.status(201).send({ invite });
});

app.get("/events/:id/invites", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const access = await canAccessEvent(prisma, params.id, currentUser.id);

  requireRole(access.membership.role, ["owner", "admin"]);

  const invites = await prisma.eventInvite.findMany({
    where: { eventId: params.id },
    include: {
      invitedUser: {
        select: { id: true, email: true, name: true },
      },
      invitedBy: {
        select: { id: true, email: true, name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return reply.send({ invites });
});

// ============================================================================
// Calendar Routes (Phase 8)
// ============================================================================

app.get("/events/:id/calendar.ics", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  await canAccessEvent(prisma, params.id, currentUser.id);

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      groupId: true,
      title: true,
      details: true,
      dateTime: true,
      endsAt: true,
      location: true,
      updatedAt: true,
    },
  });

  if (!event) {
    return reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
  }

  const ics = buildIcsCalendar(
    [
      {
        id: event.id,
        title: event.title,
        details: event.details,
        dateTime: event.dateTime,
        endsAt: event.endsAt,
        location: event.location,
        updatedAt: event.updatedAt,
      },
    ],
    {
      calendarName: `Gem - ${event.title}`,
      webBaseUrl: process.env.WEB_BASE_URL,
    }
  );

  const syncMeta = await getCalendarSyncMeta(event.groupId);

  reply.header("Content-Type", "text/calendar; charset=utf-8");
  reply.header(
    "Content-Disposition",
    `inline; filename="gem-event-${event.id}.ics"`
  );
  if (syncMeta.revision) {
    reply.header("X-Gem-Calendar-Revision", syncMeta.revision);
  }
  if (syncMeta.lastSyncedAt) {
    reply.header("X-Friendgroup-Calendar-Last-Synced-At", syncMeta.lastSyncedAt);
  }
  return reply.send(ics);
});

app.get("/events/:id/calendar/google-link", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  await canAccessEvent(prisma, params.id, currentUser.id);

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      details: true,
      dateTime: true,
      endsAt: true,
      location: true,
      updatedAt: true,
    },
  });

  if (!event) {
    return reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
  }

  const url = buildGoogleCalendarLink(
    {
      id: event.id,
      title: event.title,
      details: event.details,
      dateTime: event.dateTime,
      endsAt: event.endsAt,
      location: event.location,
      updatedAt: event.updatedAt,
    },
    process.env.WEB_BASE_URL
  );

  return reply.send({
    eventId: event.id,
    provider: "google",
    url,
  });
});

app.get("/groups/:groupId/calendar.ics", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(calendarGroupParamsSchema, request.params);
  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const group = await prisma.group.findUnique({
    where: { id: params.groupId },
    select: { id: true, name: true },
  });

  if (!group) {
    return reply.status(404).send({ error: "Group not found", code: "NOT_FOUND" });
  }

  const events = await prisma.event.findMany({
    where: {
      groupId: params.groupId,
      dateTime: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    include: {
      invites: true,
    },
    orderBy: { dateTime: "asc" },
  });

  const filtered = events.filter((event) => {
    const isAdmin = ["owner", "admin"].includes(membership.role);
    if (isAdmin || event.createdById === currentUser.id) {
      return true;
    }

    if (event.invites.length === 0) {
      return true;
    }

    return event.invites.some((invite) => invite.userId === currentUser.id);
  });

  const ics = buildIcsCalendar(
    filtered.map((event) => ({
      id: event.id,
      title: event.title,
      details: event.details,
      dateTime: event.dateTime,
      endsAt: event.endsAt,
      location: event.location,
      updatedAt: event.updatedAt,
    })),
    {
      calendarName: `Gem - ${group.name}`,
      webBaseUrl: process.env.WEB_BASE_URL,
    }
  );

  const syncMeta = await getCalendarSyncMeta(group.id);

  reply.header("Content-Type", "text/calendar; charset=utf-8");
  reply.header(
    "Content-Disposition",
    `inline; filename="gem-group-${group.id}.ics"`
  );
  if (syncMeta.revision) {
    reply.header("X-Gem-Calendar-Revision", syncMeta.revision);
  }
  if (syncMeta.lastSyncedAt) {
    reply.header("X-Gem-Calendar-Last-Synced-At", syncMeta.lastSyncedAt);
  }
  return reply.send(ics);
});

// ============================================================================
// Calendar Feed Subscription Routes
// ============================================================================

// POST /groups/:groupId/calendar-token — generate (or return existing) feed token
const calendarTokenParamsSchema = z.object({ groupId: z.string() });

app.post("/groups/:groupId/calendar-token", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(calendarTokenParamsSchema, request.params);
  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  // Upsert: generate a new token and save it
  const token = randomBytes(32).toString("hex");
  const membership = await prisma.membership.update({
    where: { userId_groupId: { userId: currentUser.id, groupId: params.groupId } },
    data: { calendarToken: token },
    select: { calendarToken: true },
  });

  const apiBase = (process.env.API_BASE_URL || "").replace(/\/$/, "");
  const feedUrl = `${apiBase}/calendar/group-feed/${membership.calendarToken}.ics`;
  return reply.send({ feedUrl });
});

// DELETE /groups/:groupId/calendar-token — revoke feed token
app.delete("/groups/:groupId/calendar-token", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(calendarTokenParamsSchema, request.params);
  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  await prisma.membership.update({
    where: { userId_groupId: { userId: currentUser.id, groupId: params.groupId } },
    data: { calendarToken: null },
  });

  return reply.status(204).send();
});

// GET /groups/:groupId/calendar-token — return existing token (if any)
app.get("/groups/:groupId/calendar-token", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(calendarTokenParamsSchema, request.params);
  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);

  if (!membership.calendarToken) {
    return reply.send({ feedUrl: null });
  }

  const apiBase = (process.env.API_BASE_URL || "").replace(/\/$/, "");
  const feedUrl = `${apiBase}/calendar/group-feed/${membership.calendarToken}.ics`;
  return reply.send({ feedUrl });
});

// GET /calendar/group-feed/:token.ics — public feed endpoint (token = auth, no JWT)
const groupFeedParamsSchema = z.object({ token: z.string().min(64).max(64) });

app.get("/calendar/group-feed/:token.ics", async (request, reply) => {
  const params = await validateRequest(groupFeedParamsSchema, request.params);

  const membership = await prisma.membership.findUnique({
    where: { calendarToken: params.token },
    select: {
      userId: true,
      groupId: true,
      role: true,
      status: true,
    },
  });

  if (!membership || membership.status !== "active") {
    return reply.status(404).send("Not found");
  }

  const group = await prisma.group.findUnique({
    where: { id: membership.groupId },
    select: { id: true, name: true },
  });
  if (!group) return reply.status(404).send("Not found");

  // Fetch user's subscribed tag IDs for this group
  const tagPrefs = await prisma.userTagPreference.findMany({
    where: { userId: membership.userId, tag: { groupId: membership.groupId }, subscribed: true },
    select: { tagId: true },
  });
  const subscribedTagIds = new Set(tagPrefs.map((p) => p.tagId));

  const isAdmin = ["owner", "admin"].includes(membership.role);

  const events = await prisma.event.findMany({
    where: { groupId: membership.groupId },
    include: {
      invites: { select: { userId: true } },
      tags: { select: { id: true } },
    },
    orderBy: { dateTime: "asc" },
  });

  const filtered = events.filter((event) => {
    // Access control: private events only for invited users / admins / creator
    if (event.isPrivate) {
      const hasAccess =
        isAdmin ||
        event.createdById === membership.userId ||
        event.invites.some((inv) => inv.userId === membership.userId);
      if (!hasAccess) return false;
    }

    // Tag filter: if user has any tag subscriptions, only include events that
    // have at least one subscribed tag, OR have no tags at all.
    if (subscribedTagIds.size > 0) {
      if (event.tags.length > 0 && !event.tags.some((t) => subscribedTagIds.has(t.id))) {
        return false;
      }
    }

    return true;
  });

  const ics = buildIcsCalendar(
    filtered.map((event) => ({
      id: event.id,
      title: event.title,
      details: event.details,
      dateTime: event.dateTime,
      endsAt: event.endsAt,
      location: event.location,
      updatedAt: event.updatedAt,
    })),
    {
      calendarName: `Gem - ${group.name}`,
      webBaseUrl: process.env.WEB_BASE_URL,
    }
  );

  reply.header("Content-Type", "text/calendar; charset=utf-8");
  reply.header("Cache-Control", "no-cache, no-store");
  reply.header(
    "Content-Disposition",
    `inline; filename="gem-${group.id}.ics"`
  );
  return reply.send(ics);
});

app.post("/calendar/sync/webhook", async (request, reply) => {
  const providedSecret = request.headers["x-calendar-webhook-secret"];

  if (typeof providedSecret !== "string" || providedSecret !== calendarWebhookSecret) {
    return reply.status(403).send({
      error: "Invalid calendar webhook secret",
      code: "FORBIDDEN",
    });
  }

  const body = await validateRequest(calendarSyncWebhookBodySchema, request.body);
  await queueCalendarSync(body.groupId, body.reason, body.eventId);

  return reply.status(202).send({
    accepted: true,
    groupId: body.groupId,
    eventId: body.eventId ?? null,
    reason: body.reason,
  });
});

// ============================================================================
// Chat Routes (Phase 4)
// ============================================================================

app.get("/events/:id/messages", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const query = await validateRequest(messageListQuerySchema, request.query);

  await canAccessEvent(prisma, params.id, currentUser.id);

  // Resolve before-cursor to a createdAt timestamp
  let cursorFilter: object | undefined;
  if (query.before) {
    const ref = await prisma.message.findUnique({
      where: { id: query.before },
      select: { createdAt: true },
    });
    if (ref) {
      cursorFilter = { createdAt: { lt: ref.createdAt } };
    }
  }

  const raw = await prisma.message.findMany({
    where: {
      eventId: params.id,
      ...cursorFilter,
    },
    orderBy: { createdAt: "desc" },
    take: query.limit + 1,
    include: {
      user: { select: { id: true, name: true, email: true } },
      reactions: { select: { userId: true, emoji: true } },
    },
  });

  const hasMore = raw.length > query.limit;
  const messages = raw.slice(0, query.limit).reverse(); // oldest-first for display

  return reply.send({ messages, hasMore });
});

app.patch("/events/:id/messages/:messageId/pin", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(messageParamsSchema, request.params);

  const access = await canAccessEvent(prisma, params.id, currentUser.id);
  if (!access.isAdmin && !access.isCreator) {
    return reply.status(403).send({
      error: "Only event creator or admin can pin messages",
      code: "FORBIDDEN",
    });
  }

  const existing = await prisma.message.findFirst({
    where: { id: params.messageId, eventId: params.id },
  });
  if (!existing) {
    return reply.status(404).send({ error: "Message not found", code: "NOT_FOUND" });
  }

  const message = await prisma.message.update({
    where: { id: params.messageId },
    data: { pinned: !existing.pinned },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return reply.send({ message });
});

// ============================================================================
// Groups CRUD Routes
// ============================================================================

app.get("/groups", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);

  const memberships = await prisma.membership.findMany({
    where: { userId: currentUser.id },
    include: {
      group: {
        include: {
          _count: { select: { memberships: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = memberships.map((m) => ({
    id: m.group.id,
    name: m.group.name,
    description: m.group.description,
    avatarUrl: m.group.avatarUrl,
    ownerId: m.group.ownerId,
    _count: { memberships: m.group._count.memberships },
    role: m.role,
    joinedAt: m.createdAt,
  }));

  return reply.send({ groups });
});

app.post("/groups", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(createGroupBodySchema, request.body);

  // Beta gate: if GROUP_CREATION_BETA_REQUIRED is set, validate code
  if (process.env.GROUP_CREATION_BETA_REQUIRED === "true") {
    if (!body.betaCode) {
      return reply.status(403).send({ error: "An invite code is required to create a group.", code: "BETA_CODE_REQUIRED" });
    }
    // Check persistent code first (Redis override ?? env var)
    const redisGroupOverride = await redis.get("admin:group_creation_invite_code");
    const persistentGroupCode = redisGroupOverride ?? process.env.GROUP_CREATION_INVITE_CODE;
    const matchesGroupPersistent = persistentGroupCode && body.betaCode === persistentGroupCode;

    if (!matchesGroupPersistent) {
      // Fall back to one-time DB code
      const betaCode = await prisma.betaCode.findUnique({ where: { code: body.betaCode } });
      if (!betaCode || betaCode.type !== "group_creation" || betaCode.usedAt !== null) {
        return reply.status(403).send({ error: "Invalid or already used invite code.", code: "INVALID_BETA_CODE" });
      }
      // consume the one-time code
      await prisma.betaCode.update({
        where: { id: betaCode.id },
        data: { usedById: currentUser.id, usedAt: new Date() },
      });
    }
    // Persistent code: no DB update needed
  }

  const group = await prisma.group.create({
    data: {
      name: body.name,
      description: body.description,
      avatarUrl: body.avatarUrl,
      ownerId: currentUser.id,
      inviteCode: randomBytes(6).toString("hex"), // 12 hex chars
      memberships: {
        create: {
          userId: currentUser.id,
          role: "owner",
          status: "active",
        },
      },
      channels: {
        create: {
          name: "general",
          isInviteOnly: false,
        },
      },
    },
    include: {
      _count: { select: { memberships: true } },
    },
  });

  return reply.status(201).send({ group });
});

app.get("/groups/:groupId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const group = await prisma.group.findUnique({
    where: { id: params.groupId },
    include: {
      _count: { select: { memberships: true, events: true, channels: true } },
    },
  });

  if (!group) {
    return reply.status(404).send({ error: "Group not found", code: "NOT_FOUND" });
  }

  return reply.send({ group });
});

app.patch("/groups/:groupId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);
  const body = await validateRequest(updateGroupBodySchema, request.body);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const group = await prisma.group.update({
    where: { id: params.groupId },
    data: {
      name: body.name,
      description: body.description,
      avatarUrl: body.avatarUrl,
    },
  });

  return reply.send({ group });
});

app.delete("/groups/:groupId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner"]);

  await prisma.group.delete({ where: { id: params.groupId } });
  return reply.status(204).send();
});

app.post("/groups/:groupId/members", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);
  const body = await validateRequest(groupMemberBodySchema, request.body);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const invitedUser = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true },
  });

  if (!invitedUser) {
    return reply.status(404).send({ error: "User not found", code: "NOT_FOUND" });
  }

  const existing = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: invitedUser.id, groupId: params.groupId } },
  });

  if (existing) {
    return reply.status(409).send({ error: "User is already a member", code: "CONFLICT" });
  }

  const newMembership = await prisma.membership.create({
    data: {
      userId: invitedUser.id,
      groupId: params.groupId,
      role: "member",
    },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  return reply.status(201).send({ membership: newMembership });
});

app.delete("/groups/:groupId/members/:userId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupMemberRemoveParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const target = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: params.userId, groupId: params.groupId } },
  });

  if (!target) {
    return reply.status(404).send({ error: "Member not found", code: "NOT_FOUND" });
  }

  if (target.role === "owner") {
    return reply.status(403).send({ error: "Cannot remove the group owner", code: "FORBIDDEN" });
  }

  await prisma.membership.delete({
    where: { userId_groupId: { userId: params.userId, groupId: params.groupId } },
  });

  await prisma.auditLog.create({
    data: {
      groupId: params.groupId,
      actorId: currentUser.id,
      action: "member_removed",
      targetUserId: params.userId,
    },
  });

  return reply.status(204).send();
});

app.patch("/groups/:groupId/members/:userId/role", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupMemberRemoveParamsSchema, request.params);
  const body = await validateRequest(updateMemberRoleBodySchema, request.body);

  const callerMembership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(callerMembership.role, ["owner"]);

  const target = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: params.userId, groupId: params.groupId } },
  });

  if (!target) {
    return reply.status(404).send({ error: "Member not found", code: "NOT_FOUND" });
  }

  if (target.role === "owner") {
    return reply.status(403).send({ error: "Cannot change the owner's role", code: "FORBIDDEN" });
  }

  const updated = await prisma.membership.update({
    where: { userId_groupId: { userId: params.userId, groupId: params.groupId } },
    data: { role: body.role },
    include: {
      user: { select: { id: true, email: true, name: true, avatarUrl: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      groupId: params.groupId,
      actorId: currentUser.id,
      action: "role_changed",
      targetUserId: params.userId,
      meta: { from: target.role, to: body.role },
    },
  });

  return reply.send({ membership: updated });
});

app.get("/groups/:groupId/members", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  const callerMembership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  const isOwnerOrAdmin = ["owner", "admin"].includes(callerMembership.role);

  const members = await prisma.membership.findMany({
    where: {
      groupId: params.groupId,
      // Non-owners only see active members; owners/admins see all (including pending)
      ...(isOwnerOrAdmin ? {} : { status: "active" }),
    },
    include: {
      user: { select: { id: true, email: true, name: true, username: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return reply.send({
    members: members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      username: m.user.username,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      status: m.status,
      mutedUntil: m.mutedUntil ?? null,
      joinedAt: m.createdAt,
    })),
  });
});

// GET /groups/:groupId/invite-code — any active member can retrieve the invite code
app.get("/groups/:groupId/invite-code", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  // Any active member can view the invite code; only admins/owners can regenerate it
  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  let group = await prisma.group.findUnique({
    where: { id: params.groupId },
    select: { id: true, inviteCode: true },
  });

  if (!group) {
    return reply.status(404).send({ error: "Group not found", code: "NOT_FOUND" });
  }

  // Auto-generate a code if somehow the group has none (e.g. legacy data)
  if (!group.inviteCode) {
    group = await prisma.group.update({
      where: { id: params.groupId },
      data: { inviteCode: randomBytes(6).toString("hex") },
      select: { id: true, inviteCode: true },
    });
  }

  return reply.send({ groupId: params.groupId, inviteCode: group.inviteCode });
});

// POST /groups/:groupId/invite-code/regenerate — owner or admin regenerates the invite code
app.post("/groups/:groupId/invite-code/regenerate", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const group = await prisma.group.update({
    where: { id: params.groupId },
    data: { inviteCode: randomBytes(6).toString("hex") },
    select: { id: true, inviteCode: true },
  });

  return reply.send({ groupId: params.groupId, inviteCode: group.inviteCode });
});

// POST /groups/join — any authenticated user joins a group via invite code (creates pending membership)
app.post("/groups/join", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(joinGroupBodySchema, request.body);

  const group = await prisma.group.findUnique({
    where: { inviteCode: body.inviteCode.toLowerCase() },
    select: { id: true, name: true, ownerId: true },
  });

  if (!group) {
    return reply.status(404).send({ error: "Invalid invite code", code: "INVALID_INVITE_CODE" });
  }

  const existing = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: currentUser.id, groupId: group.id } },
    select: { id: true, status: true },
  });

  if (existing) {
    if (existing.status === "active") {
      return reply.status(409).send({ error: "You are already a member of this group", code: "ALREADY_MEMBER" });
    }
    // Already has pending request
    return reply.status(409).send({ error: "You already have a pending join request for this group", code: "ALREADY_PENDING" });
  }

  await prisma.membership.create({
    data: {
      userId: currentUser.id,
      groupId: group.id,
      role: "member",
      status: "pending",
    },
  });

  await prisma.auditLog.create({
    data: {
      groupId: group.id,
      actorId: currentUser.id,
      action: "member_joined",
      targetUserId: currentUser.id,
    },
  });

  // Email the group owner to notify them of the join request
  const owner = await prisma.user.findUnique({
    where: { id: group.ownerId },
    select: { email: true, name: true },
  });

  if (owner) {
    const groupUrl = `${process.env.WEB_BASE_URL}/groups/${group.id}?tab=members`;
    await sendTransactionalEmail({
      to: owner.email,
      subject: `New join request for ${group.name}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="margin:0 0 12px 0;">Gem</h2>
          <p style="margin:0 0 16px 0;"><strong>${currentUser.name}</strong> (${currentUser.email}) has requested to join your group <strong>${group.name}</strong>.</p>
          <p style="margin:0 0 20px 0;">You can approve or deny their request from the Members tab of your group.</p>
          <p style="margin:0 0 20px 0;">
            <a href="${groupUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:8px;font-weight:600;">Review Request</a>
          </p>
          <p style="color:#64748b;font-size:12px;margin:0;">You are receiving this because you are the owner of the group.</p>
        </div>
      `,
      text: `${currentUser.name} (${currentUser.email}) has requested to join your group "${group.name}".\n\nReview the request: ${groupUrl}`,
    });

    if (process.env.NODE_ENV !== "production") {
      app.log.info({ to: owner.email, requester: currentUser.name, group: group.name }, "[DEV] Group join request email");
    }
  }

  return reply.status(201).send({
    message: "Join request sent. The group owner will review your request.",
    groupId: group.id,
    groupName: group.name,
  });
});

// POST /groups/:groupId/members/:userId/approve — owner/admin approves a pending membership
app.post("/groups/:groupId/members/:userId/approve", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(memberApprovalParamsSchema, request.params);

  const callerMembership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(callerMembership.role, ["owner", "admin"]);

  const target = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: params.userId, groupId: params.groupId } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!target) {
    return reply.status(404).send({ error: "Join request not found", code: "NOT_FOUND" });
  }

  if (target.status !== "pending") {
    return reply.status(409).send({ error: "Membership is not in pending state", code: "NOT_PENDING" });
  }

  const [updated, group] = await Promise.all([
    prisma.membership.update({
      where: { userId_groupId: { userId: params.userId, groupId: params.groupId } },
      data: { status: "active" },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    }),
    prisma.group.findUnique({ where: { id: params.groupId }, select: { name: true } }),
  ]);

  if (target.user && isMailConfigured()) {
    const groupUrl = `${process.env.WEB_BASE_URL}/groups/${params.groupId}`;
    await sendTransactionalEmail({
      to: target.user.email,
      subject: `You've been approved to join ${group?.name ?? "the group"}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="margin:0 0 12px 0;">Gem</h2>
          <p style="margin:0 0 16px 0;">Your request to join <strong>${group?.name ?? "the group"}</strong> has been <strong style="color:#22c55e;">approved</strong>!</p>
          <p style="margin:0 0 20px 0;">
            <a href="${groupUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:8px;font-weight:600;">Open Group</a>
          </p>
          <p style="color:#64748b;font-size:12px;margin:0;">You are receiving this because you requested to join this group.</p>
        </div>
      `,
      text: `Your request to join "${group?.name ?? "the group"}" has been approved!\n\nOpen the group: ${groupUrl}`,
    });
  }

  await prisma.auditLog.create({
    data: {
      groupId: params.groupId,
      actorId: currentUser.id,
      action: "member_approved",
      targetUserId: params.userId,
    },
  });

  return reply.send({
    membership: {
      userId: updated.user.id,
      name: updated.user.name,
      email: updated.user.email,
      avatarUrl: updated.user.avatarUrl,
      role: updated.role,
      status: updated.status,
    },
  });
});

// POST /groups/:groupId/members/:userId/deny — owner/admin denies and removes a pending membership
app.post("/groups/:groupId/members/:userId/deny", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(memberApprovalParamsSchema, request.params);

  const callerMembership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(callerMembership.role, ["owner", "admin"]);

  const target = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: params.userId, groupId: params.groupId } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!target) {
    return reply.status(404).send({ error: "Join request not found", code: "NOT_FOUND" });
  }

  if (target.status !== "pending") {
    return reply.status(409).send({ error: "Membership is not in pending state", code: "NOT_PENDING" });
  }

  const [, group] = await Promise.all([
    prisma.membership.delete({
      where: { userId_groupId: { userId: params.userId, groupId: params.groupId } },
    }),
    prisma.group.findUnique({ where: { id: params.groupId }, select: { name: true } }),
  ]);

  if (target.user && isMailConfigured()) {
    await sendTransactionalEmail({
      to: target.user.email,
      subject: `Your join request for ${group?.name ?? "the group"} was not approved`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="margin:0 0 12px 0;">Gem</h2>
          <p style="margin:0 0 16px 0;">Your request to join <strong>${group?.name ?? "the group"}</strong> was not approved at this time.</p>
          <p style="color:#64748b;font-size:12px;margin:0;">You are receiving this because you requested to join this group.</p>
        </div>
      `,
      text: `Your request to join "${group?.name ?? "the group"}" was not approved at this time.`,
    });
  }

  await prisma.auditLog.create({
    data: {
      groupId: params.groupId,
      actorId: currentUser.id,
      action: "member_denied",
      targetUserId: params.userId,
    },
  });

  return reply.status(204).send();
});

// POST /groups/:groupId/members/:userId/mute — admin+ mutes a member (blocks chat messages)
app.post("/groups/:groupId/members/:userId/mute", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId, userId } = request.params as { groupId: string; userId: string };
  const body = z.object({ durationHours: z.number().int().min(1).max(8760).optional() }).parse(request.body);

  const callerMembership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(callerMembership.role, ["owner", "admin"]);

  const target = await prisma.membership.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (!target) {
    return reply.status(404).send({ error: "Member not found", code: "NOT_FOUND" });
  }
  if (target.role === "owner") {
    return reply.status(403).send({ error: "Cannot mute the group owner", code: "FORBIDDEN" });
  }

  const mutedUntil = body.durationHours
    ? new Date(Date.now() + body.durationHours * 3600 * 1000)
    : new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000); // ~permanent

  await prisma.membership.update({
    where: { userId_groupId: { userId, groupId } },
    data: { mutedUntil },
  });

  return reply.send({ message: "Member muted", mutedUntil });
});

// POST /groups/:groupId/members/:userId/unmute — admin+ removes mute
app.post("/groups/:groupId/members/:userId/unmute", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId, userId } = request.params as { groupId: string; userId: string };

  const callerMembership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(callerMembership.role, ["owner", "admin"]);

  await prisma.membership.updateMany({
    where: { userId, groupId },
    data: { mutedUntil: null },
  });

  return reply.send({ message: "Member unmuted" });
});

// GET /groups/:groupId/audit-log — owner/admin views the group's audit log
app.get("/groups/:groupId/audit-log", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId } = request.params as { groupId: string };
  const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);

  const membership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const logs = await prisma.auditLog.findMany({
    where: { groupId },
    orderBy: { createdAt: "desc" },
    take: query.limit,
    include: {
      actor: { select: { id: true, name: true, avatarUrl: true } },
      targetUser: { select: { id: true, name: true } },
    },
  });

  return reply.send({ logs });
});

// ============================================================================
// User Profile Routes
// ============================================================================

app.get("/users/me", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { id: true, email: true, name: true, username: true, usernameChangedAt: true, avatarUrl: true, theme: true, createdAt: true },
  });

  const isAdmin = ADMIN_EMAILS.length > 0 && ADMIN_EMAILS.includes(currentUser.email.toLowerCase());
  return reply.send({ user: { ...user, isAdmin } });
});

app.get("/users/:username", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { username } = request.params as { username: string };

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, name: true, username: true, avatarUrl: true, createdAt: true },
  });

  if (!user) {
    return reply.status(404).send({ error: "User not found.", code: "USER_NOT_FOUND" });
  }

  // Mutual groups: groups where both the viewer and the profile user are active members
  const mutualMemberships = await prisma.membership.findMany({
    where: {
      userId: user.id,
      status: "active",
      group: {
        memberships: { some: { userId: currentUser.id, status: "active" } },
      },
    },
    select: {
      group: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  return reply.send({
    user: {
      ...user,
      mutualGroups: mutualMemberships.map((m: { group: { id: string; name: string; avatarUrl: string | null } }) => m.group),
    },
  });
});

app.patch("/users/me", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(updateUserBodySchema, request.body);

  const dataToUpdate: Record<string, unknown> = {};
  if (body.name !== undefined) dataToUpdate.name = body.name;
  if (body.avatarUrl !== undefined) dataToUpdate.avatarUrl = body.avatarUrl;
  if (body.theme !== undefined) dataToUpdate.theme = body.theme;

  // When avatarUrl changes, delete the old S3 object (avatars only — keyed under avatars/)
  if (body.avatarUrl !== undefined) {
    const existingUser = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { avatarUrl: true },
    });
    const oldUrl = existingUser?.avatarUrl;
    if (oldUrl && oldUrl !== body.avatarUrl) {
      // Extract the object key: everything after /{bucket}/
      const bucketPrefix = `/${s3Bucket}/`;
      const keyIdx = oldUrl.indexOf(bucketPrefix);
      if (keyIdx !== -1) {
        const oldKey = oldUrl.slice(keyIdx + bucketPrefix.length);
        if (oldKey.startsWith("avatars/")) {
          try {
            await s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: oldKey }));
          } catch (err) {
            app.log.warn({ err, oldKey }, "Failed to delete old avatar from S3");
          }
        }
      }
    }
  }

  if (body.username !== undefined) {
    const existing = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { username: true, usernameChangedAt: true },
    });
    if (existing?.username !== null && existing?.usernameChangedAt) {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      if (existing.usernameChangedAt > oneYearAgo) {
        const nextAllowed = new Date(existing.usernameChangedAt);
        nextAllowed.setFullYear(nextAllowed.getFullYear() + 1);
        return reply.status(422).send({
          error: "Username can only be changed once per year.",
          code: "USERNAME_CHANGE_TOO_SOON",
          nextAllowedAt: nextAllowed.toISOString(),
        });
      }
    }
    const conflict = await prisma.user.findUnique({ where: { username: body.username } });
    if (conflict && conflict.id !== currentUser.id) {
      return reply.status(409).send({ error: "Username already taken.", code: "USERNAME_TAKEN" });
    }
    dataToUpdate.username = body.username;
    dataToUpdate.usernameChangedAt = new Date();
  }

  const user = await prisma.user.update({
    where: { id: currentUser.id },
    data: dataToUpdate,
    select: { id: true, email: true, name: true, username: true, usernameChangedAt: true, avatarUrl: true, theme: true, createdAt: true },
  });

  return reply.send({ user });
});

// ============================================================================
// User Mute Routes (per-user notification silencing)
// ============================================================================

// POST /users/:userId/mute — current user mutes another user
app.post("/users/:userId/mute", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { userId } = request.params as { userId: string };

  if (userId === currentUser.id) {
    return reply.status(400).send({ error: "Cannot mute yourself.", code: "CANNOT_MUTE_SELF" });
  }

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) {
    return reply.status(404).send({ error: "User not found.", code: "USER_NOT_FOUND" });
  }

  await prisma.userMute.upsert({
    where: { muterId_mutedId: { muterId: currentUser.id, mutedId: userId } },
    create: { muterId: currentUser.id, mutedId: userId },
    update: {},
  });

  return reply.status(200).send({ muted: true });
});

// DELETE /users/:userId/mute — current user unmutes another user
app.delete("/users/:userId/mute", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { userId } = request.params as { userId: string };

  await prisma.userMute.deleteMany({
    where: { muterId: currentUser.id, mutedId: userId },
  });

  return reply.status(200).send({ muted: false });
});

// GET /users/muted — list users that the current user has muted
app.get("/users/muted", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);

  const mutes = await prisma.userMute.findMany({
    where: { muterId: currentUser.id },
    select: {
      mutedId: true,
      createdAt: true,
      muted: { select: { id: true, name: true, username: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return reply.send({ mutedUsers: mutes.map((m) => ({ ...m.muted, mutedAt: m.createdAt })) });
});

// ============================================================================
// Beta Code Routes
// ============================================================================

app.post("/admin/beta-codes", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(createBetaCodeBodySchema, request.body);

  // Only allow users with BETA_ADMIN_SECRET header to generate codes
  const adminSecret = process.env.BETA_ADMIN_SECRET;
  const providedSecret = (request.headers as Record<string, string>)["x-admin-secret"];
  if (!adminSecret || providedSecret !== adminSecret) {
    return reply.status(403).send({ error: "Access denied" });
  }

  const count = body.count ?? 1;
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = body.code && count === 1
      ? body.code
      : randomBytes(6).toString("hex").toUpperCase().slice(0, 12);
    const betaCode = await prisma.betaCode.create({
      data: { code, type: body.type },
    });
    codes.push(betaCode);
  }

  return reply.status(201).send({ codes });
});

app.post("/beta/validate", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = await validateRequest(useBetaCodeBodySchema, request.body);

  const betaCode = await prisma.betaCode.findUnique({ where: { code: body.code } });

  if (!betaCode || betaCode.type !== body.type || betaCode.usedAt !== null) {
    return reply.status(400).send({ error: "Invalid or already used code.", code: "INVALID_BETA_CODE" });
  }

  return reply.send({ valid: true, type: betaCode.type });
});

// ============================================================================
// Admin Developer Panel Routes
// ============================================================================

// ADMIN_EMAILS is defined at module level above

async function requireAdminEmail(request: FastifyRequest, reply: FastifyReply, prisma: PrismaClient) {
  const currentUser = await requireAuth(request, reply, prisma);
  if (!ADMIN_EMAILS.includes(currentUser.email.toLowerCase())) {
    reply.status(403).send({ error: "Access denied. Developer panel is restricted.", code: "FORBIDDEN" });
    throw new Error("FORBIDDEN");
  }
  return currentUser;
}

const updateDevConfigBodySchema = z.object({
  registrationInviteCode: z.string().min(1).max(64).optional(),
  groupCreationInviteCode: z.string().min(1).max(64).optional(),
});

const createDevGroupCodeBodySchema = z.object({
  count: z.number().int().min(1).max(20).optional(),
});

// GET /admin/dev/config — fetch current developer configuration
app.get("/admin/dev/config", async (request, reply) => {
  await requireAdminEmail(request, reply, prisma);

  // Registration invite code: Redis override takes priority over env var
  const redisRegCode = await redis.get("admin:registration_invite_code");
  const registrationInviteCode = redisRegCode ?? process.env.REGISTRATION_INVITE_CODE ?? "";

  // Group creation persistent code: Redis override takes priority over env var
  const redisGroupCode = await redis.get("admin:group_creation_invite_code");
  const groupCreationInviteCode = redisGroupCode ?? process.env.GROUP_CREATION_INVITE_CODE ?? "";

  // Unused one-time group creation codes
  const groupCodes = await prisma.betaCode.findMany({
    where: { type: "group_creation", usedAt: null },
    select: { id: true, code: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Unused one-time registration codes
  const registrationCodes = await prisma.betaCode.findMany({
    where: { type: "registration", usedAt: null },
    select: { id: true, code: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return reply.send({
    registrationInviteCode,
    groupCreationInviteCode,
    registrationBetaRequired: process.env.REGISTRATION_BETA_REQUIRED === "true",
    groupCreationBetaRequired: process.env.GROUP_CREATION_BETA_REQUIRED === "true",
    groupCodes,
    registrationCodes,
  });
});

// PATCH /admin/dev/config — update registration and/or group creation invite codes
app.patch("/admin/dev/config", async (request, reply) => {
  await requireAdminEmail(request, reply, prisma);
  const body = await validateRequest(updateDevConfigBodySchema, request.body);

  if (body.registrationInviteCode !== undefined) {
    const code = body.registrationInviteCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 64);
    if (code.length < 4) {
      return reply.status(400).send({ error: "Code must be at least 4 characters", code: "INVALID_CODE" });
    }
    await redis.set("admin:registration_invite_code", code);
  }

  if (body.groupCreationInviteCode !== undefined) {
    const code = body.groupCreationInviteCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 64);
    if (code.length < 4) {
      return reply.status(400).send({ error: "Code must be at least 4 characters", code: "INVALID_CODE" });
    }
    await redis.set("admin:group_creation_invite_code", code);
  }

  // Return updated config
  const registrationInviteCode = await redis.get("admin:registration_invite_code")
    ?? process.env.REGISTRATION_INVITE_CODE ?? "";
  const groupCreationInviteCode = await redis.get("admin:group_creation_invite_code")
    ?? process.env.GROUP_CREATION_INVITE_CODE ?? "";

  return reply.send({ registrationInviteCode, groupCreationInviteCode });
});

// POST /admin/dev/group-codes — generate new group creation codes
app.post("/admin/dev/group-codes", async (request, reply) => {
  await requireAdminEmail(request, reply, prisma);
  const body = await validateRequest(createDevGroupCodeBodySchema, request.body);

  const count = body.count ?? 1;
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(6).toString("hex").toUpperCase().slice(0, 12);
    const betaCode = await prisma.betaCode.create({
      data: { code, type: "group_creation" },
    });
    codes.push(betaCode);
  }

  return reply.status(201).send({ codes });
});

// DELETE /admin/dev/group-codes/:id — delete (revoke) a group creation code
app.delete("/admin/dev/group-codes/:id", async (request, reply) => {
  await requireAdminEmail(request, reply, prisma);
  const params = await validateRequest(z.object({ id: schemas.id }), request.params);

  await prisma.betaCode.delete({ where: { id: params.id } });

  return reply.send({ success: true });
});

// POST /admin/dev/registration-codes — generate new one-time registration codes
app.post("/admin/dev/registration-codes", async (request, reply) => {
  await requireAdminEmail(request, reply, prisma);
  const body = await validateRequest(createDevGroupCodeBodySchema, request.body);

  const count = body.count ?? 1;
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(6).toString("hex").toUpperCase().slice(0, 12);
    const betaCode = await prisma.betaCode.create({
      data: { code, type: "registration" },
    });
    codes.push(betaCode);
  }

  return reply.status(201).send({ codes });
});

// DELETE /admin/dev/registration-codes/:id — delete (revoke) a one-time registration code
app.delete("/admin/dev/registration-codes/:id", async (request, reply) => {
  await requireAdminEmail(request, reply, prisma);
  const params = await validateRequest(z.object({ id: schemas.id }), request.params);

  await prisma.betaCode.delete({ where: { id: params.id } });

  return reply.send({ success: true });
});

// ============================================================================
// Tags CRUD Routes
// ============================================================================

app.get("/groups/:groupId/tags", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const tags = await prisma.tag.findMany({
    where: { groupId: params.groupId },
    orderBy: { name: "asc" },
  });

  return reply.send({ tags });
});

app.post("/groups/:groupId/tags", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);
  const body = await validateRequest(createTagBodySchema, request.body);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const tag = await prisma.tag.create({
    data: {
      groupId: params.groupId,
      name: body.name,
      color: body.color,
    },
  });

  return reply.status(201).send({ tag });
});

app.patch("/groups/:groupId/tags/:tagId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(tagParamsSchema, request.params);
  const body = await validateRequest(updateTagBodySchema, request.body);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const tag = await prisma.tag.findFirst({
    where: { id: params.tagId, groupId: params.groupId },
  });

  if (!tag) {
    return reply.status(404).send({ error: "Tag not found", code: "NOT_FOUND" });
  }

  const updated = await prisma.tag.update({
    where: { id: params.tagId },
    data: {
      name: body.name,
      color: body.color,
    },
  });

  return reply.send({ tag: updated });
});

app.delete("/groups/:groupId/tags/:tagId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(tagParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const tag = await prisma.tag.findFirst({
    where: { id: params.tagId, groupId: params.groupId },
  });

  if (!tag) {
    return reply.status(404).send({ error: "Tag not found", code: "NOT_FOUND" });
  }

  await prisma.tag.delete({ where: { id: params.tagId } });
  return reply.status(204).send();
});

// ============================================================================
// Channel CRUD Routes
// ============================================================================

app.get("/groups/:groupId/channels", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const channels = await prisma.channel.findMany({
    where: { groupId: params.groupId },
    include: {
      _count: { select: { subscriptions: true, messages: true } },
      subscriptions: {
        where: { userId: currentUser.id },
        select: { id: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return reply.send({
    channels: channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      isInviteOnly: ch.isInviteOnly,
      subscriberCount: ch._count.subscriptions,
      messageCount: ch._count.messages,
      isSubscribed: ch.subscriptions.length > 0,
    })),
  });
});

app.post("/groups/:groupId/channels", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);
  const body = await validateRequest(createChannelBodySchema, request.body);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const channel = await prisma.channel.create({
    data: {
      groupId: params.groupId,
      name: body.name,
      isInviteOnly: body.isInviteOnly ?? false,
    },
  });

  return reply.status(201).send({ channel });
});

app.post("/groups/:groupId/channels/:channelId/subscribe", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(channelParamsSchema, request.params);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const channel = await prisma.channel.findFirst({
    where: { id: params.channelId, groupId: params.groupId },
  });

  if (!channel) {
    return reply.status(404).send({ error: "Channel not found", code: "NOT_FOUND" });
  }

  const subscription = await prisma.channelSubscription.upsert({
    where: { userId_channelId: { userId: currentUser.id, channelId: params.channelId } },
    update: {},
    create: { userId: currentUser.id, channelId: params.channelId },
  });

  return reply.status(201).send({ subscription });
});

app.delete("/groups/:groupId/channels/:channelId/subscribe", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(channelParamsSchema, request.params);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const existing = await prisma.channelSubscription.findUnique({
    where: { userId_channelId: { userId: currentUser.id, channelId: params.channelId } },
  });

  if (!existing) {
    return reply.status(404).send({ error: "Not subscribed", code: "NOT_FOUND" });
  }

  await prisma.channelSubscription.delete({
    where: { userId_channelId: { userId: currentUser.id, channelId: params.channelId } },
  });

  return reply.status(204).send();
});

app.get("/groups/:groupId/channels/:channelId/messages", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(channelParamsSchema, request.params);
  const query = await validateRequest(channelMessagesQuerySchema, request.query);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const channel = await prisma.channel.findFirst({
    where: { id: params.channelId, groupId: params.groupId },
  });

  if (!channel) {
    return reply.status(404).send({ error: "Channel not found", code: "NOT_FOUND" });
  }

  let cursorFilter: object | undefined;
  if (query.before) {
    const ref = await prisma.message.findUnique({
      where: { id: query.before },
      select: { createdAt: true },
    });
    if (ref) {
      cursorFilter = { createdAt: { lt: ref.createdAt } };
    }
  }

  const raw = await prisma.message.findMany({
    where: { channelId: params.channelId, ...cursorFilter },
    orderBy: { createdAt: "desc" },
    take: query.limit + 1,
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  const hasMore = raw.length > query.limit;
  const messages = raw.slice(0, query.limit).reverse();

  return reply.send({ messages, hasMore });
});

// ============================================================================
// Message Reactions Routes
// ============================================================================

app.post("/events/:id/messages/:messageId/reactions", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(reactionAddParamsSchema, request.params);
  const body = await validateRequest(reactionBodySchema, request.body);

  await canAccessEvent(prisma, params.id, currentUser.id);

  const message = await prisma.message.findFirst({
    where: { id: params.messageId, eventId: params.id },
  });

  if (!message) {
    return reply.status(404).send({ error: "Message not found", code: "NOT_FOUND" });
  }

  const reaction = await prisma.messageReaction.upsert({
    where: {
      messageId_userId_emoji: {
        messageId: params.messageId,
        userId: currentUser.id,
        emoji: body.emoji,
      },
    },
    update: {},
    create: {
      messageId: params.messageId,
      userId: currentUser.id,
      emoji: body.emoji,
    },
  });

  return reply.status(201).send({ reaction });
});

app.delete("/events/:id/messages/:messageId/reactions/:emoji", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(reactionParamsSchema, request.params);

  await canAccessEvent(prisma, params.id, currentUser.id);

  const existing = await prisma.messageReaction.findUnique({
    where: {
      messageId_userId_emoji: {
        messageId: params.messageId,
        userId: currentUser.id,
        emoji: params.emoji,
      },
    },
  });

  if (!existing) {
    return reply.status(404).send({ error: "Reaction not found", code: "NOT_FOUND" });
  }

  await prisma.messageReaction.delete({
    where: { id: existing.id },
  });

  return reply.status(204).send();
});

// ============================================================================
// Notification Preferences by Type Routes
// ============================================================================

app.get("/notifications/preferences", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);

  const preferences = await prisma.userNotificationPreference.findMany({
    where: { userId: currentUser.id },
    orderBy: [{ type: "asc" }, { channel: "asc" }],
  });

  return reply.send({ preferences });
});

app.put("/notifications/preferences", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(notificationPreferencesBodySchema, request.body);

  const results = [];
  for (const pref of body) {
    const result = await prisma.userNotificationPreference.upsert({
      where: {
        userId_type_channel: {
          userId: currentUser.id,
          type: pref.type,
          channel: pref.channel,
        },
      },
      update: { enabled: pref.enabled },
      create: {
        userId: currentUser.id,
        type: pref.type,
        channel: pref.channel,
        enabled: pref.enabled,
      },
    });
    results.push(result);
  }

  return reply.send({ preferences: results });
});

// ============================================================================
// Event Rating Routes
// ============================================================================

// GET /events/:id/ratings — get aggregate rating + current user's rating
app.get("/events/:id/ratings", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);

  await canAccessEvent(prisma, params.id, currentUser.id);

  const ratings = await prisma.eventRating.findMany({
    where: { eventId: params.id },
    select: { value: true, userId: true },
  });

  const avgRating = ratings.length > 0
    ? Math.round((ratings.reduce((s, r) => s + r.value, 0) / ratings.length) * 10) / 10
    : null;
  const myRating = ratings.find((r) => r.userId === currentUser.id)?.value ?? null;

  return reply.send({ avgRating, myRating, ratingCount: ratings.length });
});

// POST /events/:id/ratings — upsert current user's rating (1-5 stars)
app.post("/events/:id/ratings", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const body = await validateRequest(eventRatingBodySchema, request.body);

  await canAccessEvent(prisma, params.id, currentUser.id);

  const rating = await prisma.eventRating.upsert({
    where: { eventId_userId: { eventId: params.id, userId: currentUser.id } },
    create: { eventId: params.id, userId: currentUser.id, value: body.value },
    update: { value: body.value },
  });

  return reply.send({ rating });
});

// PATCH /events/:id/tags — any group member can set tags on an event (existing tags only)
app.patch("/events/:id/tags", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const body = await validateRequest(eventTagsBodySchema, request.body);

  const access = await canAccessEvent(prisma, params.id, currentUser.id);

  // Validate all tagIds belong to the event's group
  if (body.tagIds.length > 0) {
    const validTags = await prisma.tag.findMany({
      where: { id: { in: body.tagIds }, groupId: access.event.groupId },
      select: { id: true },
    });
    if (validTags.length !== body.tagIds.length) {
      return reply.status(400).send({ error: "One or more tags do not belong to this group", code: "INVALID_TAG" });
    }
  }

  const event = await prisma.event.update({
    where: { id: params.id },
    data: {
      tags: { set: body.tagIds.map((id: string) => ({ id })) },
    },
    include: { tags: true },
  });

  return reply.send({ event });
});



// ============================================================================
// Startup
// ============================================================================

const port = Number(process.env.PORT || 4000);
const host = process.env.API_HOST || (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");

// Attach Socket.IO to the underlying HTTP server before listening
const io = createChatServer(
  app.server,
  prisma,
  authSecret,
  configuredWebOrigins,
  app.log,
  async ({ eventId, userId, content }) => {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        groupId: true,
        title: true,
        tags: { select: { id: true } },
      },
    });

    if (!event) {
      return;
    }

    await notificationQueue.add("fanout", {
      type: "chat_message",
      groupId: event.groupId,
      actorUserId: userId,
      eventId: event.id,
      tagIds: event.tags.map((tag) => tag.id),
      title: `New message in ${event.title}`,
      body: content.slice(0, 140),
    });
  },
  async ({ channelId, groupId, userId, content }) => {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, name: true },
    });
    if (!channel) return;
    await notificationQueue.add("fanout", {
      type: "chat_message",
      groupId,
      actorUserId: userId,
      channelId: channel.id,
      tagIds: [],
      title: `New message in #${channel.name}`,
      body: content.slice(0, 140),
    });
  }
);

await app.listen({ port, host });

// Graceful shutdown
const gracefulShutdown = async () => {
  await calendarSyncWorker.close();
  await calendarSyncQueue.close();
  await notificationWorker.close();
  await notificationQueue.close();
  workerConnection.disconnect();
  queueConnection.disconnect();
  await io.close();
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
