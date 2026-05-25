import "dotenv/config"; // reloaded: 2026-04-16
import ms from "ms";
import * as Sentry from "@sentry/node";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { PrismaClient } from "./generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { Redis } from "ioredis";
import { randomUUID, scrypt, randomBytes, timingSafeEqual, createHash } from "crypto";
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

// P2 security: Hash OTP codes with SHA-256 before storing in Redis.
// Mitigates Redis compromise: all active OTPs cannot be bulk-harvested.
function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function verifyOtp(code: string, storedHash: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(hashOtp(code)), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

// Generates a weak ETag from an ISO-8601 updatedAt string. Compact and cheap.
function weakETag(updatedAt: string | Date): string {
  const ms = typeof updatedAt === "string" ? new Date(updatedAt).getTime() : updatedAt.getTime();
  return `W/"${ms.toString(36)}"`;
}

function sanitizeNotifText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 200);
}

// P3: Strip control chars and truncate user-controlled values before they appear
// in log entries, preventing log injection into SIEM / aggregator rules.
function sanitizeForLog(s: string, maxLen = 200): string {
  return s.replace(/[\r\n\t]/g, " ").slice(0, maxLen);
}
import multipart from "@fastify/multipart";
import { createReadStream, readFileSync } from "fs";
import { readFile, stat } from "fs/promises";
import { join, resolve } from "path";
import exifr from "exifr";
import { imageSize } from "image-size";
import {
  saveUploadedFile,
  deleteUploadedFile,
  UPLOAD_DIR,
  AVATAR_MAX_FILE_BYTES,
  MEDIA_MAX_FILE_BYTES,
  MEDIA_GLOBAL_MAX_BYTES,
  MEDIA_GROUP_DEFAULT_LIMIT_BYTES,
  MEDIA_GROUP_MAX_LIMIT_BYTES,
  ALLOWED_MIME_TYPES,
  formatBytes,
} from "./lib/upload.js";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Queue, Worker } from "bullmq";
import { errorHandler } from "./lib/errors.js";
import { validateRequest, schemas } from "./lib/validation.js";
import { requireAuth } from "./middleware/auth.js";
import { makeCache } from "./lib/cache.js";
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
import type { Server as SocketIOServer } from "socket.io";

// Assigned at startup after createChatServer(); route handlers run after that so
// this is always defined by the time any request arrives.
let chatIo: SocketIOServer | undefined;
import {
  buildNotificationEmail,
  configureWebPushFromEnv,
  isWebPushConfigured,
  sendPushNotification,
} from "./lib/notifications.js";
import { escapeHtml, getMailTransporter, isMailConfigured, sendTransactionalEmail, verifyMailTransporter } from "./lib/mailer.js";
import { buildGoogleCalendarLink, buildIcsCalendar } from "./lib/calendar.js";
import { reportError } from "./lib/errorReporter.js";

// Initialize clients

// P3: Enforce TLS for Redis in production (skip for loopback — no TLS needed on localhost).
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redisIsLoopback = /^rediss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(redisUrl);
if (process.env.NODE_ENV === "production" && !redisIsLoopback && !redisUrl.startsWith("rediss://")) {
  throw new Error("Production Redis must use TLS — set REDIS_URL to a rediss:// connection string");
}

// P3: Enforce SSL for Postgres in production (skip for loopback — no TLS needed on localhost).
const connectionString = process.env.DATABASE_URL || "postgresql://gem:gem@localhost:5432/gem_dev";
const dbIsLoopback = /[@/](127\.0\.0\.1|localhost)(:\d+)?\//.test(connectionString);
if (process.env.NODE_ENV === "production" && !dbIsLoopback && !connectionString.includes("sslmode=")) {
  throw new Error("Production DATABASE_URL must include sslmode=require");
}

// P4: Explicit pool limits prevent connection exhaustion on free-tier Postgres.
const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.NODE_ENV === "production" && !dbIsLoopback ? { rejectUnauthorized: true } : false,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const redis = new Redis(redisUrl);
const cache = makeCache(redis);
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "minioadmin",
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

const s3Bucket = process.env.S3_BUCKET || "gem-media";
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

const queueConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});
const workerConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

// P3: Namespaced prefix prevents Redis key collisions if the instance is shared.
// Braces enable hash-slot consistency on Redis Cluster.
const QUEUE_PREFIX = "{gem}";

const notificationQueue = new Queue<NotificationFanoutJobData>(
  "notification-fanout",
  {
    connection: queueConnection,
    prefix: QUEUE_PREFIX,
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
  prefix: QUEUE_PREFIX,
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

    if (data.type !== "event_start" && data.type !== "mention" && data.eventId) {
      const evt = await prisma.event.findUnique({
        where: { id: data.eventId },
        select: { dateTime: true },
      });
      if (evt && evt.dateTime < new Date()) {
        return;
      }
    }

    // event_start: resolve recipients from yes-RSVPers, filtered by their chosen reminder offset
    if (data.type === "event_start" && data.eventId) {
      const firedOffset = data.reminderOffsetMinutes ?? 15;

      const yesRsvps = await prisma.rSVP.findMany({
        where: { eventId: data.eventId, status: "yes" },
        select: { userId: true },
      });
      const rsvpUserIds = yesRsvps.map((r) => r.userId);
      if (rsvpUserIds.length === 0) return;

      const users = await prisma.user.findMany({
        where: { id: { in: rsvpUserIds } },
        select: { id: true, email: true },
      });

      // Batch-fetch all prefs and subscriptions — avoids N×3 findUnique calls in the loop
      const [eventStartPrefs, eventStartSubs] = await Promise.all([
        prisma.userNotificationPreference.findMany({
          where: { userId: { in: rsvpUserIds }, type: "event_start" },
        }),
        prisma.notificationSubscription.findMany({
          where: { userId: { in: rsvpUserIds } },
        }),
      ]);
      const eventStartPrefsMap = new Map<string, Map<string, typeof eventStartPrefs[0]>>();
      for (const pref of eventStartPrefs) {
        if (!eventStartPrefsMap.has(pref.userId)) eventStartPrefsMap.set(pref.userId, new Map());
        eventStartPrefsMap.get(pref.userId)!.set(pref.channel, pref);
      }
      const eventStartSubsMap = new Map(eventStartSubs.map((s) => [s.userId, s]));

      for (const user of users) {
        const pushPref = eventStartPrefsMap.get(user.id)?.get("push");
        const emailPref = eventStartPrefsMap.get(user.id)?.get("email");
        const inAppPref = eventStartPrefsMap.get(user.id)?.get("in_app");

        // Default: enabled at 15 min for all channels
        const pushEnabled = (pushPref ? pushPref.enabled : true) && (pushPref?.reminderOffsetMinutes ?? 15) === firedOffset;
        const emailEnabled = (emailPref ? emailPref.enabled : true) && (emailPref?.reminderOffsetMinutes ?? 15) === firedOffset;
        const inAppEnabled = (inAppPref ? inAppPref.enabled : true) && (inAppPref?.reminderOffsetMinutes ?? 15) === firedOffset;

        if (!pushEnabled && !emailEnabled && !inAppEnabled) continue;

        try {
          if (inAppEnabled) {
            await prisma.notificationEvent.create({
              data: {
                type: data.type,
                recipientId: user.id,
                eventId: data.eventId,
                title: data.title,
                body: data.body,
                url: data.url ?? null,
                sentAt: new Date(),
              },
            });
          }
        } catch (error) {
          const message = (error as Error).message || "";
          if (message.includes("NotificationEvent_eventId_fkey")) continue;
          throw error;
        }

        if (pushEnabled) {
          const subscription = eventStartSubsMap.get(user.id);
          if (subscription && isWebPushConfigured()) {
            try {
              await sendPushNotification(
                { endpoint: subscription.endpoint, authSecret: subscription.authSecret, p256dh: subscription.p256dh },
                { title: data.title, body: data.body, url: data.url, eventId: data.eventId, type: data.type }
              );
            } catch (error) {
              const statusCode = (error as { statusCode?: number }).statusCode;
              if (statusCode === 404 || statusCode === 410) {
                await prisma.notificationSubscription.delete({ where: { userId: user.id } });
                eventStartSubsMap.delete(user.id);
              }
            }
          }
        }

        if (emailEnabled && isMailConfigured()) {
          const webBase = (process.env.WEB_BASE_URL || "").replace(/\/$/, "");
          const ctaUrl = data.eventId ? `${webBase}/events/${data.eventId}` : webBase || undefined;
          const email = buildNotificationEmail({ title: data.title, body: data.body, ctaUrl });
          await sendTransactionalEmail({ to: user.email, subject: data.title, html: email.html, text: email.text });
        }
      }
      return;
    }

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

    const isEventNotification = data.type === "event_created" || data.type === "event_changed";
    const hasNoTags = !Array.isArray(data.tagIds) || data.tagIds.length === 0;

    if (isEventNotification && hasNoTags) {
      // Exclude members who opted out of untagged event notifications for this group
      const optedOut = await prisma.membership.findMany({
        where: {
          userId: { in: Array.from(recipientIds) },
          groupId: data.groupId,
          notifyUntaggedEvents: false,
        },
        select: { userId: true },
      });
      for (const { userId } of optedOut) recipientIds.delete(userId);
    } else if (Array.isArray(data.tagIds) && data.tagIds.length > 0) {
      // Default is subscribed — exclude users who explicitly opted out of ALL the event's tags
      const optedOut = await prisma.userTagPreference.findMany({
        where: {
          userId: { in: Array.from(recipientIds) },
          tagId: { in: data.tagIds },
          subscribed: false,
        },
        select: { userId: true, tagId: true },
      });
      const optOutByUser = new Map<string, Set<string>>();
      for (const { userId, tagId } of optedOut) {
        if (!optOutByUser.has(userId)) optOutByUser.set(userId, new Set());
        optOutByUser.get(userId)!.add(tagId);
      }
      for (const [userId, tags] of optOutByUser) {
        if (data.tagIds.every((id) => tags.has(id))) recipientIds.delete(userId);
      }
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

    const recipientUserIds = Array.from(recipientIds);
    const users = await prisma.user.findMany({
      where: { id: { in: recipientUserIds } },
      select: { id: true, email: true },
    });

    // Batch-fetch all prefs and subscriptions — avoids N×3 findUnique calls in the loop
    const [fanoutPrefs, fanoutSubs] = await Promise.all([
      prisma.userNotificationPreference.findMany({
        where: { userId: { in: recipientUserIds }, type: data.type },
      }),
      prisma.notificationSubscription.findMany({
        where: { userId: { in: recipientUserIds } },
      }),
    ]);
    const fanoutPrefsMap = new Map<string, Map<string, typeof fanoutPrefs[0]>>();
    for (const pref of fanoutPrefs) {
      if (!fanoutPrefsMap.has(pref.userId)) fanoutPrefsMap.set(pref.userId, new Map());
      fanoutPrefsMap.get(pref.userId)!.set(pref.channel, pref);
    }
    const fanoutSubsMap = new Map(fanoutSubs.map((s) => [s.userId, s]));

    for (const user of users) {
      try {
        await prisma.notificationEvent.create({
          data: {
            type: data.type,
            recipientId: user.id,
            eventId: data.eventId,
            title: data.title,
            body: data.body,
            url: data.url ?? null,
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

      const pushPref = fanoutPrefsMap.get(user.id)?.get("push");
      const pushEnabled = pushPref ? pushPref.enabled : true;

      const emailPref = fanoutPrefsMap.get(user.id)?.get("email");
      const emailEnabled = emailPref ? emailPref.enabled : true;

      if (pushEnabled) {
        const subscription = fanoutSubsMap.get(user.id);
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
                url: data.url,
                eventId: data.eventId,
                type: data.type,
              }
            );
          } catch (error) {
            const statusCode = (error as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              await prisma.notificationSubscription.delete({ where: { userId: user.id } });
              fanoutSubsMap.delete(user.id);
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
  { connection: workerConnection, prefix: QUEUE_PREFIX, concurrency: 5 }
);

notificationWorker.on("failed", (job, error) => {
  if (sentryEnabled) {
    Sentry.captureException(error, {
      tags: { worker: "notification-fanout" },
      extra: { jobId: job?.id },
    });
  }
  void reportError(error, { source: "worker", jobId: job?.id, url: "notification-fanout" });
  app.log.error({ jobId: job?.id, err: error.message }, "Notification fanout job failed");
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
  { connection: workerConnection, prefix: QUEUE_PREFIX, concurrency: 5 }
);

calendarSyncWorker.on("failed", (job, error) => {
  if (sentryEnabled) {
    Sentry.captureException(error, {
      tags: { worker: "calendar-sync" },
      extra: { jobId: job?.id },
    });
  }
  void reportError(error, { source: "worker", jobId: job?.id, url: "calendar-sync" });
  app.log.error({ jobId: job?.id, err: error.message }, "Calendar sync job failed");
});

// ============================================================================
// Demo Cleanup Queue — auto-deletes demo user data after 5 minutes
// ============================================================================

interface DemoCleanupJobData {
  sessionId: string;
  userId: string;
  deviceId: string;
}

const DEMO_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const DEMO_MAX_CONCURRENT = 5;
const DEMO_SESSION_KEY = (id: string) => `demo:session:${id}`;
const DEMO_DEVICE_KEY = (deviceId: string) => `demo:device:${deviceId}`;
const DEMO_ACTIVE_SET = "demo:active_ids";
const DEMO_QUEUE_ZSET = "demo:queue";

async function cleanupDemoSession(sessionId: string, userId: string, deviceId: string) {
  // Retrieve dummy user IDs stored at session creation
  const dummyIdsRaw = await redis.hget(DEMO_SESSION_KEY(sessionId), "dummyUserIds");
  const dummyUserIds: string[] = dummyIdsRaw ? JSON.parse(dummyIdsRaw) : [];

  try {
    await prisma.group.deleteMany({ where: { ownerId: userId } });
  } catch {
    // already gone
  }
  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch {
    // already gone
  }
  // Delete dummy (non-real) users created for this session
  if (dummyUserIds.length > 0) {
    try {
      await prisma.user.deleteMany({ where: { id: { in: dummyUserIds } } });
    } catch {
      // already gone
    }
  }
  await redis.del(DEMO_SESSION_KEY(sessionId));
  await redis.srem(DEMO_ACTIVE_SET, sessionId);
  if (deviceId) await redis.del(DEMO_DEVICE_KEY(deviceId));
}

async function seedDemoData(demoUserId: string): Promise<string[]> {
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const daysFrom = (d: number) => new Date(now.getTime() + d * 86_400_000);
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  // Create 4 dummy users for this session (not real — deleted with session)
  const dummyProfiles = [
    { name: "Alex Kim",    username: `alex_${demoUserId.slice(0,6)}`,   email: `dummy-alex-${demoUserId}@gem-demo.internal` },
    { name: "Sam Rivera",  username: `sam_${demoUserId.slice(0,6)}`,    email: `dummy-sam-${demoUserId}@gem-demo.internal` },
    { name: "Jordan Lee",  username: `jordan_${demoUserId.slice(0,6)}`, email: `dummy-jordan-${demoUserId}@gem-demo.internal` },
    { name: "Casey Morgan",username: `casey_${demoUserId.slice(0,6)}`,  email: `dummy-casey-${demoUserId}@gem-demo.internal` },
  ];

  const dummyUsers = await Promise.all(
    dummyProfiles.map((p) =>
      prisma.user.create({
        data: { ...p, emailVerified: true, onboardingDone: true, passwordHash: "x" },
        select: { id: true, name: true },
      })
    )
  );
  const [alex, sam, jordan, casey] = dummyUsers;

  // ── Group 1: Weekend Hiking Club ──────────────────────────────────────────
  const hikeGroup = await prisma.group.create({
    data: {
      name: "Weekend Hiking Club",
      description: "We hike every weekend — all levels welcome. Bring snacks.",
      ownerId: demoUserId,
      inviteCode: randomBytes(6).toString("hex"),
      memberships: {
        create: [
          { userId: demoUserId, role: "owner",  status: "active" },
          { userId: alex.id,    role: "admin",  status: "active" },
          { userId: sam.id,     role: "member", status: "active" },
        ],
      },
      channels: {
        create: { name: "general", isInviteOnly: false },
      },
    },
    include: { channels: true },
  });

  const hikeChannel = hikeGroup.channels[0];

  const hikeEvent1 = await prisma.event.create({
    data: {
      groupId: hikeGroup.id,
      createdById: alex.id,
      title: "Sunset Peak Trail Run",
      details: "Meeting at the main trailhead. Bring water and sunscreen. Moderate difficulty, about 6 miles round trip.",
      dateTime: daysFrom(4),
      endsAt: new Date(daysFrom(4).getTime() + 3 * 3_600_000),
      location: "Sunset Peak Trailhead, Parking Lot B",
    },
  });
  const hikeEvent2 = await prisma.event.create({
    data: {
      groupId: hikeGroup.id,
      createdById: demoUserId,
      title: "Winter Summit Challenge",
      details: "Our annual winter hike. Layers required. This one is strenuous — plan for 5–6 hours.",
      dateTime: daysFrom(47),
      location: "Mount Ridgeline Summit, North Face",
    },
  });
  await prisma.event.create({
    data: {
      groupId: hikeGroup.id,
      createdById: sam.id,
      title: "Post-Hike BBQ",
      details: "Last month's hike wrap-up BBQ. Great weather, great people!",
      dateTime: daysAgo(8),
      endsAt: new Date(daysAgo(8).getTime() + 2 * 3_600_000),
      location: "Riverside Park Pavilion",
    },
  });

  // RSVPs for upcoming events
  await prisma.rSVP.createMany({
    data: [
      { eventId: hikeEvent1.id, userId: demoUserId, status: "yes" },
      { eventId: hikeEvent1.id, userId: alex.id,    status: "yes" },
      { eventId: hikeEvent1.id, userId: sam.id,     status: "maybe" },
      { eventId: hikeEvent2.id, userId: demoUserId, status: "yes" },
      { eventId: hikeEvent2.id, userId: alex.id,    status: "no" },
    ],
  });

  // Channel messages (back-dated for realism)
  await prisma.message.createMany({
    data: [
      { channelId: hikeChannel.id, userId: alex.id,    content: "Hey everyone! Trail map for Saturday is posted in the event details 🗺️", createdAt: hoursAgo(18) },
      { channelId: hikeChannel.id, userId: sam.id,     content: "Will there be parking at Lot B or should we carpool?", createdAt: hoursAgo(17) },
      { channelId: hikeChannel.id, userId: alex.id,    content: "Lot B usually has plenty of space early morning. Let's aim for 7am?", createdAt: hoursAgo(16) },
      { channelId: hikeChannel.id, userId: demoUserId, content: "7am works for me. See everyone there!", createdAt: hoursAgo(15) },
    ],
  });

  // ── Group 2: Movie Night Crew ──────────────────────────────────────────────
  const movieGroup = await prisma.group.create({
    data: {
      name: "Movie Night Crew",
      description: "Monthly movie nights + the occasional marathon. Popcorn mandatory.",
      ownerId: demoUserId,
      inviteCode: randomBytes(6).toString("hex"),
      memberships: {
        create: [
          { userId: demoUserId, role: "owner",  status: "active" },
          { userId: jordan.id,  role: "admin",  status: "active" },
          { userId: casey.id,   role: "member", status: "active" },
          { userId: alex.id,    role: "member", status: "active" },
        ],
      },
      channels: {
        create: { name: "general", isInviteOnly: false },
      },
    },
    include: { channels: true },
  });

  const movieChannel = movieGroup.channels[0];

  const movieEvent1 = await prisma.event.create({
    data: {
      groupId: movieGroup.id,
      createdById: jordan.id,
      title: "Marvel Marathon Night",
      details: "Starting with the original Iron Man and going as far as we can. Jordan is hosting — BYOB snacks.",
      dateTime: daysFrom(10),
      endsAt: new Date(daysFrom(10).getTime() + 6 * 3_600_000),
      location: "Jordan's Place",
      maxAttendees: 8,
    },
  });
  const movieEvent2 = await prisma.event.create({
    data: {
      groupId: movieGroup.id,
      createdById: demoUserId,
      title: "Classic Horror Double Feature",
      details: "Halloween vibes all year round. Two films TBD by vote in #general. Starts at 8pm sharp.",
      dateTime: daysFrom(23),
      location: "Casey's basement setup",
    },
  });

  await prisma.rSVP.createMany({
    data: [
      { eventId: movieEvent1.id, userId: demoUserId, status: "yes" },
      { eventId: movieEvent1.id, userId: jordan.id,  status: "yes" },
      { eventId: movieEvent1.id, userId: casey.id,   status: "yes" },
      { eventId: movieEvent1.id, userId: alex.id,    status: "maybe" },
      { eventId: movieEvent2.id, userId: demoUserId, status: "yes" },
      { eventId: movieEvent2.id, userId: casey.id,   status: "yes" },
    ],
  });

  await prisma.message.createMany({
    data: [
      { channelId: movieChannel.id, userId: jordan.id,  content: "OK so the Marvel marathon: are we doing MCU release order or story chronological order?", createdAt: hoursAgo(30) },
      { channelId: movieChannel.id, userId: casey.id,   content: "Release order obviously 😤 that's how we experienced it", createdAt: hoursAgo(29) },
      { channelId: movieChannel.id, userId: alex.id,    content: "I vote chronological just to mess with everyone", createdAt: hoursAgo(28) },
      { channelId: movieChannel.id, userId: demoUserId, content: "Release order. Starting with Iron Man is non-negotiable.", createdAt: hoursAgo(27) },
      { channelId: movieChannel.id, userId: jordan.id,  content: "Release order wins. Iron Man it is 🦾", createdAt: hoursAgo(26) },
    ],
  });

  // ── Group 3: Book Club ─────────────────────────────────────────────────────
  const bookGroup = await prisma.group.create({
    data: {
      name: "Book Club",
      description: "Monthly reads, big discussions. Currently working through sci-fi classics.",
      ownerId: demoUserId,
      inviteCode: randomBytes(6).toString("hex"),
      memberships: {
        create: [
          { userId: demoUserId, role: "owner",  status: "active" },
          { userId: sam.id,     role: "member", status: "active" },
          { userId: jordan.id,  role: "member", status: "active" },
        ],
      },
      channels: {
        create: [
          { name: "general",      isInviteOnly: false },
          { name: "current-read", isInviteOnly: false },
        ],
      },
    },
    include: { channels: true },
  });

  const bookGeneralChannel = bookGroup.channels.find((c) => c.name === "general")!;
  const bookReadChannel    = bookGroup.channels.find((c) => c.name === "current-read")!;

  const bookEvent1 = await prisma.event.create({
    data: {
      groupId: bookGroup.id,
      createdById: sam.id,
      title: "Monthly Discussion: Project Hail Mary",
      details: "Chapters 1–15 this session. Come with theories. Spoilers allowed — we all agreed to read ahead if we want!",
      dateTime: daysFrom(6),
      endsAt: new Date(daysFrom(6).getTime() + 90 * 60_000),
      location: "Sam's living room (or video call)",
    },
  });
  await prisma.event.create({
    data: {
      groupId: bookGroup.id,
      createdById: demoUserId,
      title: "Next Month Vote — Pick Our Book",
      details: "Three candidates on the table: Dune, The Martian, or Blindsight. Vote in the channel before Friday.",
      dateTime: daysFrom(31),
    },
  });

  await prisma.rSVP.createMany({
    data: [
      { eventId: bookEvent1.id, userId: demoUserId, status: "yes" },
      { eventId: bookEvent1.id, userId: sam.id,     status: "yes" },
      { eventId: bookEvent1.id, userId: jordan.id,  status: "maybe" },
    ],
  });

  await prisma.message.createMany({
    data: [
      { channelId: bookGeneralChannel.id, userId: sam.id,     content: "Just finished chapter 10 and I have SO many questions 🤯", createdAt: daysAgo(2) },
      { channelId: bookGeneralChannel.id, userId: jordan.id,  content: "Same, no spoilers from me but wow the reveal is wild", createdAt: daysAgo(2) },
      { channelId: bookGeneralChannel.id, userId: demoUserId, content: "I'm on chapter 12 — this might be my favorite book we've read", createdAt: daysAgo(1) },
      { channelId: bookReadChannel.id,    userId: sam.id,     content: "Theory: Rocky is the most interesting character in sci-fi in the last decade. Discuss.", createdAt: hoursAgo(5) },
      { channelId: bookReadChannel.id,    userId: jordan.id,  content: "100% agree. The communication chapters are brilliant.", createdAt: hoursAgo(4) },
      { channelId: bookReadChannel.id,    userId: demoUserId, content: "The way Weir builds their relationship is just chef's kiss", createdAt: hoursAgo(3) },
    ],
  });

  return dummyUsers.map((u) => u.id);
}

const demoCleanupQueue = new Queue<DemoCleanupJobData>("demo-cleanup", {
  connection: queueConnection,
  prefix: QUEUE_PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

const demoCleanupWorker = new Worker<DemoCleanupJobData>(
  "demo-cleanup",
  async (job) => {
    const { sessionId, userId, deviceId } = job.data;
    await cleanupDemoSession(sessionId, userId, deviceId);
  },
  { connection: workerConnection, prefix: QUEUE_PREFIX, concurrency: 5 }
);

demoCleanupWorker.on("failed", (job, error) => {
  app.log.error({ jobId: job?.id, err: error.message }, "Demo cleanup job failed");
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

// P1 security: JWT expiry must not exceed 30 days. Default: 7 days.
// Validates expiry on startup to prevent token hijacking.
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";
const validateJwtExpiry = () => {
  const expiryMs = ms(jwtExpiresIn as ms.StringValue);
  if (!expiryMs || expiryMs > ms("30d")) {
    throw new Error(
      `JWT_EXPIRES_IN must be a valid duration ≤ 30 days; got "${jwtExpiresIn}"`
    );
  }
  console.info(`[startup] JWT expiry configured: ${jwtExpiresIn} (${expiryMs / 1000}s)`);
};
validateJwtExpiry();

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
        "body.newPassword",
        "body.currentPassword",
        "body.token",
        "body.code",
        "body.otp",
        "body.resetCode",
        "body.verificationCode",
        "body.betaCode",
        "body.calendarToken",
        "body.p256dh",
        "body.auth",
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
  location: z.string().max(200).optional(),
  tagIds: z.array(schemas.id).max(3, "You can add up to 3 tags per event").optional(),
}).strict();

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
  location: z.string().max(200).nullable().optional(),
  tagIds: z.array(schemas.id).max(3, "You can add up to 3 tags per event").optional(),
}).strict();

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
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Birthdate must be in YYYY-MM-DD format"),
  betaCode: z.string().min(1).max(100).optional(),
  inviteToken: z.string().min(1).max(64).optional(),
}).strict();

const loginBodySchema = z.object({
  emailOrUsername: z.string().min(1).max(255),
  password: z.string().min(1).max(128),
});

const verifyEmailBodySchema = z.object({
  userId: schemas.id,
  code: z.string().length(6).regex(/^\d{6}$/),
});

const verifyEmailLinkBodySchema = z.object({
  token: z.string().min(64).max(64),
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

const verifyLoginLinkBodySchema = z.object({
  email: schemas.email,
  token: z.string().min(64).max(64),
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
  name: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  betaCode: z.string().optional(),
}).strict();

const updateGroupBodySchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(500).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  statsEnabled: z.boolean().optional(),
}).strict();

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
  bio: z.string().max(200).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  showEmail: z.boolean().optional(),
  onboardingDone: z.boolean().optional(),
  theme: z.string().regex(/^(dark|light)(:(indigo|violet|sky|emerald|rose|amber))?$/).optional(),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Birthdate must be in YYYY-MM-DD format").optional(),
}).strict();

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
}).strict();

const memberApprovalParamsSchema = z.object({
  groupId: schemas.id,
  userId: schemas.id,
});

const createTagBodySchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).strict();

const updateTagBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
}).strict();

const tagParamsSchema = z.object({
  groupId: schemas.id,
  tagId: schemas.id,
});

const createChannelBodySchema = z.object({
  name: z.string().min(1).max(100),
  isInviteOnly: z.boolean().optional(),
}).strict();

const channelParamsSchema = z.object({
  groupId: schemas.id,
  channelId: schemas.id,
});

const channelMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: schemas.id.optional(),
});

const notificationPreferencesBodySchema = z.array(
  z.object({
    type: z.enum(["chat_message", "event_created", "event_changed", "invite", "rsvp_update", "event_start", "mention"]),
    channel: z.enum(["push", "email", "in_app"]),
    enabled: z.boolean(),
    reminderOffsetMinutes: z.number().int().positive().nullable().optional(),
  })
);

const eventRatingBodySchema = z.object({
  value: z.number().int().min(1).max(5),
});

const eventTagsBodySchema = z.object({
  tagIds: z.array(schemas.id).max(3, "You can add up to 3 tags per event"),
});

type NotificationFanoutJobData = {
  type: "chat_message" | "event_created" | "event_changed" | "invite" | "rsvp_update" | "event_start" | "mention";
  groupId: string;
  actorUserId?: string;
  eventId?: string;
  channelId?: string;
  tagIds?: string[];
  recipientUserIds?: string[];
  title: string;
  body: string;
  url?: string; // deep-link path shown in the in-app notification inbox
  reminderOffsetMinutes?: number; // event_start only: which reminder window fired
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

async function parseMentionedUsers(
  content: string,
  groupId: string,
  excludeUserId: string
): Promise<{ id: string; username: string }[]> {
  const handles = [...new Set(
    [...content.matchAll(/@([a-zA-Z0-9_.-]+)/g)].map((m) => m[1])
  )];
  if (handles.length === 0) return [];

  const users = await prisma.user.findMany({
    where: {
      username: { in: handles, mode: "insensitive" },
      memberships: { some: { groupId, status: "active" } },
      NOT: { id: excludeUserId },
    },
    select: { id: true, username: true },
  });
  return users.filter((u): u is { id: string; username: string } => u.username !== null);
}

async function parseTagMentions(
  content: string,
  groupId: string,
  excludeUserId: string
): Promise<{ tagId: string; tagName: string; recipientIds: string[] }[]> {
  const names = [...new Set(
    [...content.matchAll(/#([a-zA-Z0-9_-]+)/g)].map((m) => m[1])
  )];
  if (names.length === 0) return [];

  const tags = await prisma.tag.findMany({
    where: { groupId, name: { in: names, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (tags.length === 0) return [];

  const results: { tagId: string; tagName: string; recipientIds: string[] }[] = [];
  for (const tag of tags) {
    // Active members who haven't opted out of this tag
    const memberships = await prisma.membership.findMany({
      where: {
        groupId,
        status: "active",
        userId: { not: excludeUserId },
        user: {
          userTagPrefs: {
            none: { tagId: tag.id, subscribed: false },
          },
        },
      },
      select: { userId: true },
    });
    if (memberships.length > 0) {
      results.push({ tagId: tag.id, tagName: tag.name, recipientIds: memberships.map((m) => m.userId) });
    }
  }
  return results;
}

const REMINDER_OFFSETS_MINUTES = [15, 60, 1440] as const;

const reminderBody = (offsetMinutes: number, title: string) => {
  if (offsetMinutes === 1440) return `"${title}" is starting tomorrow`;
  if (offsetMinutes === 60) return `"${title}" starts in 1 hour`;
  return `"${title}" starts in 15 minutes`;
};

async function scheduleEventStartNotification(event: { id: string; groupId: string; title: string; dateTime: Date }) {
  for (const offset of REMINDER_OFFSETS_MINUTES) {
    const jobId = `event-start-${event.id}-${offset}m`;
    const delay = event.dateTime.getTime() - Date.now() - offset * 60 * 1000;

    const existing = await notificationQueue.getJob(jobId);
    if (existing) await existing.remove();

    if (delay <= 0) continue;

    await notificationQueue.add(
      "fanout",
      {
        type: "event_start",
        groupId: event.groupId,
        eventId: event.id,
        title: sanitizeNotifText(event.title),
        body: sanitizeNotifText(reminderBody(offset, event.title)),
        url: `/events/${event.id}`,
        reminderOffsetMinutes: offset,
      },
      { jobId, delay }
    );
  }
}

async function cancelEventStartNotification(eventId: string) {
  for (const offset of REMINDER_OFFSETS_MINUTES) {
    const existing = await notificationQueue.getJob(`event-start-${eventId}-${offset}m`);
    if (existing) await existing.remove();
  }
  // cancel legacy single-job format
  const legacy = await notificationQueue.getJob(`event-start-${eventId}`);
  if (legacy) await legacy.remove();
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
await app.register(compress, { global: true, threshold: 1024 });

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
  // Explicit HSTS: 1-year max-age, not relying on helmet version defaults.
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});

// P3: Permissions-Policy — helmet 8.x doesn't expose this header, so set it directly.
// Locks down APIs the app never uses to reduce browser-side attack surface.
app.addHook("onSend", async (_request, reply) => {
  reply.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );
});

await app.register(cors, {
  origin: configuredWebOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

await app.register(cookie);

await app.register(jwt, {
  secret: authSecret,
  cookie: {
    cookieName: "gem_token",
    signed: false,
  },
});

// Derive cookie maxAge from jwtExpiresIn (e.g. "100d" → 8640000 seconds).
// Falls back to 7 days if the format is unrecognised.
function jwtExpiresInToSeconds(s: string): number {
  const match = s.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 7 * 24 * 3600;
  const n = parseInt(match[1], 10);
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (multipliers[match[2]] ?? 86400);
}

const cookieMaxAge = jwtExpiresInToSeconds(jwtExpiresIn);

function setAuthCookie(reply: FastifyReply, token: string) {
  reply.setCookie("gem_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: cookieMaxAge,
  });
}

function clearAuthCookie(reply: FastifyReply) {
  reply.clearCookie("gem_token", { path: "/" });
}

const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

async function issueRefreshToken(reply: FastifyReply, userId: string, email: string): Promise<void> {
  const rawToken = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(rawToken).digest("hex");
  await redis.set(`refresh:${hash}`, JSON.stringify({ userId, email }), "EX", REFRESH_TOKEN_TTL_SECONDS);
  reply.setCookie("refresh_token", rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/auth/refresh",
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

async function revokeRefreshToken(request: FastifyRequest): Promise<void> {
  const rawToken = request.cookies["refresh_token"];
  if (rawToken) {
    const hash = createHash("sha256").update(rawToken).digest("hex");
    await redis.del(`refresh:${hash}`);
  }
}

function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie("refresh_token", { path: "/auth/refresh" });
}

await app.register(rateLimit, {
  global: true,
  max: 120,
  timeWindow: "1 minute",
  redis,
  keyGenerator: (request) => request.ip,
});

await app.register(multipart, {
  limits: {
    fileSize: MEDIA_MAX_FILE_BYTES,
    files: 1,
    fields: 5,  // allow caption and other small text fields alongside file uploads
  },
});

// Attach clients to app context for route handlers
app.decorate("prisma", prisma);
app.decorate("redis", redis);
app.decorate("s3", s3);

// Register error handler
app.setErrorHandler((error, request, reply) => {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const statusCode = (error as { statusCode?: number }).statusCode;

  if (sentryEnabled && statusCode !== 404) {
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

  // Email alert for genuine server errors (not 4xx client errors)
  if (!statusCode || statusCode >= 500) {
    void reportError(normalizedError, {
      source: "api",
      method: request.method,
      url: request.url,
      userId: (request as { user?: { id?: string } }).user?.id,
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
// Client Error Reporting
// ============================================================================

// Receives unhandled errors from the React frontend (ErrorBoundary + window.onerror).
// Rate-limited aggressively; always returns 204 so the client learns nothing.
app.post(
  "/internal/client-error",
  { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
  async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    const message =
      typeof body.message === "string" && body.message
        ? body.message.slice(0, 500)
        : "Client error";
    const stack =
      typeof body.stack === "string" ? body.stack.slice(0, 4000) : message;
    const url =
      typeof body.url === "string" ? body.url.slice(0, 500) : undefined;
    const userAgent =
      typeof body.userAgent === "string"
        ? body.userAgent.slice(0, 300)
        : request.headers["user-agent"]?.slice(0, 300);

    const error = new Error(message);
    error.stack = stack;

    void reportError(error, { source: "client", url, userAgent });

    return reply.status(204).send();
  }
);

// ============================================================================
// Health Check Routes
// ============================================================================

app.get("/health", async (request, reply) => {
  if (process.env.NODE_ENV === "production" && request.ip === "127.0.0.1") {
    app.log.warn("trustProxy misconfiguration: request.ip is 127.0.0.1 — check proxy hop count");
  }
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
    name: "GEM API",
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
      "/calendar/user-feed/:token.ics",
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
  setAuthCookie(reply, token);
  return reply.send({ user: { ...user, isAdmin: ADMIN_EMAILS.includes(user.email.toLowerCase()) } });
});

// ============================================================================
// Auth Routes — Logout
// ============================================================================

app.post("/auth/logout", async (request, reply) => {
  await revokeRefreshToken(request);
  clearAuthCookie(reply);
  clearRefreshCookie(reply);
  return reply.send({ ok: true });
});

app.post("/auth/refresh", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const rawToken = request.cookies["refresh_token"];
  if (!rawToken) {
    return reply.status(401).send({ error: "No refresh token", code: "NO_REFRESH_TOKEN" });
  }

  const hash = createHash("sha256").update(rawToken).digest("hex");
  const stored = await redis.get(`refresh:${hash}`);
  if (!stored) {
    // Token not found — either expired or already rotated (possible reuse attack).
    clearRefreshCookie(reply);
    return reply.status(401).send({ error: "Refresh token expired or already used", code: "REFRESH_INVALID" });
  }

  const { userId, email } = JSON.parse(stored) as { userId: string; email: string };

  // Rotate: delete old token, issue new pair atomically.
  const pipe = redis.pipeline();
  pipe.del(`refresh:${hash}`);
  const newRawToken = randomBytes(32).toString("hex");
  const newHash = createHash("sha256").update(newRawToken).digest("hex");
  pipe.set(`refresh:${newHash}`, JSON.stringify({ userId, email }), "EX", REFRESH_TOKEN_TTL_SECONDS);
  await pipe.exec();

  const newAccessToken = await reply.jwtSign({ sub: userId, email }, { expiresIn: jwtExpiresIn });
  setAuthCookie(reply, newAccessToken);
  reply.setCookie("refresh_token", newRawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/auth/refresh",
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });

  return reply.send({ ok: true });
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

function getWebLoginUrl() {
  return `${(process.env.WEB_BASE_URL || "").replace(/\/$/, "")}/login`;
}

function buildCalendarFeedUrl(token: string) {
  const apiBase = (process.env.API_BASE_URL || "").replace(/\/$/, "");
  return `${apiBase}/calendar/group-feed/${token}.ics`;
}

function buildGroupInviteUrl(inviteCode: string) {
  const webBase = (process.env.WEB_BASE_URL || "").replace(/\/$/, "");
  return `${webBase}/groups?invite=${encodeURIComponent(inviteCode)}`;
}

function formatHttpDate(date: Date) {
  return date.toUTCString();
}

async function buildCalendarFeedResponse(groupId: string, groupName: string) {
  const events = await prisma.event.findMany({
    where: {
      groupId,
      isPrivate: false,
    },
    orderBy: { dateTime: "asc" },
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

  const ics = buildIcsCalendar(events, {
    calendarName: `GEM - ${groupName}`,
    webBaseUrl: process.env.WEB_BASE_URL,
  });

  const syncMeta = await getCalendarSyncMeta(groupId);
  const latestUpdatedAt = events.reduce<Date | null>((latest, event) => {
    if (!latest || event.updatedAt > latest) {
      return event.updatedAt;
    }
    return latest;
  }, null);

  return {
    ics,
    syncMeta,
    latestUpdatedAt,
  };
}

function buildWelcomeEmail(name: string, webBase: string): { html: string; text: string } {
  const btn = (url: string, label: string) =>
    `<a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">${label}</a>`;
  const h2 = (text: string) =>
    `<h3 style="margin:24px 0 6px 0;font-size:15px;color:#1e1b4b;">${text}</h3>`;
  const p = (text: string) =>
    `<p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:#374151;">${text}</p>`;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;">
      <h2 style="margin:0 0 4px 0;font-size:22px;color:#1e1b4b;">Welcome to Gem, ${escapeHtml(name)}!</h2>
      ${p("Your account is verified and ready to go. Here's a quick guide to get you started.")}

      ${h2("1. Join or create a group")}
      ${p("GEM is built around groups — a private space for your friend circle. Tap <strong>Join a Group</strong> on your home screen and enter an invite code shared by a friend, or create your own group and invite people with a link or code.")}

      ${h2("2. Create an event")}
      ${p("Inside your group, go to the <strong>Events</strong> tab and tap the <strong>+</strong> button. Give the event a name, date, time, and location. Members can RSVP and chat directly on the event page.")}

      ${h2("3. Chat with your friends")}
      ${p("Each group has <strong>Channels</strong> — persistent chat rooms for different topics (e.g. #general, #planning). You can also chat directly on any event page. React to messages, reply inline, and pin important ones.")}

      ${h2("4. Share photos")}
      ${p("Attach photos to any event. Open an event, scroll to the Photos section, and upload from your device. Admins can create named albums from the group's Photos tab.")}

      <div style="margin:24px 0;">
        ${btn(`${webBase}/groups`, "Open GEM →")}
      </div>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />

      <h3 style="margin:0 0 10px 0;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Helpful links</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;">
            <a href="${webBase}/help" style="color:#4f46e5;text-decoration:none;font-size:14px;">📖 Help center</a>
            <span style="font-size:13px;color:#9ca3af;"> — how-to guides and FAQs</span>
          </td>
        </tr>
        <tr>
          <td style="padding:6px 0;">
            <a href="${webBase}/updates" style="color:#4f46e5;text-decoration:none;font-size:14px;">✨ What's new</a>
            <span style="font-size:13px;color:#9ca3af;"> — latest features and updates</span>
          </td>
        </tr>
        <tr>
          <td style="padding:6px 0;">
            <a href="${webBase}/contact" style="color:#4f46e5;text-decoration:none;font-size:14px;">✉️ Contact us</a>
            <span style="font-size:13px;color:#9ca3af;"> — questions, bugs, or feedback</span>
          </td>
        </tr>
      </table>

      <p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">
        You can also email us directly at <a href="mailto:help@gem.aidanlenahan.com" style="color:#4f46e5;text-decoration:none;">help@gem.aidanlenahan.com</a> any time.
      </p>
    </div>
  `;

  const text = [
    `Welcome to Gem, ${name}!`,
    `Your account is verified. Here's how to get started:`,
    ``,
    `1. Join or create a group`,
    `   Tap "Join a Group" and enter a friend's invite code, or create your own group at ${webBase}/groups.`,
    ``,
    `2. Create an event`,
    `   Open your group → Events tab → tap + to create an event. Friends can RSVP and chat on the event page.`,
    ``,
    `3. Chat with friends`,
    `   Use Channels for topic-based group chats, or chat directly on any event.`,
    ``,
    `4. Share photos`,
    `   Attach photos to events from the Photos section on any event page.`,
    ``,
    `Helpful links:`,
    `  Help center: ${webBase}/help`,
    `  What's new:  ${webBase}/updates`,
    `  Contact us:  ${webBase}/contact`,
    `  Email:       help@gem.aidanlenahan.com`,
    ``,
    `See you in the app → ${webBase}`,
  ].join("\n");

  return { html, text };
}

async function sendEmailCode(
  to: string,
  code: string,
  subject: string,
  body: string,
  options?: {
    actionUrl?: string;
    actionLabel?: string;
    actionText?: string;
  }
) {
  const loginUrl = options?.actionUrl ?? getWebLoginUrl();
  const actionLabel = options?.actionLabel ?? "Sign in to GEM";
  const actionText = options?.actionText ?? "Open GEM:";
  await sendTransactionalEmail({
    to,
    subject,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 12px 0;">GEM</h2>
        <p style="margin:0 0 20px 0;">${body}</p>
        <p style="font-size:2.2em;letter-spacing:0.35em;font-weight:700;margin:0 0 20px 0;">${code}</p>
        <p style="margin:0 0 16px 0;">
          <a href="${loginUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:8px;font-weight:600;">${actionLabel}</a>
        </p>
        <p style="color:#64748b;font-size:12px;margin:0;">This code expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
    text: `${body}\n\nYour code: ${code}\n\n${actionText} ${loginUrl}\n\nThis code expires in 10 minutes.`,
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

  // Validate invite link token if provided (independent of the beta gate)
  if (body.inviteToken) {
    const inviteLink = await prisma.betaCode.findUnique({ where: { code: body.inviteToken } });
    if (!inviteLink || inviteLink.type !== "invite_link") {
      return reply.status(403).send({ error: "Invalid invite link", code: "INVITE_LINK_INVALID" });
    }
    if (inviteLink.expiresAt && inviteLink.expiresAt < new Date()) {
      return reply.status(403).send({ error: "This invite link has expired", code: "INVITE_LINK_EXPIRED" });
    }
    if (inviteLink.singleUse && inviteLink.usedAt !== null) {
      return reply.status(403).send({ error: "This invite link has already been used", code: "INVITE_LINK_USED" });
    }
    (request as any)._inviteLinkId = inviteLink.id;
  }

  // Invite code check (typed beta codes — only enforced when gate is on)
  if (registrationBetaRequired && !body.inviteToken) {
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

  // Age gate: must be 13 or older
  const birthdateObj = new Date(body.birthdate);
  if (isNaN(birthdateObj.getTime())) {
    return reply.status(400).send({ error: "Invalid birthdate", code: "INVALID_BIRTHDATE" });
  }
  const ageCutoff = new Date();
  ageCutoff.setFullYear(ageCutoff.getFullYear() - 13);
  if (birthdateObj > ageCutoff) {
    return reply.status(400).send({ error: "You must be at least 13 years old to create an account", code: "AGE_REQUIREMENT_NOT_MET" });
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
        birthdate: birthdateObj,
        birthdateSet: true,
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

    // Record first use of an invite link (for tracking; enforces single-use on next attempt)
    const inviteLinkId = (request as any)._inviteLinkId;
    if (inviteLinkId) {
      await tx.betaCode.updateMany({
        where: { id: inviteLinkId, usedAt: null },
        data: { usedById: newUser.id, usedAt: new Date() },
      });
    }

    return newUser;
  });

  // Store 6-digit OTP in Redis (10 min TTL), hashed with SHA-256
  const otpCode = generateOtpCode();
  await redis.setex(`verify:email:${user.id}`, 600, hashOtp(otpCode));

  // Magic link token valid for 24 hours
  const verifyLinkToken = randomBytes(32).toString("hex");
  await redis.setex(`verify:link:${verifyLinkToken}`, 86400, user.id);
  const verifyUrl = new URL(`${(process.env.WEB_BASE_URL || "").replace(/\/$/, "")}/verify-email`);
  verifyUrl.searchParams.set("userId", user.id);
  verifyUrl.searchParams.set("token", verifyLinkToken);

  await sendEmailCode(
    user.email,
    otpCode,
    "Verify your GEM account",
    "Enter this code to verify your email address:",
    {
      actionUrl: verifyUrl.toString(),
      actionLabel: "Verify email",
      actionText: "Or click to verify instantly:",
    }
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
  if (!stored) {
    return reply.status(400).send({ error: "Invalid or expired verification code", code: "INVALID_CODE" });
  }
  if (!verifyOtp(body.code, stored)) {
    const failKey = `otp:failures:email:${body.userId}`;
    const failures = await redis.incr(failKey);
    if (failures === 1) await redis.expire(failKey, 600);
    if (failures >= 5) await redis.del(`verify:email:${body.userId}`, failKey);
    return reply.status(400).send({ error: "Invalid or expired verification code", code: "INVALID_CODE" });
  }

  const user = await prisma.user.update({
    where: { id: body.userId },
    data: { emailVerified: true, emailVerificationToken: null },
    select: { id: true, email: true, name: true, username: true, avatarUrl: true, theme: true },
  });

  await redis.del(`verify:email:${body.userId}`);
  await redis.del(`verify:cooldown:${body.userId}`);

  if (isMailConfigured()) {
    const webBase = (process.env.WEB_BASE_URL || "").replace(/\/$/, "");
    const welcome = buildWelcomeEmail(user.name, webBase);
    sendTransactionalEmail({ to: user.email, subject: "Welcome to Gem!", ...welcome }).catch(() => {});
  }

  const token = await reply.jwtSign({ sub: user.id, email: user.email }, { expiresIn: jwtExpiresIn });
  setAuthCookie(reply, token);
  await issueRefreshToken(reply, user.id, user.email);
  return reply.send({ user: { ...user, isAdmin: ADMIN_EMAILS.includes(user.email.toLowerCase()) } });
});

app.post("/auth/verify-email-link", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = await validateRequest(verifyEmailLinkBodySchema, request.body);

  const userId = await redis.get(`verify:link:${body.token}`);
  if (!userId) {
    return reply.status(400).send({ error: "Invalid or expired verification link", code: "INVALID_LINK" });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, username: true, avatarUrl: true, theme: true, emailVerified: true },
  });
  if (!user) {
    return reply.status(400).send({ error: "Invalid or expired verification link", code: "INVALID_LINK" });
  }

  const wasJustVerified = !user.emailVerified;
  if (wasJustVerified) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerificationToken: null },
    });
    await redis.del(`verify:email:${user.id}`);
    await redis.del(`verify:cooldown:${user.id}`);
  }
  await redis.del(`verify:link:${body.token}`);

  if (wasJustVerified && isMailConfigured()) {
    const webBase = (process.env.WEB_BASE_URL || "").replace(/\/$/, "");
    const welcome = buildWelcomeEmail(user.name, webBase);
    sendTransactionalEmail({ to: user.email, subject: "Welcome to Gem!", ...welcome }).catch(() => {});
  }

  const { emailVerified: _ev, ...safeUser } = user;
  const token = await reply.jwtSign({ sub: safeUser.id, email: safeUser.email }, { expiresIn: jwtExpiresIn });
  setAuthCookie(reply, token);
  await issueRefreshToken(reply, safeUser.id, safeUser.email);
  return reply.send({ user: { ...safeUser, isAdmin: ADMIN_EMAILS.includes(safeUser.email.toLowerCase()) } });
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
  await redis.setex(`verify:email:${body.userId}`, 600, hashOtp(otpCode));
  await redis.setex(`verify:cooldown:${body.userId}`, 60, "1");

  const verifyLinkToken = randomBytes(32).toString("hex");
  await redis.setex(`verify:link:${verifyLinkToken}`, 86400, body.userId);
  const verifyUrl = new URL(`${(process.env.WEB_BASE_URL || "").replace(/\/$/, "")}/verify-email`);
  verifyUrl.searchParams.set("userId", body.userId);
  verifyUrl.searchParams.set("token", verifyLinkToken);

  await sendEmailCode(
    user.email,
    otpCode,
    "Verify your GEM account",
    "Enter this code to verify your email address:",
    {
      actionUrl: verifyUrl.toString(),
      actionLabel: "Verify email",
      actionText: "Or click to verify instantly:",
    }
  );

  return reply.send({ message: "Verification code resent" });
});

app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = await validateRequest(loginBodySchema, request.body);

  // P1 security: Per-account login lockout after 10 failed attempts
  const normalizedEmail = body.emailOrUsername.toLowerCase();
  const lockKey = `login:failures:${normalizedEmail}`;
  const lockoutTtl = 15 * 60; // 15-minute window

  const failureCount = await redis.get(lockKey);
  if (failureCount && parseInt(failureCount) > 10) {
    const ttl = await redis.ttl(lockKey);
    return reply.status(429).send({
      error: "Account temporarily locked due to too many failed login attempts. Try again later.",
      code: "ACCOUNT_LOCKED",
      retryAfterSeconds: ttl > 0 ? ttl : lockoutTtl,
    });
  }

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
    // Track failed attempt
    const failures = await redis.incr(lockKey);
    if (failures === 1) {
      await redis.expire(lockKey, lockoutTtl);
    }
    return reply.status(401).send(invalidCreds);
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    // Track failed attempt
    const failures = await redis.incr(lockKey);
    if (failures === 1) {
      await redis.expire(lockKey, lockoutTtl);
    }
    return reply.status(401).send(invalidCreds);
  }

  // Clear failure counter on successful login
  await redis.del(lockKey);

  if (!user.emailVerified) {
    return reply.status(403).send({
      error: "Email not verified. Check your inbox for a verification code.",
      code: "EMAIL_NOT_VERIFIED",
      userId: user.id,
    });
  }

  const { passwordHash: _omit, emailVerified: _ev, ...safeUser } = user;
  const token = await reply.jwtSign({ sub: safeUser.id, email: safeUser.email }, { expiresIn: jwtExpiresIn });
  setAuthCookie(reply, token);
  await issueRefreshToken(reply, safeUser.id, safeUser.email);
  return reply.send({ user: { ...safeUser, isAdmin: ADMIN_EMAILS.includes(safeUser.email.toLowerCase()) } });
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
      const linkToken = randomBytes(32).toString("hex");
      const previousLinkToken = await redis.get(`login:link:user:${user.id}`);

      if (previousLinkToken) {
        await redis.del(`login:link:${previousLinkToken}`);
      }

      await redis.setex(`login:code:${user.id}`, 600, hashOtp(otpCode));
      await redis.setex(`login:link:${linkToken}`, 600, user.id);
      await redis.setex(`login:link:user:${user.id}`, 600, linkToken);
      await redis.setex(`login:cooldown:${user.id}`, 60, "1");
      const loginUrl = new URL(getWebLoginUrl());
      loginUrl.searchParams.set("email", user.email);
      loginUrl.searchParams.set("loginToken", linkToken);
      await sendEmailCode(
        user.email,
        otpCode,
        "Your GEM sign-in code",
        "Use this code to sign in to GEM, or tap the secure temporary link below:",
        {
          actionUrl: loginUrl.toString(),
          actionLabel: "Sign in instantly",
          actionText: "Secure sign-in link:",
        }
      );
    }
  }

  return reply.send({ message: "If that email exists, a sign-in code has been sent." });
});

app.post("/auth/verify-login-link", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = await validateRequest(verifyLoginLinkBodySchema, request.body);

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true, email: true, name: true, username: true, avatarUrl: true, theme: true, emailVerified: true },
  });

  if (!user) {
    return reply.status(401).send({ error: "Invalid or expired sign-in link", code: "INVALID_LOGIN_LINK" });
  }

  const linkUserId = await redis.get(`login:link:${body.token}`);
  const activeLinkToken = await redis.get(`login:link:user:${user.id}`);
  if (!linkUserId || linkUserId !== user.id || activeLinkToken !== body.token) {
    return reply.status(401).send({ error: "Invalid or expired sign-in link", code: "INVALID_LOGIN_LINK" });
  }

  await redis.del(`login:link:${body.token}`);
  await redis.del(`login:link:user:${user.id}`);
  await redis.del(`login:code:${user.id}`);
  await redis.del(`login:cooldown:${user.id}`);

  if (!user.emailVerified) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
    await redis.del(`verify:email:${user.id}`);
  }

  const { emailVerified: _ev, ...safeUser } = user;
  const token = await reply.jwtSign({ sub: safeUser.id, email: safeUser.email }, { expiresIn: jwtExpiresIn });
  setAuthCookie(reply, token);
  await issueRefreshToken(reply, safeUser.id, safeUser.email);
  return reply.send({ user: { ...safeUser, isAdmin: ADMIN_EMAILS.includes(safeUser.email.toLowerCase()) } });
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
  if (!stored) {
    return reply.status(401).send({ error: "Invalid or expired code", code: "INVALID_CODE" });
  }
  if (!verifyOtp(body.code, stored)) {
    const failKey = `otp:failures:login:${user.id}`;
    const failures = await redis.incr(failKey);
    if (failures === 1) await redis.expire(failKey, 600);
    if (failures >= 5) await redis.del(`login:code:${user.id}`, failKey);
    return reply.status(401).send({ error: "Invalid or expired code", code: "INVALID_CODE" });
  }

  await redis.del(`login:code:${user.id}`);
  const activeLinkToken = await redis.get(`login:link:user:${user.id}`);
  if (activeLinkToken) {
    await redis.del(`login:link:${activeLinkToken}`);
  }
  await redis.del(`login:link:user:${user.id}`);
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
  setAuthCookie(reply, token);
  await issueRefreshToken(reply, safeUser.id, safeUser.email);
  return reply.send({ user: { ...safeUser, isAdmin: ADMIN_EMAILS.includes(safeUser.email.toLowerCase()) } });
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
    await redis.setex(`reset:code:${user.id}`, 3600, hashOtp(otpCode));

    const resetUrl = `${process.env.WEB_BASE_URL}/reset-password?token=${rawToken}`;

    await sendTransactionalEmail({
      to: user.email,
      subject: "Reset your GEM password",
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="margin:0 0 12px 0;">GEM</h2>
          <p style="margin:0 0 20px 0;">We received a request to reset your password. You can reset it by clicking the button below <strong>or</strong> by entering the 6-digit code on the reset page. Both expire in 1 hour.</p>
          <p style="margin:0 0 8px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:8px;font-weight:600;">Reset Password</a>
          </p>
          <p style="margin:0 0 20px 0;color:#64748b;font-size:13px;">Or enter this 6-digit code on the page where you requested the reset:</p>
          <div style="font-size:36px;font-weight:700;letter-spacing:12px;color:#ffffff;background:#1e293b;padding:16px 24px;border-radius:8px;display:inline-block;margin:0 0 20px 0;">${otpCode}</div>
          <p style="color:#64748b;font-size:12px;margin:0;">If you did not request a password reset, you can safely ignore this email. The link and code will expire automatically.</p>
        </div>
      `,
      text: `Reset your GEM password\n\nClick this link to reset your password (expires in 1 hour):\n${resetUrl}\n\nOr enter this 6-digit code on the page where you requested the reset: ${otpCode}\n\nIf you did not request this, ignore this email.`,
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
  if (!stored || !verifyOtp(body.code, stored)) {
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
// Account Management Routes (change password, change email, delete account)
// ============================================================================

// POST /auth/change-password — change password while authenticated (requires current password)
app.post("/auth/change-password", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  if (currentUser.isDemo) return reply.status(403).send({ error: "Not available in demo mode.", code: "DEMO_RESTRICTED" });

  const body = await validateRequest(
    z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, "New password must be at least 8 characters"),
    }),
    request.body
  );

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash) {
    return reply.status(400).send({ error: "No password set on this account.", code: "NO_PASSWORD" });
  }

  const valid = await verifyPassword(body.currentPassword, user.passwordHash);
  if (!valid) {
    return reply.status(401).send({ error: "Current password is incorrect.", code: "WRONG_PASSWORD" });
  }

  const newHash = await hashPassword(body.newPassword);
  await prisma.user.update({ where: { id: currentUser.id }, data: { passwordHash: newHash } });

  return reply.send({ message: "Password updated successfully." });
});

// POST /auth/change-email — initiate email change (requires password; sends OTP to new address)
app.post("/auth/change-email", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  if (currentUser.isDemo) return reply.status(403).send({ error: "Not available in demo mode.", code: "DEMO_RESTRICTED" });

  const body = await validateRequest(
    z.object({
      password: z.string().min(1),
      newEmail: z.string().email("Invalid email address").toLowerCase(),
    }),
    request.body
  );

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { passwordHash: true, email: true },
  });

  if (!user?.passwordHash) {
    return reply.status(400).send({ error: "No password set on this account.", code: "NO_PASSWORD" });
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    return reply.status(401).send({ error: "Password is incorrect.", code: "WRONG_PASSWORD" });
  }

  if (body.newEmail === user.email.toLowerCase()) {
    return reply.status(400).send({ error: "New email is the same as your current email.", code: "SAME_EMAIL" });
  }

  const conflict = await prisma.user.findUnique({ where: { email: body.newEmail } });
  if (conflict) {
    return reply.status(409).send({ error: "That email address is already in use.", code: "EMAIL_TAKEN" });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const redisKey = `email-change:${currentUser.id}`;
  await redis.set(redisKey, JSON.stringify({ newEmail: body.newEmail, code }), "EX", 3600);

  await sendTransactionalEmail({
    to: body.newEmail,
    subject: "Confirm your new GEM email address",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 16px 0;font-size:20px;color:#1e293b">Confirm your new email</h2>
        <p style="margin:0 0 20px 0;color:#475569">Enter this 6-digit code on GEM to confirm your new email address. It expires in 1 hour.</p>
        <div style="background:#f1f5f9;border-radius:8px;padding:20px;text-align:center;font-size:32px;font-weight:700;letter-spacing:6px;color:#1e293b;margin-bottom:20px">${code}</div>
        <p style="color:#94a3b8;font-size:12px;margin:0">If you did not request this change, you can safely ignore this email.</p>
      </div>
    `,
    text: `Your GEM email change code is: ${code}\n\nThis code expires in 1 hour. If you did not request this, ignore this email.`,
  });

  return reply.send({ message: "Verification code sent to your new email address." });
});

// POST /auth/verify-email-change — confirm the OTP and update email
app.post("/auth/verify-email-change", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  if (currentUser.isDemo) return reply.status(403).send({ error: "Not available in demo mode.", code: "DEMO_RESTRICTED" });

  const body = await validateRequest(
    z.object({ code: z.string().length(6) }),
    request.body
  );

  const redisKey = `email-change:${currentUser.id}`;
  const raw = await redis.get(redisKey);
  if (!raw) {
    return reply.status(400).send({ error: "No pending email change found or it has expired.", code: "NO_PENDING_CHANGE" });
  }

  const { newEmail, code } = JSON.parse(raw) as { newEmail: string; code: string };
  if (body.code !== code) {
    return reply.status(401).send({ error: "Incorrect verification code.", code: "WRONG_CODE" });
  }

  const conflict = await prisma.user.findUnique({ where: { email: newEmail } });
  if (conflict && conflict.id !== currentUser.id) {
    await redis.del(redisKey);
    return reply.status(409).send({ error: "That email address is now taken by another account.", code: "EMAIL_TAKEN" });
  }

  await prisma.user.update({
    where: { id: currentUser.id },
    data: { email: newEmail, emailVerified: true },
  });
  await redis.del(redisKey);

  return reply.send({ message: "Email address updated successfully.", newEmail });
});

// POST /auth/request-account-deletion — verify password and send OTP to current email
app.post("/auth/request-account-deletion", { config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  if (currentUser.isDemo) return reply.status(403).send({ error: "Not available in demo mode.", code: "DEMO_RESTRICTED" });

  const body = await validateRequest(
    z.object({ password: z.string().min(1) }),
    request.body
  );

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { passwordHash: true, email: true },
  });

  if (!user?.passwordHash) {
    return reply.status(400).send({ error: "No password set on this account.", code: "NO_PASSWORD" });
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    return reply.status(401).send({ error: "Password is incorrect.", code: "WRONG_PASSWORD" });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const redisKey = `account-deletion:${currentUser.id}`;
  await redis.set(redisKey, code, "EX", 900); // 15 minutes

  await sendTransactionalEmail({
    to: user.email,
    subject: "Confirm your GEM account deletion",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 16px 0;font-size:20px;color:#1e293b">Confirm account deletion</h2>
        <p style="margin:0 0 20px 0;color:#475569">We received a request to permanently delete your GEM account. Enter this 6-digit code to confirm. It expires in 15 minutes.</p>
        <div style="background:#f1f5f9;border-radius:8px;padding:20px;text-align:center;font-size:32px;font-weight:700;letter-spacing:6px;color:#1e293b;margin-bottom:20px">${code}</div>
        <p style="color:#94a3b8;font-size:12px;margin:0">If you did not request this, you can safely ignore this email. Your account will not be deleted.</p>
      </div>
    `,
    text: `Your GEM account deletion code is: ${code}\n\nThis code expires in 15 minutes. If you did not request this, ignore this email.`,
  });

  return reply.send({ message: "Verification code sent to your email address." });
});

// DELETE /users/me — permanently delete the authenticated user's account (requires email OTP)
app.delete("/users/me", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  if (currentUser.isDemo) return reply.status(403).send({ error: "Not available in demo mode.", code: "DEMO_RESTRICTED" });

  const body = await validateRequest(
    z.object({ code: z.string().length(6) }),
    request.body
  );

  const redisKey = `account-deletion:${currentUser.id}`;
  const storedCode = await redis.get(redisKey);
  if (!storedCode) {
    return reply.status(400).send({ error: "No pending deletion request found or it has expired.", code: "NO_PENDING_DELETION" });
  }

  if (body.code !== storedCode) {
    return reply.status(401).send({ error: "Incorrect verification code.", code: "WRONG_CODE" });
  }

  await redis.del(redisKey);

  // Delete all media files uploaded by this user before removing the DB records.
  const userMedia = await prisma.mediaAsset.findMany({
    where: { uploaderId: currentUser.id },
    select: { id: true, url: true },
  });
  for (const asset of userMedia) {
    deleteUploadedFile(asset.url);
  }
  await prisma.mediaAsset.deleteMany({ where: { uploaderId: currentUser.id } });

  // Cascade deletes handle all remaining related records via onDelete: Cascade.
  await prisma.user.delete({ where: { id: currentUser.id } });

  return reply.status(204).send();
});

// ============================================================================
// Notification Routes (Phase 5)
// ============================================================================

app.get("/notifications/config", async (request, reply) => {
  reply.header("Cache-Control", "private, max-age=3600, stale-while-revalidate=300");
  return reply.send({
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    pushConfigured,
    emailConfigured: isMailConfigured(),
  });
});

const PUSH_ENDPOINT_ALLOWLIST = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "wns2.notify.windows.com",
  "web.push.apple.com",
];

function isPushEndpointAllowed(endpoint: string): boolean {
  try {
    const { protocol, hostname } = new URL(endpoint);
    if (protocol !== "https:") return false;
    return PUSH_ENDPOINT_ALLOWLIST.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

app.post("/notifications/subscribe", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(notificationSubscribeBodySchema, request.body);

  if (!isPushEndpointAllowed(body.endpoint)) {
    return reply.status(400).send({ error: "Invalid push endpoint", code: "INVALID_ENDPOINT" });
  }

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

app.delete("/notifications/subscribe", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);

  await prisma.notificationSubscription.deleteMany({
    where: { userId: currentUser.id },
  });

  return reply.send({ unsubscribed: true });
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
        title: body.title ?? "GEM test push",
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

  const subject = body.subject ?? "GEM test email";
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
      subscribed: prefMap.get(tag.id) ?? true,
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

app.get("/notifications/preferences/groups/:groupId/untagged", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = request.params as { groupId: string };

  const membership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: currentUser.id, groupId: params.groupId } },
    select: { notifyUntaggedEvents: true },
  });

  if (!membership) {
    return reply.status(404).send({ error: "Membership not found", code: "NOT_FOUND" });
  }

  return reply.send({ notifyUntaggedEvents: membership.notifyUntaggedEvents });
});

app.put("/notifications/preferences/groups/:groupId/untagged", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = request.params as { groupId: string };
  const body = request.body as { notifyUntaggedEvents: boolean };

  const membership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: currentUser.id, groupId: params.groupId } },
  });

  if (!membership) {
    return reply.status(404).send({ error: "Membership not found", code: "NOT_FOUND" });
  }

  await prisma.membership.update({
    where: { userId_groupId: { userId: currentUser.id, groupId: params.groupId } },
    data: { notifyUntaggedEvents: body.notifyUntaggedEvents },
  });

  return reply.send({ notifyUntaggedEvents: body.notifyUntaggedEvents });
});

// ============================================================================
// Media Routes — local file storage
// ============================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isMediaUploadGloballyEnabled(): Promise<boolean> {
  const val = await redis.get("admin:media_upload_enabled");
  return val === "true";
}

async function getGroupMediaSettings(groupId: string) {
  return prisma.group.findUnique({
    where: { id: groupId },
    select: {
      mediaUploadEnabled: true,
      mediaStorageLimitBytes: true,
      mediaUploadNonAdminEnabled: true,
    },
  });
}

async function getGroupMediaUsedBytes(groupId: string): Promise<number> {
  const result = await prisma.mediaAsset.aggregate({
    where: { event: { groupId } },
    _sum: { sizeBytes: true },
  });
  return result._sum.sizeBytes ?? 0;
}

async function getGlobalMediaUsedBytes(): Promise<number> {
  const result = await prisma.mediaAsset.aggregate({ _sum: { sizeBytes: true } });
  return result._sum.sizeBytes ?? 0;
}

// ---------------------------------------------------------------------------
// GET /uploads/* — serve local media files
// ---------------------------------------------------------------------------

app.get("/uploads/*", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (request, reply) => {
  await requireAuth(request, reply, prisma);

  const relativePath = (request.params as Record<string, string>)["*"];
  if (!relativePath) {
    return reply.status(400).send({ error: "Invalid path" });
  }

  const absPath = resolve(join(UPLOAD_DIR, relativePath)); // nosemgrep: javascript.express.security.audit.express-path-join-resolve-traversal.express-path-join-resolve-traversal
  if (!absPath.startsWith(resolve(UPLOAD_DIR) + "/")) {
    return reply.status(400).send({ error: "Invalid path" });
  }
  try {
    const fileStat = await stat(absPath);
    if (!fileStat.isFile()) return reply.status(404).send({ error: "Not found" });

    // Derive MIME from extension stored in filename (set from signature at upload time)
    const ext = absPath.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    };
    const contentType = mimeMap[ext] ?? "application/octet-stream";

    reply.header("Content-Type", contentType);
    reply.header("Content-Length", fileStat.size);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    // Allow cross-origin image loading (overrides helmet's same-origin default)
    reply.header("Cross-Origin-Resource-Policy", "cross-origin");
    return reply.send(createReadStream(absPath)); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
  } catch {
    return reply.status(404).send({ error: "Not found" });
  }
});

// ---------------------------------------------------------------------------
// POST /users/me/avatar — upload profile photo (replaces presigned URL flow)
// Overwrites the previous avatar file for the user.
// ---------------------------------------------------------------------------

app.post("/users/me/avatar", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  if (currentUser.isDemo) return reply.status(403).send({ error: "Media uploads are not available in demo mode.", code: "DEMO_RESTRICTED" });

  const data = await request.file();
  if (!data) return reply.status(400).send({ error: "No file uploaded", code: "NO_FILE" });

  let saved;
  try {
    saved = await saveUploadedFile(data.file, `avatars`, AVATAR_MAX_FILE_BYTES);
  } catch (err: any) {
    if (err.code === "FILE_TOO_LARGE") {
      return reply.status(413).send({ error: `Profile photo must be under ${formatBytes(AVATAR_MAX_FILE_BYTES)}`, code: "FILE_TOO_LARGE" });
    }
    if (err.code === "INVALID_IMAGE") {
      return reply.status(415).send({ error: "Only JPEG, PNG, or WebP images are allowed.", code: "INVALID_IMAGE" });
    }
    throw err;
  }

  // Delete old avatar file if it was a local upload (URL may be absolute or relative)
  const existingUser = await prisma.user.findUnique({ where: { id: currentUser.id }, select: { avatarUrl: true } });
  if (existingUser?.avatarUrl) {
    const oldPath = existingUser.avatarUrl.replace(/^https?:\/\/[^/]+/, "");
    if (oldPath.startsWith("/uploads/")) deleteUploadedFile(oldPath);
  }

  const publicBase = (process.env.API_BASE_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const avatarUrl = `${publicBase}${saved.urlPath}`;

  await prisma.user.update({ where: { id: currentUser.id }, data: { avatarUrl } });

  await cache.del(`cache:userme:${currentUser.id}`);
  return reply.status(201).send({ avatarUrl });
});

// POST /media/avatar-upload-url — legacy endpoint, now returns 410
app.post("/media/avatar-upload-url", async (_request, reply) => {
  return reply.status(410).send({ error: "This endpoint has been replaced. Use POST /users/me/avatar with multipart/form-data.", code: "GONE" });
});

// ---------------------------------------------------------------------------
// EXIF extraction helper — reads JPEG/PNG/WebP EXIF tags and image dimensions.
// Returns null on any failure (missing EXIF is normal for screenshots/PNGs).
// ---------------------------------------------------------------------------

interface ExtractedExif {
  width: number | null
  height: number | null
  exifData: Record<string, unknown> | null
}

async function extractImageMeta(filePath: string, mimeType: string): Promise<ExtractedExif> {
  let width: number | null = null
  let height: number | null = null
  let exifData: Record<string, unknown> | null = null

  try {
    const buf = await readFile(filePath)

    // Pixel dimensions via image-size (works for all three formats)
    try {
      const dims = imageSize(buf)
      width = dims.width ?? null
      height = dims.height ?? null
    } catch { /* non-critical */ }

    // EXIF metadata (mainly useful for JPEGs from cameras/phones)
    if (mimeType === "image/jpeg" || mimeType === "image/webp") {
      try {
        const raw = await exifr.parse(buf, {
          tiff: true, exif: true, gps: true, icc: false, iptc: false,
          pick: [
            "DateTimeOriginal", "CreateDate", "Make", "Model",
            "LensModel", "FocalLength", "FNumber", "ExposureTime",
            "ISO", "ISOSpeedRatings", "Flash", "WhiteBalance",
            "Orientation", "ImageWidth", "ImageHeight",
            "ExifImageWidth", "ExifImageHeight",
            "GPSLatitude", "GPSLongitude", "GPSAltitude",
            "GPSLatitudeRef", "GPSLongitudeRef",
            "Software", "Artist", "Copyright",
          ],
        })
        if (raw && typeof raw === "object") {
          const exif: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(raw)) {
            if (v !== undefined && v !== null) {
              // Serialize Dates and plain values; skip binary buffers
              if (v instanceof Date) exif[k] = v.toISOString()
              else if (typeof v !== "object" || Array.isArray(v)) exif[k] = v
              // GPS objects (lat/lng as objects) — flatten to string
              else exif[k] = String(v)
            }
          }
          if (Object.keys(exif).length > 0) exifData = exif
        }
      } catch { /* no EXIF is normal */ }
    }
  } catch { /* file read error is non-critical for uploads */ }

  return { width, height, exifData }
}

// ---------------------------------------------------------------------------
// POST /events/:eventId/media — upload a photo to an event (group media)
// ---------------------------------------------------------------------------

app.post("/events/:eventId/media", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { eventId } = request.params as { eventId: string };
  if (currentUser.isDemo) return reply.status(403).send({ error: "Media uploads are not available in demo mode.", code: "DEMO_RESTRICTED" });

  // Global gate
  if (!(await isMediaUploadGloballyEnabled())) {
    return reply.status(403).send({ error: "Media uploads are not enabled on this server.", code: "MEDIA_DISABLED" });
  }

  const access = await canAccessEvent(prisma, eventId, currentUser.id);
  const groupId = access.event.groupId;

  // Group-level gate
  const groupSettings = await getGroupMediaSettings(groupId);
  if (!groupSettings?.mediaUploadEnabled) {
    return reply.status(403).send({ error: "Media uploads are disabled for this group.", code: "GROUP_MEDIA_DISABLED" });
  }
  if (!groupSettings.mediaUploadNonAdminEnabled && !access.isAdmin) {
    return reply.status(403).send({ error: "Only group admins can upload media in this group.", code: "ADMIN_ONLY_UPLOAD" });
  }

  // Global 20 GB hard cap
  const globalUsed = await getGlobalMediaUsedBytes();
  if (globalUsed >= MEDIA_GLOBAL_MAX_BYTES) {
    return reply.status(507).send({ error: "Server storage limit reached. Contact an administrator.", code: "GLOBAL_STORAGE_FULL" });
  }

  // Group storage cap
  const groupLimitBytes = Number(groupSettings.mediaStorageLimitBytes);
  const groupUsed = await getGroupMediaUsedBytes(groupId);
  if (groupUsed >= groupLimitBytes) {
    return reply.status(507).send({ error: `This group's storage limit of ${formatBytes(groupLimitBytes)} has been reached.`, code: "GROUP_STORAGE_FULL" });
  }

  // Extract file and optional caption from multipart parts
  let fileData: Awaited<ReturnType<typeof request.file>> | null = null;
  let caption: string | undefined;
  let originalFilename: string | undefined;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      fileData = part as any;
      originalFilename = part.filename;
    } else if (part.type === "field" && part.fieldname === "caption") {
      const raw = String(part.value ?? "").trim();
      if (raw.length > 0) caption = raw.slice(0, 280);
    }
  }

  if (!fileData) return reply.status(400).send({ error: "No file uploaded", code: "NO_FILE" });

  let saved;
  try {
    const remaining = Math.min(MEDIA_GLOBAL_MAX_BYTES - globalUsed, groupLimitBytes - groupUsed);
    saved = await saveUploadedFile((fileData as any).file, `media/${eventId}`, Math.min(MEDIA_MAX_FILE_BYTES, remaining));
  } catch (err: any) {
    if (err.code === "FILE_TOO_LARGE") {
      return reply.status(413).send({ error: `File exceeds ${formatBytes(MEDIA_MAX_FILE_BYTES)} limit`, code: "FILE_TOO_LARGE" });
    }
    if (err.code === "INVALID_IMAGE") {
      return reply.status(415).send({ error: "Only JPEG, PNG, or WebP images are allowed.", code: "INVALID_IMAGE" });
    }
    throw err;
  }

  const publicBase = (process.env.API_BASE_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const url = `${publicBase}${saved.urlPath}`;

  const { width, height, exifData } = await extractImageMeta(saved.path, saved.mimeType);

  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      eventId,
      uploaderId: currentUser.id,
      url,
      filename: originalFilename || `upload.${saved.mimeType.split("/")[1]}`,
      sizeBytes: saved.sizeBytes,
      mimeType: saved.mimeType,
      width,
      height,
      exifData: exifData !== null ? (exifData as object) : undefined,
      caption,
    },
  });

  return reply.status(201).send({ mediaAsset });
});

// POST /media/upload-url — legacy endpoint, now returns 410
app.post("/media/upload-url", async (_request, reply) => {
  return reply.status(410).send({ error: "This endpoint has been replaced. Use POST /events/:eventId/media with multipart/form-data.", code: "GONE" });
});

// POST /media/complete — legacy endpoint, now returns 410
app.post("/media/complete", async (_request, reply) => {
  return reply.status(410).send({ error: "This endpoint has been replaced. Use POST /events/:eventId/media with multipart/form-data.", code: "GONE" });
});

// GET /media/proxy/* — legacy proxy route, now returns 410
app.get("/media/proxy/*", async (_request, reply) => {
  return reply.status(410).send({ error: "Media is now served directly. Use /uploads/* paths.", code: "GONE" });
});

// ---------------------------------------------------------------------------
// GET /events/:id/media — list media for an event
// ---------------------------------------------------------------------------

app.get("/events/:id/media", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const query = await validateRequest(mediaListQuerySchema, request.query);

  const access = await canAccessEvent(prisma, params.id, currentUser.id);

  const media = await prisma.mediaAsset.findMany({
    where: { eventId: params.id },
    include: {
      uploader: { select: { id: true, name: true, avatarUrl: true } },
      likes: { select: { userId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: query.limit,
  });

  const groupSettings = await getGroupMediaSettings(access.event.groupId);
  const groupLimitBytes = Number(groupSettings?.mediaStorageLimitBytes ?? MEDIA_GROUP_DEFAULT_LIMIT_BYTES);
  const groupUsedBytes = await getGroupMediaUsedBytes(access.event.groupId);
  const globalEnabled = await isMediaUploadGloballyEnabled();
  const canUpload =
    globalEnabled &&
    (groupSettings?.mediaUploadEnabled ?? false) &&
    (groupSettings?.mediaUploadNonAdminEnabled || access.isAdmin);

  return reply.send({
    eventId: params.id,
    media: media.map((m) => ({
      ...m,
      likeCount: m.likes.length,
      likedByMe: m.likes.some((l) => l.userId === currentUser.id),
      likes: undefined,
    })),
    mediaUpload: {
      enabled: globalEnabled && (groupSettings?.mediaUploadEnabled ?? false),
      canUpload,
      usedBytes: groupUsedBytes,
      limitBytes: groupLimitBytes,
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /media/:assetId — delete own upload (or admin of the group)
// ---------------------------------------------------------------------------

app.delete("/media/:assetId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { assetId } = request.params as { assetId: string };

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    include: { event: { select: { groupId: true } } },
  });
  if (!asset) return reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });

  const membership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: currentUser.id, groupId: asset.event.groupId } },
  });
  const isAdmin = ["owner", "admin"].includes(membership?.role ?? "");

  if (asset.uploaderId !== currentUser.id && !isAdmin) {
    return reply.status(403).send({ error: "Not authorized to delete this asset", code: "FORBIDDEN" });
  }

  deleteUploadedFile(asset.url);
  await prisma.mediaAsset.delete({ where: { id: assetId } });
  return reply.send({ success: true });
});

// ---------------------------------------------------------------------------
// PATCH /media/:assetId/caption — update caption (uploader or group admin)
// ---------------------------------------------------------------------------

app.patch("/media/:assetId/caption", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { assetId } = request.params as { assetId: string };
  const body = z.object({ caption: z.string().max(280).nullable() }).parse(request.body);

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    include: { event: { select: { groupId: true } } },
  });
  if (!asset) return reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });

  const membership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: currentUser.id, groupId: asset.event.groupId } },
  });
  const isAdmin = ["owner", "admin"].includes(membership?.role ?? "");
  if (asset.uploaderId !== currentUser.id && !isAdmin) {
    return reply.status(403).send({ error: "Not authorized", code: "FORBIDDEN" });
  }

  const updated = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: { caption: body.caption ?? null },
    select: { id: true, caption: true },
  });
  return reply.send(updated); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
});

// ---------------------------------------------------------------------------
// POST /media/:assetId/like — toggle like on a media asset
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GET /groups/:groupId/media — list ALL media in a group (admin subpage)
// ---------------------------------------------------------------------------

app.get("/groups/:groupId/media", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId } = request.params as { groupId: string };

  const membership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const query = await validateRequest(mediaListQuerySchema, request.query);

  const [media, groupSettings] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { event: { groupId } },
      include: {
        uploader: { select: { id: true, name: true, avatarUrl: true } },
        event: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    }),
    getGroupMediaSettings(groupId),
  ]);

  const usedBytes = media.reduce((sum, m) => sum + m.sizeBytes, 0);
  const limitBytes = Number(groupSettings?.mediaStorageLimitBytes ?? MEDIA_GROUP_DEFAULT_LIMIT_BYTES);

  return reply.send({
    media,
    settings: {
      enabled: groupSettings?.mediaUploadEnabled ?? false,
      nonAdminEnabled: groupSettings?.mediaUploadNonAdminEnabled ?? true,
      storageLimitBytes: limitBytes,
      usedBytes,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /groups/:groupId/photos — all group photos, visible to all members.
// Sorted newest-first. Used by the Media tab on GroupPage and the gallery page.
// Supports cursor pagination: pass ?cursor=<lastId> to get the next page.
// ---------------------------------------------------------------------------

const photosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

app.get("/groups/:groupId/photos", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId } = request.params as { groupId: string };

  await requireGroupMembership(prisma, currentUser.id, groupId);

  const query = await validateRequest(photosQuerySchema, request.query);

  const media = await prisma.mediaAsset.findMany({
    where: { event: { groupId } },
    include: {
      uploader: { select: { id: true, name: true, avatarUrl: true } },
      event: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: query.limit,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const nextCursor = media.length === query.limit ? (media.at(-1)?.id ?? null) : null;

  return reply.send({ media, nextCursor });
});

// ============================================================================
// Media Albums
// ============================================================================

// GET /groups/:groupId/albums — list albums with cover, count
app.get("/groups/:groupId/albums", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId } = request.params as { groupId: string };
  await requireGroupMembership(prisma, currentUser.id, groupId);

  const albums = await prisma.mediaAlbum.findMany({
    where: { groupId },
    orderBy: { createdAt: "desc" },
    include: {
      coverAsset: { select: { id: true, url: true } },
      _count: { select: { assets: true } },
    },
  });
  return reply.send({ albums: albums.map((a) => ({ ...a, photoCount: a._count.assets, _count: undefined })) });
});

// POST /groups/:groupId/albums — admin creates album
app.post("/groups/:groupId/albums", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId } = request.params as { groupId: string };
  const membership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const body = z.object({ name: z.string().min(1).max(80), description: z.string().max(280).optional() }).parse(request.body);

  const album = await prisma.mediaAlbum.create({
    data: { groupId, name: body.name, description: body.description, createdById: currentUser.id },
  });
  return reply.status(201).send({ album });
});

// PATCH /groups/:groupId/albums/:albumId — admin updates album
app.patch("/groups/:groupId/albums/:albumId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId, albumId } = request.params as { groupId: string; albumId: string };
  const membership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const body = z.object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(280).nullable().optional(),
    coverAssetId: z.string().nullable().optional(),
  }).parse(request.body);

  const album = await prisma.mediaAlbum.update({
    where: { id: albumId },
    data: { name: body.name, description: body.description ?? undefined, coverAssetId: body.coverAssetId ?? undefined },
  });
  return reply.send({ album });
});

// DELETE /groups/:groupId/albums/:albumId — admin deletes album
app.delete("/groups/:groupId/albums/:albumId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId, albumId } = request.params as { groupId: string; albumId: string };
  const membership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(membership.role, ["owner", "admin"]);

  await prisma.mediaAlbum.delete({ where: { id: albumId } });
  return reply.send({ success: true });
});

// GET /groups/:groupId/albums/:albumId/photos — any member, list album photos
app.get("/groups/:groupId/albums/:albumId/photos", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId, albumId } = request.params as { groupId: string; albumId: string };
  await requireGroupMembership(prisma, currentUser.id, groupId);

  const albumAssets = await prisma.mediaAlbumAsset.findMany({
    where: { albumId },
    orderBy: { addedAt: "desc" },
    include: {
      asset: {
        include: {
          uploader: { select: { id: true, name: true, avatarUrl: true } },
          event: { select: { id: true, title: true } },
        },
      },
    },
  });
  return reply.send({ media: albumAssets.map((aa) => aa.asset) });
});

// POST /groups/:groupId/albums/:albumId/assets — admin adds photo to album
app.post("/groups/:groupId/albums/:albumId/assets", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId, albumId } = request.params as { groupId: string; albumId: string };
  const membership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const { assetId } = z.object({ assetId: z.string() }).parse(request.body);

  // Verify asset belongs to this group
  const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, event: { groupId } } });
  if (!asset) return reply.status(404).send({ error: "Asset not found in this group", code: "NOT_FOUND" });

  await prisma.mediaAlbumAsset.upsert({
    where: { albumId_assetId: { albumId, assetId } },
    create: { albumId, assetId },
    update: {},
  });
  return reply.status(201).send({ success: true });
});

// DELETE /groups/:groupId/albums/:albumId/assets/:assetId — admin removes photo from album
app.delete("/groups/:groupId/albums/:albumId/assets/:assetId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId, albumId, assetId } = request.params as { groupId: string; albumId: string; assetId: string };
  const membership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(membership.role, ["owner", "admin"]);

  await prisma.mediaAlbumAsset.deleteMany({ where: { albumId, assetId } });
  return reply.send({ success: true });
});

// ---------------------------------------------------------------------------
// DELETE /groups/:groupId/media/:assetId — admin deletes any group media
// ---------------------------------------------------------------------------

app.delete("/groups/:groupId/media/:assetId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId, assetId } = request.params as { groupId: string; assetId: string };

  const membership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    include: { event: { select: { groupId: true } } },
  });
  if (!asset) return reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
  if (asset.event.groupId !== groupId) {
    return reply.status(403).send({ error: "Asset does not belong to this group", code: "FORBIDDEN" });
  }

  deleteUploadedFile(asset.url);
  await prisma.mediaAsset.delete({ where: { id: assetId } });
  return reply.send({ success: true });
});

// ---------------------------------------------------------------------------
// PATCH /groups/:groupId/media-settings — admin updates group media settings
// ---------------------------------------------------------------------------

const groupMediaSettingsBodySchema = z.object({
  mediaUploadEnabled: z.boolean().optional(),
  mediaStorageLimitBytes: z.number().int().min(1024 * 1024).max(MEDIA_GROUP_MAX_LIMIT_BYTES).optional(),
  mediaUploadNonAdminEnabled: z.boolean().optional(),
  unlockCode: z.string().optional(),
});

app.patch("/groups/:groupId/media-settings", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId } = request.params as { groupId: string };
  const body = await validateRequest(groupMediaSettingsBodySchema, request.body);

  const membership = await requireGroupMembership(prisma, currentUser.id, groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const currentSettings = await getGroupMediaSettings(groupId);

  // Enabling media uploads requires the global unlock code if one is set
  if (body.mediaUploadEnabled === true && !currentSettings?.mediaUploadEnabled) {
    const requiredCode = await redis.get("admin:media_upload_code");
    if (requiredCode) {
      if (!body.unlockCode || body.unlockCode.trim().toUpperCase() !== requiredCode.toUpperCase()) {
        return reply.status(403).send({ error: "Invalid media upload unlock code.", code: "INVALID_MEDIA_CODE" });
      }
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.mediaUploadEnabled !== undefined) updates.mediaUploadEnabled = body.mediaUploadEnabled;
  if (body.mediaStorageLimitBytes !== undefined) updates.mediaStorageLimitBytes = body.mediaStorageLimitBytes;
  if (body.mediaUploadNonAdminEnabled !== undefined) updates.mediaUploadNonAdminEnabled = body.mediaUploadNonAdminEnabled;

  const updated = await prisma.group.update({
    where: { id: groupId },
    data: updates,
    select: {
      mediaUploadEnabled: true,
      mediaStorageLimitBytes: true,
      mediaUploadNonAdminEnabled: true,
    },
  });

  return reply.send({
    mediaUploadEnabled: updated.mediaUploadEnabled,
    mediaStorageLimitBytes: Number(updated.mediaStorageLimitBytes),
    mediaUploadNonAdminEnabled: updated.mediaUploadNonAdminEnabled,
  });
});

app.get("/events/:id", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { id } = request.params as { id: string };

  const eventCacheKey = `cache:event:${id}:${currentUser.id}`;
  const cachedEvent = await cache.get<{ event: { groupId: string; updatedAt: string } }>(eventCacheKey);
  if (cachedEvent) {
    const membership = await prisma.membership.findUnique({
      where: { userId_groupId: { userId: currentUser.id, groupId: cachedEvent.event.groupId } },
      select: { status: true },
    });
    if (!membership || membership.status !== "active") {
      await cache.del(eventCacheKey);
      return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
    }
    const etag = weakETag(cachedEvent.event.updatedAt);
    if (request.headers["if-none-match"] === etag) return reply.status(304).send();
    reply.header("ETag", etag);
    reply.header("Cache-Control", "private, max-age=20, stale-while-revalidate=40");
    return reply.send(cachedEvent);
  }

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      tags: true,
      rsvps: true,
      invites: { where: { userId: currentUser.id } },
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

  if (!isAdmin && !isCreator && event.isPrivate && !isInvited) {
    return reply.status(403).send({ error: "Access denied" });
  }

  const avgRating = event.ratings.length > 0
    ? Math.round((event.ratings.reduce((s, r) => s + r.value, 0) / event.ratings.length) * 10) / 10
    : null;
  const myRating = event.ratings.find((r) => r.userId === currentUser.id)?.value ?? null;

  // Attach media upload capability info so the frontend can show/hide the upload button
  const [groupSettings, globalEnabled, groupUsedBytes] = await Promise.all([
    getGroupMediaSettings(event.groupId),
    isMediaUploadGloballyEnabled(),
    getGroupMediaUsedBytes(event.groupId),
  ]);
  const groupLimitBytes = Number(groupSettings?.mediaStorageLimitBytes ?? MEDIA_GROUP_DEFAULT_LIMIT_BYTES);
  const mediaUpload = {
    enabled: globalEnabled && (groupSettings?.mediaUploadEnabled ?? false),
    canUpload: globalEnabled && (groupSettings?.mediaUploadEnabled ?? false) &&
      (groupSettings?.mediaUploadNonAdminEnabled || isAdmin),
    usedBytes: groupUsedBytes,
    limitBytes: groupLimitBytes,
  };

  const eventResult = { event: { ...event, avgRating, myRating, ratingCount: event.ratings.length }, isAdmin, isCreator, mediaUpload };
  const etag = weakETag(event.updatedAt);
  if (request.headers["if-none-match"] === etag) return reply.status(304).send();
  reply.header("ETag", etag);
  reply.header("Cache-Control", "private, max-age=20, stale-while-revalidate=40");
  await cache.setTracked(eventCacheKey, `cache:event:${id}:keys`, eventResult, 20);
  return reply.send(eventResult);
});

app.get("/events", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const query = await validateRequest(listEventsQuerySchema, request.query);

  const membership = await requireGroupMembership(
    prisma,
    currentUser.id,
    query.groupId
  );

  const eventsCacheKey = `cache:events:${query.groupId}:${currentUser.id}:${query.from ?? ""}:${query.to ?? ""}`;
  const cachedEvents = await cache.get(eventsCacheKey);
  if (cachedEvents) {
    reply.header("Cache-Control", "private, max-age=20, stale-while-revalidate=40");
    return reply.send(cachedEvents); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
  }

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
      rsvps: { select: { status: true } },
      invites: { where: { userId: currentUser.id }, select: { userId: true } },
      _count: { select: { ratings: true } },
      ratings: { where: { userId: currentUser.id }, select: { value: true } },
    },
  });

  const filteredEvents = events.filter((event) => {
    const isAdmin = ["owner", "admin"].includes(membership.role);
    if (isAdmin || event.createdById === currentUser.id) {
      return true;
    }
    if (!event.isPrivate) {
      return true;
    }
    return event.invites.some((invite) => invite.userId === currentUser.id);
  });

  const eventsWithRatings = filteredEvents.map((event) => {
    const myRating = event.ratings[0]?.value ?? null;
    return { ...event, avgRating: null, myRating, ratingCount: event._count.ratings };
  });

  const eventsResult = { events: eventsWithRatings };
  reply.header("Cache-Control", "private, max-age=20, stale-while-revalidate=40");
  await cache.setTracked(eventsCacheKey, `cache:events:${query.groupId}:keys`, eventsResult, 20);
  return reply.send(eventsResult); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
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

  if (!event.isPrivate) {
    await notificationQueue.add("fanout", {
      type: "event_created",
      groupId: body.groupId,
      actorUserId: currentUser.id,
      eventId: event.id,
      tagIds: event.tags.map((tag) => tag.id),
      title: sanitizeNotifText(`New event: ${event.title}`),
      body: sanitizeNotifText(`${currentUser.name} created an event in your group.`),
      url: `/events/${event.id}`,
    }, { jobId: `event_created:${event.id}` });
  }

  await cache.delSet(`cache:events:${body.groupId}:keys`);
  await queueCalendarSync(body.groupId, "event_created", event.id);
  await scheduleEventStartNotification(event);

  if (body.details) {
    const mentioned = await parseMentionedUsers(body.details, body.groupId, currentUser.id);
    const actorLabel = currentUser.username ? `@${currentUser.username}` : currentUser.name;
    for (const target of mentioned) {
      await notificationQueue.add("fanout", {
        type: "mention",
        groupId: body.groupId,
        actorUserId: currentUser.id,
        eventId: event.id,
        recipientUserIds: [target.id],
        title: sanitizeNotifText(`${actorLabel} mentioned you`),
        body: sanitizeNotifText(body.details.slice(0, 140)),
        url: `/events/${event.id}`,
      });
    }
  }

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
      tags: body.tagIds
        ? {
            set: body.tagIds.map((id: string) => ({ id })),
          }
        : undefined,
    },
    include: {
      tags: true,
      rsvps: true,
      invites: true,
    },
  });

  const changedFanoutBase = {
    type: "event_changed" as const,
    groupId: access.event.groupId,
    actorUserId: currentUser.id,
    eventId: event.id,
    title: sanitizeNotifText(`Event updated: ${event.title}`),
    body: sanitizeNotifText(`${currentUser.name} updated event details.`),
    url: `/events/${event.id}`,
  };

  if (event.isPrivate) {
    const inviteeIds = event.invites.map((inv) => inv.userId);
    if (inviteeIds.length > 0) {
      await notificationQueue.add("fanout", { ...changedFanoutBase, recipientUserIds: inviteeIds }, { jobId: `event_changed:${event.id}` });
    }
  } else {
    await notificationQueue.add("fanout", changedFanoutBase, { jobId: `event_changed:${event.id}` });
  }

  await queueCalendarSync(access.event.groupId, "event_updated", event.id);
  if (body.dateTime) {
    await scheduleEventStartNotification({ id: event.id, groupId: access.event.groupId, title: event.title, dateTime: event.dateTime });
  }

  await Promise.all([
    cache.delSet(`cache:event:${params.id}:keys`),
    cache.delSet(`cache:events:${access.event.groupId}:keys`),
  ]);
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
  await cancelEventStartNotification(params.id);
  await queueCalendarSync(access.event.groupId, "event_deleted", params.id);
  await Promise.all([
    cache.delSet(`cache:event:${params.id}:keys`),
    cache.delSet(`cache:events:${access.event.groupId}:keys`),
  ]);
  return reply.status(204).send();
});

app.post("/events/:id/rsvps", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const body = await validateRequest(rsvpBodySchema, request.body);
  const access = await canAccessEvent(prisma, params.id, currentUser.id);
  await cache.del(`cache:event:${params.id}:${currentUser.id}`);

  // Per-user-per-group rate limit: 3 RSVPs per minute
  const rsvpRateKey = `rsvp_rate:${currentUser.id}:${access.event.groupId}`;
  const rsvpCount = await redis.incr(rsvpRateKey);
  if (rsvpCount === 1) await redis.expire(rsvpRateKey, 60);
  if (rsvpCount > 3) {
    return reply.status(429).send({
      error: "You're changing your RSVP too quickly. Wait a moment and try again.",
      code: "RSVP_RATE_LIMITED",
    });
  }

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

    if (body.status === "yes") {
      await notificationQueue.add("fanout", {
        type: "rsvp_update",
        groupId: access.event.groupId,
        actorUserId: currentUser.id,
        eventId: params.id,
        title: sanitizeNotifText(`RSVP on ${access.event.title}`),
        body: sanitizeNotifText(`${currentUser.name} is going.`),
        url: `/events/${params.id}`,
      }, { jobId: `rsvp_update:${params.id}:${currentUser.id}` });
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
    if (body.status === "yes") {
      await notificationQueue.add("fanout", {
        type: "rsvp_update",
        groupId: access.event.groupId,
        actorUserId: currentUser.id,
        eventId: params.id,
        title: sanitizeNotifText(`RSVP updated on ${access.event.title}`),
        body: sanitizeNotifText(`${currentUser.name} is going.`),
        url: `/events/${params.id}`,
      }, { jobId: `rsvp_update:${params.id}:${currentUser.id}` });
    }
    return reply.status(201).send({ rsvp: updated });
  }

  const rsvp = await prisma.rSVP.update({
    where,
    data: {
      status: body.status,
    },
  });

  if (body.status === "yes") {
    await notificationQueue.add("fanout", {
      type: "rsvp_update",
      groupId: access.event.groupId,
      actorUserId: currentUser.id,
      eventId: params.id,
      title: sanitizeNotifText(`RSVP updated on ${access.event.title}`),
      body: sanitizeNotifText(`${currentUser.name} is going.`),
      url: `/events/${params.id}`,
    }, { jobId: `rsvp_update:${params.id}:${currentUser.id}` });
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

  await cache.del(`cache:event:${params.id}:${params.userId}`);

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

  let rsvpUserName: string;
  if (params.userId === currentUser.id) {
    rsvpUserName = currentUser.name;
  } else {
    const rsvpUser = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { name: true },
    });
    rsvpUserName = rsvpUser?.name ?? "Someone";
  }

  const queueRsvpNotification = async () => {
    await notificationQueue.add("fanout", {
      type: "rsvp_update",
      groupId: access.event.groupId,
      actorUserId: currentUser.id,
      eventId: params.id,
      title: sanitizeNotifText(`RSVP updated on ${access.event.title}`),
      body: sanitizeNotifText(`${rsvpUserName} changed their RSVP to ${body.status}.`),
      url: `/events/${params.id}`,
    });
  };

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
    await queueRsvpNotification();
    return reply.send({ rsvp: updated });
  }

  const rsvp = await prisma.rSVP.update({
    where,
    data: {
      status: body.status,
    },
  });

  await queueRsvpNotification();
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
    title: sanitizeNotifText(`${currentUser.name} invited you`),
    body: sanitizeNotifText(`"${access.event.title}"`),
    url: `/events/${params.id}`,
  }, { jobId: `invite:${params.id}:${body.userId}` });

  await queueCalendarSync(access.event.groupId, "event_invite_changed", params.id);

  return reply.status(201).send({ invite });
});

app.get("/events/:id/invites", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(updateEventParamsSchema, request.params);
  const access = await canAccessEvent(prisma, params.id, currentUser.id);

  if (!access.isAdmin && !access.isCreator && !access.hasInvite) {
    return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
  }

  const invites = await prisma.eventInvite.findMany({
    where: { eventId: params.id },
    include: {
      invitedUser: {
        select: { id: true, name: true, avatarUrl: true },
      },
      invitedBy: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return reply.send({ invites });
});

app.delete("/events/:id/invites/:userId", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(
    z.object({ id: schemas.id, userId: schemas.id }),
    request.params
  );

  const access = await canAccessEvent(prisma, params.id, currentUser.id);
  if (!access.isAdmin && !access.isCreator) {
    return reply.status(403).send({
      error: "Only event creator or admin can remove invites",
      code: "FORBIDDEN",
    });
  }

  await prisma.eventInvite.deleteMany({
    where: { eventId: params.id, userId: params.userId },
  });

  await queueCalendarSync(access.event.groupId, "event_invite_changed", params.id);

  return reply.status(204).send();
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
      calendarName: `GEM - ${event.title}`,
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
    reply.header("X-Gem-Calendar-Last-Synced-At", syncMeta.lastSyncedAt);
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
      calendarName: `GEM - ${group.name}`,
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
  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const token = randomBytes(32).toString("hex");
  const group = await prisma.group.update({
    where: { id: params.groupId },
    data: { calendarToken: token },
    select: { calendarToken: true },
  });

  const feedUrl = buildCalendarFeedUrl(group.calendarToken ?? token);
  return reply.send({ feedUrl });
});

// DELETE /groups/:groupId/calendar-token — revoke feed token
app.delete("/groups/:groupId/calendar-token", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(calendarTokenParamsSchema, request.params);
  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  await prisma.group.update({
    where: { id: params.groupId },
    data: { calendarToken: null },
  });

  return reply.status(204).send();
});

// GET /groups/:groupId/calendar-token — return existing token (if any)
app.get("/groups/:groupId/calendar-token", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(calendarTokenParamsSchema, request.params);
  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const group = await prisma.group.findUnique({
    where: { id: params.groupId },
    select: { calendarToken: true },
  });

  if (!group?.calendarToken) {
    return reply.send({ feedUrl: null });
  }

  const feedUrl = buildCalendarFeedUrl(group.calendarToken);
  return reply.send({ feedUrl });
});

// GET /calendar/group-feed/:token.ics — public feed endpoint (token = auth, no JWT)
const groupFeedParamsSchema = z.object({ token: z.string().min(64).max(64) });

app.get("/calendar/group-feed/:token.ics", async (request, reply) => {
  const params = await validateRequest(groupFeedParamsSchema, request.params);

  const group = await prisma.group.findUnique({
    where: { calendarToken: params.token },
    select: {
      id: true,
      name: true,
    },
  });

  const legacyMembership = !group
    ? await prisma.membership.findUnique({
        where: { calendarToken: params.token },
        select: {
          group: {
            select: {
              id: true,
              name: true,
            },
          },
          status: true,
        },
      })
    : null;

  const resolvedGroup = group ?? legacyMembership?.group ?? null;
  if (!resolvedGroup || (legacyMembership && legacyMembership.status !== "active")) {
    return reply.status(404).send("Not found");
  }

  const { ics, syncMeta, latestUpdatedAt } = await buildCalendarFeedResponse(
    resolvedGroup.id,
    resolvedGroup.name
  );

  reply.header("Content-Type", "text/calendar; charset=utf-8");
  reply.header("Cache-Control", "no-cache, max-age=0, must-revalidate");
  reply.header(
    "Content-Disposition",
    `inline; filename="gem-${resolvedGroup.id}.ics"`
  );
  if (syncMeta.revision) {
    reply.header("ETag", `W/\"${syncMeta.revision}\"`);
    reply.header("X-Gem-Calendar-Revision", syncMeta.revision);
  }
  if (syncMeta.lastSyncedAt) {
    reply.header("X-Gem-Calendar-Last-Synced-At", syncMeta.lastSyncedAt);
  }
  if (latestUpdatedAt) {
    reply.header("Last-Modified", formatHttpDate(latestUpdatedAt));
  }
  return reply.send(ics);
});

// ============================================================================
// Per-user calendar preference routes
// ============================================================================

const calendarPrefsBodySchema = z.object({
  filterMode: z.enum(["all", "rsvp", "tags"]),
  tagIds: z.array(schemas.id).optional(),
});

function buildUserCalendarFeedUrl(token: string) {
  const apiBase = (process.env.API_BASE_URL || "").replace(/\/$/, "");
  return `${apiBase}/calendar/user-feed/${token}.ics`;
}

async function getOrCreateCalendarPref(userId: string, groupId: string) {
  const existing = await prisma.userCalendarPreference.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (existing) return existing;
  const token = randomBytes(32).toString("hex");
  return prisma.userCalendarPreference.create({
    data: { userId, groupId, calendarToken: token },
  });
}

// GET /groups/:groupId/calendar/preferences — return (or auto-create) user's prefs + feed URL
app.get("/groups/:groupId/calendar/preferences", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);
  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const pref = await getOrCreateCalendarPref(currentUser.id, params.groupId);
  return reply.send({
    filterMode: pref.filterMode,
    tagIds: pref.tagIds ? pref.tagIds.split(",").filter(Boolean) : [],
    feedUrl: buildUserCalendarFeedUrl(pref.calendarToken),
  });
});

// PUT /groups/:groupId/calendar/preferences — upsert user's filter settings
app.put("/groups/:groupId/calendar/preferences", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);
  const body = await validateRequest(calendarPrefsBodySchema, request.body);
  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const tagIdsStr = body.filterMode === "tags" && Array.isArray(body.tagIds)
    ? body.tagIds.join(",")
    : "";

  const pref = await prisma.userCalendarPreference.upsert({
    where: { userId_groupId: { userId: currentUser.id, groupId: params.groupId } },
    update: { filterMode: body.filterMode, tagIds: tagIdsStr, updatedAt: new Date() },
    create: {
      userId: currentUser.id,
      groupId: params.groupId,
      filterMode: body.filterMode,
      tagIds: tagIdsStr,
      calendarToken: randomBytes(32).toString("hex"),
    },
  });

  return reply.send({
    filterMode: pref.filterMode,
    tagIds: pref.tagIds ? pref.tagIds.split(",").filter(Boolean) : [],
    feedUrl: buildUserCalendarFeedUrl(pref.calendarToken),
  });
});

// GET /calendar/user-feed/:token.ics — public per-user ICS feed (token = auth)
const userFeedParamsSchema = z.object({ token: z.string().min(64).max(64) });

app.get("/calendar/user-feed/:token.ics", async (request, reply) => {
  const params = await validateRequest(userFeedParamsSchema, request.params);

  const pref = await prisma.userCalendarPreference.findUnique({
    where: { calendarToken: params.token },
    select: { userId: true, groupId: true, filterMode: true, tagIds: true },
  });
  if (!pref) return reply.status(404).send("Not found");

  const membership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: pref.userId, groupId: pref.groupId } },
    select: { status: true },
  });
  if (!membership || membership.status !== "active") return reply.status(403).send("Forbidden");

  const group = await prisma.group.findUnique({
    where: { id: pref.groupId },
    select: { name: true },
  });
  if (!group) return reply.status(404).send("Not found");

  let whereClause: object = { groupId: pref.groupId, isPrivate: false };

  if (pref.filterMode === "rsvp") {
    const rsvps = await prisma.rSVP.findMany({
      where: { userId: pref.userId, status: { in: ["yes", "maybe"] }, event: { groupId: pref.groupId } },
      select: { eventId: true },
    });
    const rsvpEventIds = rsvps.map((r) => r.eventId);
    // Include private events the user RSVPed to (they were invited, so it's their own calendar)
    whereClause = { id: { in: rsvpEventIds }, groupId: pref.groupId };
  } else if (pref.filterMode === "tags") {
    const tagIdList = pref.tagIds.split(",").filter(Boolean);
    // When no tags are selected, show empty feed rather than falling through to all events.
    whereClause = tagIdList.length > 0
      ? { groupId: pref.groupId, isPrivate: false, tags: { some: { id: { in: tagIdList } } } }
      : { id: { in: [] } }; // no tags selected → empty calendar
  }

  const events = await prisma.event.findMany({
    where: whereClause,
    orderBy: { dateTime: "asc" },
    select: {
      id: true, title: true, details: true,
      dateTime: true, endsAt: true, location: true, updatedAt: true,
    },
  });

  const ics = buildIcsCalendar(events, {
    calendarName: `GEM - ${group.name}`,
    webBaseUrl: process.env.WEB_BASE_URL,
  });

  const syncMeta = await getCalendarSyncMeta(pref.groupId);
  const latestUpdatedAt = events.reduce<Date | null>((latest, ev) => {
    if (!latest || ev.updatedAt > latest) return ev.updatedAt;
    return latest;
  }, null);

  reply.header("Content-Type", "text/calendar; charset=utf-8");
  reply.header("Cache-Control", "no-cache, max-age=0, must-revalidate");
  reply.header("Content-Disposition", `inline; filename="gem-user-${pref.groupId}.ics"`);
  if (syncMeta.revision) reply.header("ETag", `W/\"${syncMeta.revision}\"`);
  if (latestUpdatedAt) reply.header("Last-Modified", formatHttpDate(latestUpdatedAt));
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
// Groups CRUD Routes
// ============================================================================

app.get("/groups", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);

  const cacheKey = `cache:groups:${currentUser.id}`;
  const cached = await cache.get<{ groups: unknown[] }>(cacheKey);
  if (cached) {
    reply.header("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    return reply.send(cached);
  }

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

  const result = { groups };
  reply.header("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  await cache.set(cacheKey, result, 30);
  return reply.send(result);
});

app.post("/groups", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(createGroupBodySchema, request.body);

  // Beta gate: if GROUP_CREATION_BETA_REQUIRED is set, validate code (skipped for demo users)
  if (process.env.GROUP_CREATION_BETA_REQUIRED === "true" && !currentUser.isDemo) {
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

  await cache.del(`cache:groups:${currentUser.id}`);
  return reply.status(201).send({ group });
});

app.get("/groups/:groupId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const groupCacheKey = `cache:group:${params.groupId}`;
  const cachedGroup = await cache.get<{ group: { updatedAt: string } }>(groupCacheKey);
  if (cachedGroup) {
    const etag = weakETag(cachedGroup.group.updatedAt);
    if (request.headers["if-none-match"] === etag) return reply.status(304).send();
    reply.header("ETag", etag);
    reply.header("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    return reply.send(cachedGroup); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
  }

  const group = await prisma.group.findUnique({
    where: { id: params.groupId },
    include: {
      _count: { select: { memberships: true, events: true, channels: true } },
    },
  });

  if (!group) {
    return reply.status(404).send({ error: "Group not found", code: "NOT_FOUND" });
  }

  const groupResult = { group };
  const etag = weakETag(group.updatedAt);
  if (request.headers["if-none-match"] === etag) return reply.status(304).send();
  reply.header("ETag", etag);
  reply.header("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  await cache.set(groupCacheKey, groupResult, 30);
  return reply.send(groupResult); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
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
      ...(body.statsEnabled !== undefined ? { statsEnabled: body.statsEnabled } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      groupId: params.groupId,
      actorId: currentUser.id,
      action: "group_updated",
    },
  });

  await cache.del(`cache:group:${params.groupId}`, `cache:groups:${currentUser.id}`);
  return reply.send({ group });
});

// DELETE /groups/:groupId/leave — any active member (non-owner) leaves the group
app.delete("/groups/:groupId/leave", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);

  if (membership.role === "owner") {
    return reply.status(403).send({ error: "Group owner cannot leave. Transfer ownership or delete the group.", code: "OWNER_CANNOT_LEAVE" });
  }

  await prisma.membership.delete({
    where: { userId_groupId: { userId: currentUser.id, groupId: params.groupId } },
  });

  await prisma.userCalendarPreference.deleteMany({
    where: { userId: currentUser.id, groupId: params.groupId },
  });

  await cache.del(`cache:groups:${currentUser.id}`);
  return reply.status(204).send();
});

app.delete("/groups/:groupId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner"]);

  await prisma.group.delete({ where: { id: params.groupId } });
  await cache.del(`cache:group:${params.groupId}`, `cache:groups:${currentUser.id}`);
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

  await prisma.userCalendarPreference.deleteMany({
    where: { userId: params.userId, groupId: params.groupId },
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
      user: { select: { id: true, email: true, name: true, username: true, avatarUrl: true, showEmail: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  reply.header("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  return reply.send({
    members: members.map((m) => ({
      userId: m.user.id,
      ...(m.user.showEmail ? { email: m.user.email } : {}),
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

  const inviteCode = group.inviteCode;
  if (!inviteCode) {
    throw new Error(`Group ${params.groupId} is missing an invite code after retrieval`);
  }

  return reply.send({
    groupId: params.groupId,
    inviteCode,
    inviteUrl: buildGroupInviteUrl(inviteCode),
  });
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

  const inviteCode = group.inviteCode;
  if (!inviteCode) {
    throw new Error(`Group ${params.groupId} is missing an invite code after regeneration`);
  }

  await prisma.auditLog.create({
    data: {
      groupId: params.groupId,
      actorId: currentUser.id,
      action: "invite_regenerated",
    },
  });

  return reply.send({
    groupId: params.groupId,
    inviteCode,
    inviteUrl: buildGroupInviteUrl(inviteCode),
  });
});

// POST /groups/join — any authenticated user joins a group via invite code (creates pending membership)
app.post("/groups/join", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  if (currentUser.isDemo) return reply.status(403).send({ error: "Demo users cannot join existing groups.", code: "DEMO_RESTRICTED" });
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
          <h2 style="margin:0 0 12px 0;">GEM</h2>
          <p style="margin:0 0 16px 0;"><strong>${escapeHtml(currentUser.name)}</strong> (${escapeHtml(currentUser.email)}) has requested to join your group <strong>${escapeHtml(group.name)}</strong>.</p>
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
      app.log.info({ to: owner.email, requester: sanitizeForLog(currentUser.name), group: sanitizeForLog(group.name) }, "[DEV] Group join request email");
    }
  }

  await cache.del(`cache:groups:${currentUser.id}`);
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
          <h2 style="margin:0 0 12px 0;">GEM</h2>
          <p style="margin:0 0 16px 0;">Your request to join <strong>${escapeHtml(group?.name ?? "the group")}</strong> has been <strong style="color:#22c55e;">approved</strong>!</p>
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
          <h2 style="margin:0 0 12px 0;">GEM</h2>
          <p style="margin:0 0 16px 0;">Your request to join <strong>${escapeHtml(group?.name ?? "the group")}</strong> was not approved at this time.</p>
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

  await prisma.auditLog.create({
    data: {
      groupId,
      actorId: currentUser.id,
      action: "member_muted",
      targetUserId: userId,
    },
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

  await prisma.auditLog.create({
    data: {
      groupId,
      actorId: currentUser.id,
      action: "member_unmuted",
      targetUserId: userId,
    },
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

// GET /groups/:groupId/stats — admins always; members when statsEnabled
app.get("/groups/:groupId/stats", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId } = request.params as { groupId: string };

  const membership = await requireGroupMembership(prisma, currentUser.id, groupId);
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  if (!isAdmin) {
    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { statsEnabled: true } });
    if (!group?.statsEnabled) {
      return reply.status(403).send({ error: "Stats are not enabled for this group", code: "FORBIDDEN" });
    }
  }

  const [
    totalEvents,
    rsvpCounts,
    memberRsvpCounts,
    eventsWithTags,
    storageResult,
    totalMembers,
    totalMessages,
  ] = await Promise.all([
    prisma.event.count({ where: { groupId } }),
    prisma.rSVP.groupBy({
      by: ["status"],
      where: { event: { groupId } },
      _count: { _all: true },
    }),
    prisma.rSVP.groupBy({
      by: ["userId"],
      where: { event: { groupId }, status: "yes" },
      _count: { _all: true },
      orderBy: { _count: { userId: "desc" } },
      take: 5,
    }),
    prisma.event.findMany({
      where: { groupId },
      select: { tags: { select: { id: true, name: true, color: true } } },
    }),
    prisma.mediaAsset.aggregate({
      where: { event: { groupId } },
      _sum: { sizeBytes: true },
    }),
    prisma.membership.count({ where: { groupId, status: "active" } }),
    prisma.message.count({ where: { channel: { groupId } } }),
  ]);

  const totalMedia = await prisma.mediaAsset.count({ where: { event: { groupId } } });

  // Resolve top member names
  const topMemberIds = memberRsvpCounts.map((r) => r.userId);
  const topMemberUsers = await prisma.user.findMany({
    where: { id: { in: topMemberIds } },
    select: { id: true, name: true, username: true, avatarUrl: true },
  });
  const topMembers = memberRsvpCounts.map((r) => {
    const user = topMemberUsers.find((u) => u.id === r.userId);
    return { userId: r.userId, name: user?.name ?? "Unknown", username: user?.username ?? null, avatarUrl: user?.avatarUrl ?? null, rsvpYesCount: r._count._all };
  });

  // Count tags from implicit m2m relation
  const tagCountMap = new Map<string, { name: string; color: string | null; count: number }>();
  for (const event of eventsWithTags) {
    for (const tag of event.tags) {
      const existing = tagCountMap.get(tag.id);
      if (existing) existing.count++;
      else tagCountMap.set(tag.id, { name: tag.name, color: tag.color, count: 1 });
    }
  }
  const topTagsResolved = Array.from(tagCountMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([tagId, t]) => ({ tagId, name: t.name, color: t.color, eventCount: t.count }));

  const rsvpByStatus: Record<string, number> = {};
  for (const r of rsvpCounts) {
    rsvpByStatus[r.status] = r._count._all;
  }

  return reply.send({
    totalEvents,
    totalMembers,
    totalMessages,
    totalMedia,
    storageBytes: storageResult._sum.sizeBytes ?? 0,
    rsvpByStatus,
    topMembers,
    topTags: topTagsResolved,
  });
});

// GET /groups/:groupId/members/:userId/stats — caller must be active member
app.get("/groups/:groupId/members/:userId/stats", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { groupId, userId } = request.params as { groupId: string; userId: string };

  await requireGroupMembership(prisma, currentUser.id, groupId);

  const targetMembership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId, groupId } },
    select: { status: true },
  });
  if (!targetMembership || targetMembership.status !== "active") {
    return reply.status(404).send({ error: "Member not found", code: "NOT_FOUND" });
  }

  const [eventsCreated, rsvpCounts, photosUploaded] = await Promise.all([
    prisma.event.count({ where: { groupId, createdById: userId } }),
    prisma.rSVP.groupBy({
      by: ["status"],
      where: { userId, event: { groupId } },
      _count: { _all: true },
    }),
    prisma.mediaAsset.count({ where: { uploaderId: userId, event: { groupId } } }),
  ]);

  const rsvpByStatus: Record<string, number> = {};
  for (const r of rsvpCounts) {
    rsvpByStatus[r.status] = r._count._all;
  }

  return reply.send({
    eventsCreated,
    rsvpYes: rsvpByStatus["yes"] ?? 0,
    rsvpMaybe: rsvpByStatus["maybe"] ?? 0,
    rsvpNo: rsvpByStatus["no"] ?? 0,
    photosUploaded,
  });
});

// ============================================================================
// User Profile Routes
// ============================================================================

app.get("/users/me", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);

  const meCacheKey = `cache:userme:${currentUser.id}`;
  const cachedMe = await cache.get(meCacheKey);
  if (cachedMe) return reply.send(cachedMe);

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { id: true, email: true, name: true, username: true, usernameChangedAt: true, avatarUrl: true, theme: true, showEmail: true, onboardingDone: true, birthdate: true, birthdateSet: true, createdAt: true },
  });

  const isAdmin = ADMIN_EMAILS.length > 0 && ADMIN_EMAILS.includes(currentUser.email.toLowerCase());
  const meResult = { user: { ...user, isAdmin } };
  await cache.set(meCacheKey, meResult, 60);
  return reply.send(meResult);
});

app.get("/users/:username", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const { username } = request.params as { username: string };

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, name: true, username: true, bio: true, avatarUrl: true, createdAt: true, showEmail: true, email: true },
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
      group: { select: { id: true, name: true, avatarUrl: true, statsEnabled: true } },
    },
  });

  return reply.send({
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      ...(user.showEmail ? { email: user.email } : {}),
      mutualGroups: mutualMemberships.map((m) => m.group),
    },
  });
});

app.patch("/users/me", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const body = await validateRequest(updateUserBodySchema, request.body);

  const dataToUpdate: Record<string, unknown> = {};
  if (body.name !== undefined) dataToUpdate.name = body.name;
  if (body.bio !== undefined) dataToUpdate.bio = body.bio;
  if (body.avatarUrl !== undefined) dataToUpdate.avatarUrl = body.avatarUrl;
  if (body.theme !== undefined) dataToUpdate.theme = body.theme;
  if (body.showEmail !== undefined) dataToUpdate.showEmail = body.showEmail;
  if (body.onboardingDone !== undefined) dataToUpdate.onboardingDone = body.onboardingDone;

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

  if (body.birthdate !== undefined) {
    const birthdateDate = new Date(body.birthdate);
    if (isNaN(birthdateDate.getTime())) {
      return reply.status(400).send({ error: "Invalid birthdate", code: "INVALID_BIRTHDATE" });
    }
    const ageCutoff = new Date();
    ageCutoff.setFullYear(ageCutoff.getFullYear() - 13);
    if (birthdateDate > ageCutoff) {
      return reply.status(400).send({ error: "Birthdate must be at least 13 years in the past", code: "AGE_REQUIREMENT_NOT_MET" });
    }
    const existing = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { birthdateSet: true },
    });
    if (existing?.birthdateSet) {
      return reply.status(422).send({ error: "Birthdate has already been set and cannot be changed.", code: "BIRTHDATE_ALREADY_SET" });
    }
    dataToUpdate.birthdate = birthdateDate;
    dataToUpdate.birthdateSet = true;
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
    select: { id: true, email: true, name: true, username: true, usernameChangedAt: true, bio: true, avatarUrl: true, theme: true, showEmail: true, onboardingDone: true, birthdate: true, birthdateSet: true, createdAt: true },
  });

  await cache.del(`cache:userme:${currentUser.id}`);
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

// ADMIN_EMAILS and ADMIN_ALLOWED_IPS are defined at module level above

// P3: Optional IP allowlist for admin routes. Set ADMIN_ALLOWED_IPS as a comma-separated
// list of IPs to restrict admin access beyond email-gating.
const ADMIN_ALLOWED_IPS = (process.env.ADMIN_ALLOWED_IPS ?? "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);

async function requireAdminEmail(request: FastifyRequest, reply: FastifyReply, prisma: PrismaClient) {
  const currentUser = await requireAuth(request, reply, prisma);
  if (!ADMIN_EMAILS.includes(currentUser.email.toLowerCase())) {
    reply.status(403).send({ error: "Access denied. Developer panel is restricted.", code: "FORBIDDEN" });
    throw new Error("FORBIDDEN");
  }
  if (ADMIN_ALLOWED_IPS.length > 0 && !ADMIN_ALLOWED_IPS.includes(request.ip)) {
    reply.status(403).send({ error: "Access denied.", code: "IP_FORBIDDEN" });
    throw new Error("IP_FORBIDDEN");
  }
  return currentUser;
}

const updateDevConfigBodySchema = z.object({
  registrationInviteCode: z.string().min(1).max(64).optional(),
  groupCreationInviteCode: z.string().min(1).max(64).optional(),
  mediaUploadEnabled: z.boolean().optional(),
  mediaUploadCode: z.string().max(64).optional(),
});

const createDevGroupCodeBodySchema = z.object({
  count: z.number().int().min(1).max(20).optional(),
});

const createInviteLinkBodySchema = z.object({
  expiresAt: z.string().datetime().optional(),
  singleUse: z.boolean().default(false),
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

  // Active invite links (not yet single-use-consumed; may be expired by time)
  const inviteLinks = await prisma.betaCode.findMany({
    where: { type: "invite_link", OR: [{ singleUse: false }, { usedAt: null }] },
    select: { id: true, code: true, expiresAt: true, singleUse: true, usedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const mediaUploadEnabled = (await redis.get("admin:media_upload_enabled")) === "true";
  const mediaUploadCode = (await redis.get("admin:media_upload_code")) ?? "";

  // Global media storage stats
  const globalMediaUsed = await getGlobalMediaUsedBytes();

  return reply.send({
    registrationInviteCode,
    groupCreationInviteCode,
    registrationBetaRequired: process.env.REGISTRATION_BETA_REQUIRED === "true",
    groupCreationBetaRequired: process.env.GROUP_CREATION_BETA_REQUIRED === "true",
    groupCodes,
    registrationCodes,
    inviteLinks,
    mediaUploadEnabled,
    mediaUploadCode,
    mediaStorage: {
      usedBytes: globalMediaUsed,
      maxBytes: MEDIA_GLOBAL_MAX_BYTES,
      usedFormatted: formatBytes(globalMediaUsed),
      maxFormatted: formatBytes(MEDIA_GLOBAL_MAX_BYTES),
    },
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

  if (body.mediaUploadEnabled !== undefined) {
    await redis.set("admin:media_upload_enabled", body.mediaUploadEnabled ? "true" : "false");
  }

  if (body.mediaUploadCode !== undefined) {
    const code = body.mediaUploadCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 64);
    if (code.length === 0) {
      await redis.del("admin:media_upload_code");
    } else if (code.length < 4) {
      return reply.status(400).send({ error: "Media upload code must be at least 4 characters", code: "INVALID_CODE" });
    } else {
      await redis.set("admin:media_upload_code", code);
    }
  }

  // Return updated config
  const registrationInviteCode = await redis.get("admin:registration_invite_code")
    ?? process.env.REGISTRATION_INVITE_CODE ?? "";
  const groupCreationInviteCode = await redis.get("admin:group_creation_invite_code")
    ?? process.env.GROUP_CREATION_INVITE_CODE ?? "";
  const mediaUploadEnabled = (await redis.get("admin:media_upload_enabled")) === "true";
  const mediaUploadCode = (await redis.get("admin:media_upload_code")) ?? "";

  return reply.send({ registrationInviteCode, groupCreationInviteCode, mediaUploadEnabled, mediaUploadCode });
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

// POST /admin/dev/invite-links — create a new invite link
app.post("/admin/dev/invite-links", async (request, reply) => {
  await requireAdminEmail(request, reply, prisma);
  const body = await validateRequest(createInviteLinkBodySchema, request.body);

  const token = randomBytes(16).toString("hex");
  const link = await prisma.betaCode.create({
    data: {
      code: token,
      type: "invite_link",
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      singleUse: body.singleUse,
    },
    select: { id: true, code: true, expiresAt: true, singleUse: true, usedAt: true, createdAt: true },
  });

  return reply.status(201).send({ link });
});

// DELETE /admin/dev/invite-links/:id — revoke an invite link
app.delete("/admin/dev/invite-links/:id", async (request, reply) => {
  await requireAdminEmail(request, reply, prisma);
  const params = await validateRequest(z.object({ id: schemas.id }), request.params);

  await prisma.betaCode.delete({ where: { id: params.id } });

  return reply.send({ success: true });
});

// GET /admin/dev/email-debug/config — SMTP configuration status (no secrets)
app.get("/admin/dev/email-debug/config", async (request, reply) => {
  await requireAdminEmail(request, reply, prisma);

  return reply.send({
    smtpConfigured: isMailConfigured(),
    smtpHost: process.env.SMTP_HOST ?? null,
    smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null,
    smtpUser: process.env.SMTP_USER ?? null,
    emailFrom: process.env.EMAIL_FROM ?? null,
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
});

const emailDebugSendBodySchema = z.object({
  to: z.string().email({ message: "Invalid recipient email" }),
  subject: z.string().min(1).max(200).optional(),
  body: z.string().max(5000).optional(),
});

// POST /admin/dev/email-debug/send — send a test email
app.post("/admin/dev/email-debug/send", async (request, reply) => {
  const currentUser = await requireAdminEmail(request, reply, prisma);
  const body = await validateRequest(emailDebugSendBodySchema, request.body);

  const subject = body.subject ?? "GEM Test Email";
  const textBody = body.body ?? `This is a test email sent from the GEM developer panel.\n\nSent by: ${currentUser.email}\nTimestamp: ${new Date().toISOString()}`;
  const htmlBody = `<p>${escapeHtml(textBody).replace(/\n/g, "<br>")}</p>`;

  let smtpError: string | null = null;
  const smtpConfigured = isMailConfigured();

  // Use direct transporter send here so SMTP failures are visible in the debug UI.
  if (smtpConfigured) {
    const transporter = getMailTransporter();
    if (!transporter) {
      smtpError = "SMTP transporter unavailable";
    } else {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_FROM || "GEM (Group Event Manager) <noreply@example.com>",
          to: body.to,
          subject,
          html: htmlBody,
          text: textBody,
        });
      } catch (err) {
        smtpError = (err as Error).message;
      }
    }
  } else {
    await sendTransactionalEmail({
      to: body.to,
      subject,
      html: htmlBody,
      text: textBody,
    });
  }

  return reply.send({
    success: smtpError === null,
    smtpConfigured,
    simulated: !smtpConfigured,
    to: body.to,
    subject,
    sentAt: new Date().toISOString(),
    error: smtpError,
  });
});

// ============================================================================
// Tags CRUD Routes
// ============================================================================

app.get("/groups/:groupId/tags", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(groupIdParamsSchema, request.params);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const tagsCacheKey = `cache:tags:${params.groupId}`;
  const cachedTags = await cache.get(tagsCacheKey);
  if (cachedTags) return reply.send(cachedTags); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write

  const tags = await prisma.tag.findMany({
    where: { groupId: params.groupId },
    orderBy: { name: "asc" },
  });

  const tagsResult = { tags };
  await cache.set(tagsCacheKey, tagsResult, 60);
  return reply.send(tagsResult); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
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

  await prisma.auditLog.create({
    data: {
      groupId: params.groupId,
      actorId: currentUser.id,
      action: "tag_created",
      meta: { tagName: body.name },
    },
  });

  await cache.del(`cache:tags:${params.groupId}`);
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

  await cache.del(`cache:tags:${params.groupId}`);
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

  await prisma.auditLog.create({
    data: {
      groupId: params.groupId,
      actorId: currentUser.id,
      action: "tag_deleted",
      meta: { tagName: tag.name },
    },
  });

  await prisma.tag.delete({ where: { id: params.tagId } });
  await cache.del(`cache:tags:${params.groupId}`);
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
      tags: { select: { id: true, name: true, color: true } },
    },
    orderBy: { name: "asc" },
  });

  // Fetch read states and compute unread counts in parallel
  const readStates = await prisma.channelReadState.findMany({
    where: { userId: currentUser.id, channelId: { in: channels.map((c) => c.id) } },
    select: { channelId: true, lastReadAt: true },
  });
  const readMap = new Map(readStates.map((r) => [r.channelId, r.lastReadAt]));

  const unreadCounts = await Promise.all(
    channels.map((ch) =>
      prisma.message.count({
        where: {
          channelId: ch.id,
          createdAt: { gt: readMap.get(ch.id) ?? new Date(0) },
        },
      })
    )
  );

  // general channel always first, rest alphabetical
  const sorted = [
    ...channels.map((ch, i) => ({ ch, unread: unreadCounts[i] })).filter(({ ch }) => ch.isGeneral),
    ...channels.map((ch, i) => ({ ch, unread: unreadCounts[i] })).filter(({ ch }) => !ch.isGeneral),
  ];

  reply.header("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
  return reply.send({
    channels: sorted.map(({ ch, unread }) => ({
      id: ch.id,
      name: ch.name,
      isGeneral: ch.isGeneral,
      isInviteOnly: ch.isInviteOnly,
      subscriberCount: ch._count.subscriptions,
      messageCount: ch._count.messages,
      isSubscribed: ch.subscriptions.length > 0,
      tags: ch.tags,
      unreadCount: unread,
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

  // Auto-subscribe the creator so they can immediately use the channel they just made
  await prisma.channelSubscription.create({
    data: { userId: currentUser.id, channelId: channel.id },
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

// PUT /groups/:groupId/channels/:channelId/tags — set tag assignments for a channel (admin+)
const channelTagsBodySchema = z.object({
  tagIds: z.array(schemas.id),
});

app.put("/groups/:groupId/channels/:channelId/tags", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(channelParamsSchema, request.params);
  const body = await validateRequest(channelTagsBodySchema, request.body);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const channel = await prisma.channel.findFirst({
    where: { id: params.channelId, groupId: params.groupId },
  });
  if (!channel) {
    return reply.status(404).send({ error: "Channel not found", code: "NOT_FOUND" });
  }

  // Validate all tagIds belong to this group
  if (body.tagIds.length > 0) {
    const tags = await prisma.tag.findMany({
      where: { id: { in: body.tagIds }, groupId: params.groupId },
      select: { id: true },
    });
    if (tags.length !== body.tagIds.length) {
      return reply.status(400).send({ error: "One or more tags not found in this group", code: "INVALID_TAGS" });
    }
  }

  const updated = await prisma.channel.update({
    where: { id: params.channelId },
    data: {
      tags: { set: body.tagIds.map((id) => ({ id })) },
    },
    include: { tags: { select: { id: true, name: true, color: true } } },
  });

  return reply.send({ tags: updated.tags });
});

// PATCH /groups/:groupId/channels/:channelId — rename a channel (admin+)
const renameChannelBodySchema = z.object({
  name: z.string().min(1).max(32).regex(/^[a-z0-9-]+$/, "Name must be lowercase letters, numbers, or hyphens"),
});

app.patch("/groups/:groupId/channels/:channelId", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(channelParamsSchema, request.params);
  const body = await validateRequest(renameChannelBodySchema, request.body);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const channel = await prisma.channel.findFirst({
    where: { id: params.channelId, groupId: params.groupId },
  });
  if (!channel) {
    return reply.status(404).send({ error: "Channel not found", code: "NOT_FOUND" });
  }

  const updated = await prisma.channel.update({
    where: { id: params.channelId },
    data: { name: body.name },
    select: { id: true, name: true, isInviteOnly: true, isGeneral: true },
  });

  return reply.send({ channel: updated });
});

// DELETE /groups/:groupId/channels/:channelId — delete a channel (admin+, non-general only)
app.delete("/groups/:groupId/channels/:channelId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(channelParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  requireRole(membership.role, ["owner", "admin"]);

  const channel = await prisma.channel.findFirst({
    where: { id: params.channelId, groupId: params.groupId },
  });
  if (!channel) {
    return reply.status(404).send({ error: "Channel not found", code: "NOT_FOUND" });
  }
  if (channel.isGeneral) {
    return reply.status(400).send({ error: "Cannot delete the general channel", code: "CANNOT_DELETE_GENERAL" });
  }

  await prisma.channel.delete({ where: { id: params.channelId } });

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
      reactions: { select: { userId: true, emoji: true } },
      replyTo: { select: { id: true, content: true, user: { select: { id: true, name: true } } } },
    },
  });

  const hasMore = raw.length > query.limit;
  const messages = raw.slice(0, query.limit).reverse();

  return reply.send({ messages, hasMore });
});

// POST /groups/:groupId/channels/:channelId/read — mark channel as read for the current user
app.post("/groups/:groupId/channels/:channelId/read", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(channelParamsSchema, request.params);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  await prisma.channelReadState.upsert({
    where: { userId_channelId: { userId: currentUser.id, channelId: params.channelId } },
    create: { userId: currentUser.id, channelId: params.channelId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });

  return reply.status(204).send();
});

// DELETE /groups/:groupId/channels/:channelId/messages/:messageId — delete own message only
const messageParamsSchema = z.object({
  groupId: schemas.id,
  channelId: schemas.id,
  messageId: schemas.id,
});

app.delete("/groups/:groupId/channels/:channelId/messages/:messageId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(messageParamsSchema, request.params);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const message = await prisma.message.findFirst({
    where: { id: params.messageId, channelId: params.channelId },
  });
  if (!message) {
    return reply.status(404).send({ error: "Message not found", code: "NOT_FOUND" });
  }

  if (message.userId !== currentUser.id) {
    return reply.status(403).send({ error: "You can only delete your own messages", code: "FORBIDDEN" });
  }

  await prisma.message.delete({ where: { id: params.messageId } });

  chatIo?.to(`channel:${params.channelId}`).emit("channel:message:deleted", {
    messageId: params.messageId,
    channelId: params.channelId,
  });

  return reply.status(204).send();
});

// PATCH /groups/:groupId/channels/:channelId/messages/:messageId — edit own message
const editMessageBodySchema = z.object({
  content: z.string().min(1).max(2000),
});

app.patch("/groups/:groupId/channels/:channelId/messages/:messageId", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(messageParamsSchema, request.params);
  const body = await validateRequest(editMessageBodySchema, request.body);

  const message = await prisma.message.findFirst({
    where: { id: params.messageId, channelId: params.channelId },
  });
  if (!message) {
    return reply.status(404).send({ error: "Message not found", code: "NOT_FOUND" });
  }
  if (message.userId !== currentUser.id) {
    return reply.status(403).send({ error: "Cannot edit another user's message", code: "FORBIDDEN" });
  }

  const updated = await prisma.message.update({
    where: { id: params.messageId },
    data: { content: body.content.trim() },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });

  chatIo?.to(`channel:${params.channelId}`).emit("channel:message:edited", {
    messageId: params.messageId,
    channelId: params.channelId,
    content: updated.content,
    updatedAt: updated.updatedAt.toISOString(),
  });

  return reply.send({ message: updated });
});

// POST /groups/:groupId/channels/:channelId/messages/:messageId/pin — toggle pin (admin+)
app.post("/groups/:groupId/channels/:channelId/messages/:messageId/pin", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(messageParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  const isAdminOrOwner = membership.role === "owner" || membership.role === "admin";
  if (!isAdminOrOwner) {
    return reply.status(403).send({ error: "Admin or owner required", code: "FORBIDDEN" });
  }

  const message = await prisma.message.findFirst({
    where: { id: params.messageId, channelId: params.channelId },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });
  if (!message) {
    return reply.status(404).send({ error: "Message not found", code: "NOT_FOUND" });
  }

  const updated = await prisma.message.update({
    where: { id: params.messageId },
    data: { pinned: !message.pinned },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });

  chatIo?.to(`channel:${params.channelId}`).emit("channel:message:pinned", {
    messageId: params.messageId,
    channelId: params.channelId,
    pinned: updated.pinned,
  });

  return reply.send({ message: updated });
});

// POST /groups/:groupId/channels/:channelId/messages/:messageId/react — toggle emoji reaction
const reactBodySchema = z.object({
  emoji: z.string().min(1).max(8),
});

app.post("/groups/:groupId/channels/:channelId/messages/:messageId/react", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(messageParamsSchema, request.params);
  const body = await validateRequest(reactBodySchema, request.body);

  await requireGroupMembership(prisma, currentUser.id, params.groupId);

  const message = await prisma.message.findFirst({
    where: { id: params.messageId, channelId: params.channelId },
  });
  if (!message) {
    return reply.status(404).send({ error: "Message not found", code: "NOT_FOUND" });
  }

  const existing = await prisma.messageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId: params.messageId, userId: currentUser.id, emoji: body.emoji } },
  });

  if (existing) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
    chatIo?.to(`channel:${params.channelId}`).emit("channel:message:unreact", {
      messageId: params.messageId,
      channelId: params.channelId,
      userId: currentUser.id,
      emoji: body.emoji,
    });
    return reply.send({ action: "removed", emoji: body.emoji });
  } else {
    await prisma.messageReaction.create({
      data: { messageId: params.messageId, userId: currentUser.id, emoji: body.emoji },
    });
    chatIo?.to(`channel:${params.channelId}`).emit("channel:message:react", {
      messageId: params.messageId,
      channelId: params.channelId,
      userId: currentUser.id,
      emoji: body.emoji,
    });
    return reply.send({ action: "added", emoji: body.emoji });
  }
});

// GET /groups/:groupId/channels/:channelId/subscribers
// Admins: always allowed. Members: allowed if channel is invite-only and they are subscribed.
app.get("/groups/:groupId/channels/:channelId/subscribers", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(channelParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  const isAdminOrOwner = membership.role === "owner" || membership.role === "admin";

  const channel = await prisma.channel.findFirst({
    where: { id: params.channelId, groupId: params.groupId },
  });
  if (!channel) {
    return reply.status(404).send({ error: "Channel not found", code: "NOT_FOUND" });
  }

  if (!isAdminOrOwner) {
    if (!channel.isInviteOnly) {
      return reply.status(403).send({ error: "Admin or owner required", code: "FORBIDDEN" });
    }
    const sub = await prisma.channelSubscription.findUnique({
      where: { userId_channelId: { userId: currentUser.id, channelId: params.channelId } },
    });
    if (!sub) {
      return reply.status(403).send({ error: "Not a member of this channel", code: "FORBIDDEN" });
    }
  }

  const subscriptions = await prisma.channelSubscription.findMany({
    where: { channelId: params.channelId },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });

  return reply.send({ subscribers: subscriptions.map((s) => s.user), isAdmin: isAdminOrOwner });
});

// PUT /groups/:groupId/channels/:channelId/subscribers/:userId — add subscriber (admin+)
const subscriberParamsSchema = z.object({
  groupId: schemas.id,
  channelId: schemas.id,
  userId: schemas.id,
});

app.put("/groups/:groupId/channels/:channelId/subscribers/:userId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(subscriberParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  const isAdminOrOwner = membership.role === "owner" || membership.role === "admin";
  if (!isAdminOrOwner) {
    return reply.status(403).send({ error: "Admin or owner required", code: "FORBIDDEN" });
  }

  const targetMembership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId: params.userId, groupId: params.groupId } },
  });
  if (!targetMembership || targetMembership.status !== "active") {
    return reply.status(400).send({ error: "User is not an active group member", code: "BAD_REQUEST" });
  }

  await prisma.channelSubscription.upsert({
    where: { userId_channelId: { userId: params.userId, channelId: params.channelId } },
    create: { userId: params.userId, channelId: params.channelId },
    update: {},
  });

  return reply.status(204).send();
});

// DELETE /groups/:groupId/channels/:channelId/subscribers/:userId — remove subscriber (admin+)
app.delete("/groups/:groupId/channels/:channelId/subscribers/:userId", async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(subscriberParamsSchema, request.params);

  const membership = await requireGroupMembership(prisma, currentUser.id, params.groupId);
  const isAdminOrOwner = membership.role === "owner" || membership.role === "admin";
  if (!isAdminOrOwner) {
    return reply.status(403).send({ error: "Admin or owner required", code: "FORBIDDEN" });
  }

  await prisma.channelSubscription.deleteMany({
    where: { channelId: params.channelId, userId: params.userId },
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
    const reminderOffsetMinutes = pref.type === "event_start" ? (pref.reminderOffsetMinutes ?? null) : undefined;
    const result = await prisma.userNotificationPreference.upsert({
      where: {
        userId_type_channel: {
          userId: currentUser.id,
          type: pref.type,
          channel: pref.channel,
        },
      },
      update: { enabled: pref.enabled, ...(pref.type === "event_start" ? { reminderOffsetMinutes } : {}) },
      create: {
        userId: currentUser.id,
        type: pref.type,
        channel: pref.channel,
        enabled: pref.enabled,
        ...(pref.type === "event_start" ? { reminderOffsetMinutes } : {}),
      },
    });
    results.push(result);
  }

  return reply.send({ preferences: results });
});

// ============================================================================
// Notification Inbox Routes
// ============================================================================

const NOTIFICATION_INBOX_TTL_DAYS = 7;

// Helper: resolve which notification types are in_app-enabled for a user (default true)
async function getEnabledInAppTypes(userId: string): Promise<string[]> {
  const allTypes = ["chat_message", "event_created", "event_changed", "invite", "rsvp_update", "event_start", "mention"];
  const prefs = await prisma.userNotificationPreference.findMany({
    where: { userId, channel: "in_app" },
    select: { type: true, enabled: true },
  });
  const prefMap = new Map(prefs.map((p) => [p.type, p.enabled]));
  return allTypes.filter((t) => prefMap.get(t) !== false);
}

// GET /notifications/inbox — all notifications for the current user (last 7 days), with readAt
app.get("/notifications/inbox", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const cutoff = new Date(Date.now() - NOTIFICATION_INBOX_TTL_DAYS * 24 * 60 * 60 * 1000);
  const enabledTypes = await getEnabledInAppTypes(currentUser.id);

  const notifications = await prisma.notificationEvent.findMany({
    where: {
      recipientId: currentUser.id,
      createdAt: { gte: cutoff },
      type: { in: enabledTypes },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, title: true, body: true, url: true, createdAt: true, readAt: true },
  });

  return reply.send({ notifications });
});

// GET /notifications/inbox/count — count of UNREAD notifications (last 7 days)
app.get("/notifications/inbox/count", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const cutoff = new Date(Date.now() - NOTIFICATION_INBOX_TTL_DAYS * 24 * 60 * 60 * 1000);
  const enabledTypes = await getEnabledInAppTypes(currentUser.id);

  const count = await prisma.notificationEvent.count({
    where: {
      recipientId: currentUser.id,
      createdAt: { gte: cutoff },
      type: { in: enabledTypes },
      readAt: null,
    },
  });

  return reply.send({ count });
});

// PATCH /notifications/inbox/:id/read — mark a single notification as read
app.patch("/notifications/inbox/:notificationId/read", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(z.object({ notificationId: schemas.id }), request.params);

  const updated = await prisma.notificationEvent.updateMany({
    where: { id: params.notificationId, recipientId: currentUser.id, readAt: null },
    data: { readAt: new Date() },
  });

  if (updated.count === 0) {
    // Either not found or already read — both are fine, return 204
  }

  return reply.status(204).send();
});

// PATCH /notifications/inbox/read-all — mark all unread notifications as read
app.patch("/notifications/inbox/read-all", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const cutoff = new Date(Date.now() - NOTIFICATION_INBOX_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.notificationEvent.updateMany({
    where: { recipientId: currentUser.id, createdAt: { gte: cutoff }, readAt: null },
    data: { readAt: new Date() },
  });

  return reply.status(204).send();
});

// DELETE /notifications/inbox/:id — permanently delete a single notification
app.delete("/notifications/inbox/:notificationId", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const params = await validateRequest(
    z.object({ notificationId: schemas.id }),
    request.params,
  );

  const deleted = await prisma.notificationEvent.deleteMany({
    where: { id: params.notificationId, recipientId: currentUser.id },
  });

  if (deleted.count === 0) {
    return reply.status(404).send({ error: "Notification not found", code: "NOT_FOUND" });
  }

  return reply.status(204).send();
});

// DELETE /notifications/inbox — permanently delete all notifications for the current user
app.delete("/notifications/inbox", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const currentUser = await requireAuth(request, reply, prisma);
  const cutoff = new Date(Date.now() - NOTIFICATION_INBOX_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.notificationEvent.deleteMany({
    where: { recipientId: currentUser.id, createdAt: { gte: cutoff } },
  });

  return reply.status(204).send();
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
chatIo = createChatServer(
  app.server,
  prisma,
  authSecret,
  configuredWebOrigins,
  app.log,
  redis,
  async ({ channelId, groupId, userId, name, username, content }) => {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, name: true, tags: { select: { id: true } } },
    });
    if (!channel) return;
    const senderLabel = username ? `@${username}` : name;
    await notificationQueue.add("fanout", {
      type: "chat_message",
      groupId,
      actorUserId: userId,
      channelId: channel.id,
      tagIds: channel.tags.map((t) => t.id),
      title: sanitizeNotifText(`${senderLabel} in #${channel.name}`),
      body: sanitizeNotifText(content.slice(0, 140)),
      url: `/groups/${groupId}/channels/${channel.id}`,
    });

    const mentioned = await parseMentionedUsers(content, groupId, userId);
    if (mentioned.length > 0) {
      const actorLabel = username ? `@${username}` : "Someone";
      for (const target of mentioned) {
        await notificationQueue.add("fanout", {
          type: "mention",
          groupId,
          actorUserId: userId,
          channelId: channel.id,
          recipientUserIds: [target.id],
          title: sanitizeNotifText(`${actorLabel} mentioned you in #${channel.name}`),
          body: sanitizeNotifText(content.slice(0, 140)),
          url: `/groups/${groupId}/channels/${channel.id}`,
        });
      }
    }

    const tagMentions = await parseTagMentions(content, groupId, userId);
    if (tagMentions.length > 0) {
      const actorLabel = username ? `@${username}` : "Someone";
      for (const tm of tagMentions) {
        // Exclude users already notified via @mention
        const mentionedIds = new Set(mentioned.map((m) => m.id));
        const recipients = tm.recipientIds.filter((id) => !mentionedIds.has(id));
        if (recipients.length === 0) continue;
        await notificationQueue.add("fanout", {
          type: "mention",
          groupId,
          actorUserId: userId,
          channelId: channel.id,
          recipientUserIds: recipients,
          title: sanitizeNotifText(`${actorLabel} mentioned #${tm.tagName} in #${channel.name}`),
          body: sanitizeNotifText(content.slice(0, 140)),
          url: `/groups/${groupId}/channels/${channel.id}`,
        });
      }
    }
  }
);

// ============================================================================
// Demo Routes
// ============================================================================

// POST /demo/start — claim a demo slot or enter the queue
app.post("/demo/start", { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = z.object({ deviceId: z.string().min(8).max(64) }).safeParse(request.body);
  if (!body.success) return reply.status(400).send({ error: "deviceId required", code: "VALIDATION_ERROR" });
  const { deviceId } = body.data;

  // Reuse existing active session for this device
  const existingSessionId = await redis.get(DEMO_DEVICE_KEY(deviceId));
  if (existingSessionId) {
    const session = await redis.hgetall(DEMO_SESSION_KEY(existingSessionId));
    if (session?.userId && session?.expiresAt) {
      const expiresAt = parseInt(session.expiresAt, 10);
      if (expiresAt > Date.now()) {
        const remainingSeconds = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
        const token = await reply.jwtSign(
          { sub: session.userId, email: session.email, isDemo: true, demoSessionId: existingSessionId },
          { expiresIn: `${remainingSeconds}s` }
        );
        reply.setCookie("gem_token", token, {
          httpOnly: true, secure: process.env.NODE_ENV === "production",
          sameSite: "strict", path: "/", maxAge: remainingSeconds,
        });
        return reply.send({
          status: "active", sessionId: existingSessionId, expiresAt,
          user: { id: session.userId, name: "Demo User", username: "demo", email: "email@example.com", isDemo: true },
        });
      }
      // Expired — clean up stale keys without DB (user may already be deleted)
      await redis.del(DEMO_SESSION_KEY(existingSessionId));
      await redis.srem(DEMO_ACTIVE_SET, existingSessionId);
      await redis.del(DEMO_DEVICE_KEY(deviceId));
    }
  }

  // Check slot availability
  const activeCount = await redis.scard(DEMO_ACTIVE_SET);
  if (activeCount >= DEMO_MAX_CONCURRENT) {
    const score = await redis.zscore(DEMO_QUEUE_ZSET, deviceId);
    if (!score) await redis.zadd(DEMO_QUEUE_ZSET, Date.now(), deviceId);
    const rank = await redis.zrank(DEMO_QUEUE_ZSET, deviceId);
    return reply.send({ status: "queued", position: (rank ?? 0) + 1 });
  }

  // Remove from queue if waiting
  await redis.zrem(DEMO_QUEUE_ZSET, deviceId);

  // Create demo user in DB
  const sessionId = randomUUID();
  const sessionShort = sessionId.replace(/-/g, "").slice(0, 10);
  const demoEmail = `demo-${sessionShort}@gem-demo.internal`;
  const demoUsername = `demo_${sessionShort}`;
  const expiresAt = Date.now() + DEMO_DURATION_MS;

  const demoUser = await prisma.user.create({
    data: {
      email: demoEmail,
      name: "Demo User",
      username: demoUsername,
      emailVerified: true,
      onboardingDone: true,
      passwordHash: await hashPassword(randomUUID()),
    },
    select: { id: true },
  });

  // Seed three demo groups with dummy users and events
  const dummyUserIds = await seedDemoData(demoUser.id);

  // Track session in Redis (including dummy user IDs for cleanup)
  const sessionTtlSec = Math.ceil(DEMO_DURATION_MS / 1000) + 120;
  await redis.hset(DEMO_SESSION_KEY(sessionId), {
    userId: demoUser.id,
    deviceId,
    email: demoEmail,
    startedAt: String(Date.now()),
    expiresAt: String(expiresAt),
    dummyUserIds: JSON.stringify(dummyUserIds),
  });
  await redis.expire(DEMO_SESSION_KEY(sessionId), sessionTtlSec);
  await redis.sadd(DEMO_ACTIVE_SET, sessionId);
  await redis.set(DEMO_DEVICE_KEY(deviceId), sessionId, "EX", sessionTtlSec);

  // Schedule auto-cleanup after 5 min
  await demoCleanupQueue.add(
    "cleanup",
    { sessionId, userId: demoUser.id, deviceId },
    { delay: DEMO_DURATION_MS, jobId: `demo-cleanup-${sessionId}` }
  );

  // Issue short-lived JWT (5 min)
  const token = await reply.jwtSign(
    { sub: demoUser.id, email: demoEmail, isDemo: true, demoSessionId: sessionId },
    { expiresIn: "5m" }
  );
  reply.setCookie("gem_token", token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict", path: "/", maxAge: Math.ceil(DEMO_DURATION_MS / 1000),
  });

  return reply.send({
    status: "active", sessionId, expiresAt,
    user: { id: demoUser.id, name: "Demo User", username: "demo", email: "email@example.com", isDemo: true },
  });
});

// POST /demo/end — end demo session + cleanup all data
app.post("/demo/end", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    clearAuthCookie(reply);
    return reply.send({ ok: true });
  }
  const payload = request.user as { sub?: string; isDemo?: boolean; demoSessionId?: string };
  if (payload.isDemo && payload.demoSessionId) {
    const sessionId = payload.demoSessionId;
    const session = await redis.hgetall(DEMO_SESSION_KEY(sessionId));
    if (session?.userId) {
      await cleanupDemoSession(sessionId, session.userId, session.deviceId ?? "");
    }
  }
  clearAuthCookie(reply);
  return reply.send({ ok: true });
});

// GET /demo/status/:deviceId — poll for queue position or slot readiness
app.get("/demo/status/:deviceId", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
  const { deviceId } = request.params as { deviceId: string };

  // Check for active session
  const sessionId = await redis.get(DEMO_DEVICE_KEY(deviceId));
  if (sessionId) {
    const session = await redis.hgetall(DEMO_SESSION_KEY(sessionId));
    if (session?.expiresAt) {
      const expiresAt = parseInt(session.expiresAt, 10);
      if (expiresAt > Date.now()) {
        return reply.send({ status: "active", sessionId, expiresAt });
      }
    }
    await redis.del(DEMO_DEVICE_KEY(deviceId));
  }

  // Check queue position
  const rank = await redis.zrank(DEMO_QUEUE_ZSET, deviceId);
  if (rank !== null) {
    const activeCount = await redis.scard(DEMO_ACTIVE_SET);
    if (activeCount < DEMO_MAX_CONCURRENT) {
      return reply.send({ status: "slot_ready" });
    }
    return reply.send({ status: "queued", position: rank + 1 });
  }

  return reply.send({ status: "none" });
});

await app.listen({ port, host });

// Verify SMTP connectivity once at startup (non-blocking)
void verifyMailTransporter();

// Purge NotificationEvent records older than the inbox TTL.
// Runs once immediately on startup, then every 24 h.
const purgeExpiredNotifications = async () => {
  const cutoff = new Date(Date.now() - NOTIFICATION_INBOX_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.notificationEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (count > 0) {
    app.log.info({ deleted: count }, "Purged expired notification events");
  }
};
void purgeExpiredNotifications();
const _notificationPurgeInterval = setInterval(
  () => void purgeExpiredNotifications(),
  24 * 60 * 60 * 1000
).unref();

// Graceful shutdown
const gracefulShutdown = async () => {
  await demoCleanupWorker.close();
  await demoCleanupQueue.close();
  await calendarSyncWorker.close();
  await calendarSyncQueue.close();
  await notificationWorker.close();
  await notificationQueue.close();
  workerConnection.disconnect();
  queueConnection.disconnect();
  await chatIo?.close();
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

process.on("uncaughtException", (error) => {
  app.log.fatal({ err: error }, "Uncaught exception");
  void reportError(error, { source: "process", url: "uncaughtException" }).finally(() =>
    process.exit(1)
  );
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  app.log.error({ err: error }, "Unhandled promise rejection");
  void reportError(error, { source: "process", url: "unhandledRejection" });
});
