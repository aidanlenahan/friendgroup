import { createHmac } from "crypto";
import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import type { PrismaClient } from "../generated/prisma/index.js";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";

// ---------------------------------------------------------------------------
// JWT helpers for Socket.IO (not inside Fastify request lifecycle)
// ---------------------------------------------------------------------------

function verifyHS256JWT(token: string, secret: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");
  const [header, payload, signature] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  if (expected !== signature) throw new Error("Invalid signature");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<string, unknown>;
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (typeof decoded.exp === "number" && nowSeconds >= decoded.exp) {
    throw new Error("Token expired");
  }

  if (typeof decoded.nbf === "number" && nowSeconds < decoded.nbf) {
    throw new Error("Token not active");
  }

  return decoded;
}

// ---------------------------------------------------------------------------
// Zod schemas for Socket.IO event payloads
// ---------------------------------------------------------------------------

const JoinChannelSchema = z.object({
  channelId: z.string().min(1),
  groupId: z.string().min(1),
}).strict();

const SendMessageSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().min(1).max(2000),
  replyToId: z.string().min(1).nullable().optional(),
}).strict();

const ChannelIdSchema = z.string().min(1);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SocketUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
}

interface AuthedSocket extends Socket {
  data: {
    userId: string;
    user: SocketUser;
  };
}

// ---------------------------------------------------------------------------
// Redis-backed fixed-window rate limiting
//   Tier 1:  3 messages /  10 s  — burst guard
//   Tier 2: 10 messages /  30 s  — sustained chat guard
//   Tier 3: 20 messages /  60 s  — per-minute hard cap
// ---------------------------------------------------------------------------

const RATE_TIERS = [
  { windowSec: 10, limit: 3 },
  { windowSec: 30, limit: 10 },
  { windowSec: 60, limit: 20 },
] as const;

async function consumeChatQuota(
  redis: Redis,
  userId: string,
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  for (const { windowSec, limit } of RATE_TIERS) {
    // Bucket key rotates on window boundaries — good enough for fixed-window.
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const key = `chat:rate:${userId}:${windowSec}s:${bucket}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    if (count > limit) {
      // Next bucket starts at the next window boundary.
      const windowStartSec = bucket * windowSec;
      const retryAfterSeconds = windowSec - (Math.floor(Date.now() / 1000) - windowStartSec);
      return { limited: true, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
    }
  }
  return { limited: false, retryAfterSeconds: 0 };
}

// ---------------------------------------------------------------------------
// Chat server factory
// ---------------------------------------------------------------------------

export function createChatServer(
  httpServer: HTTPServer,
  prisma: PrismaClient,
  jwtSecret: string,
  corsOrigin: string | string[],
  logger: FastifyBaseLogger,
  redis: Redis,
  onChannelMessageCreated?: (payload: {
    messageId: string;
    channelId: string;
    groupId: string;
    userId: string;
    name: string;
    username: string | null;
    content: string;
  }) => Promise<void>
): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  });

  // ---- Auth middleware -------------------------------------------------
  io.use(async (socket, next) => {
    try {
      // Prefer HttpOnly cookie sent automatically by the browser; fall back to
      // the legacy auth.token field for backwards compatibility with older clients.
      let token = (socket.handshake.auth?.token ?? "") as string;
      if (!token) {
        const cookieHeader = socket.handshake.headers.cookie ?? "";
        const match = cookieHeader.match(/(?:^|;\s*)gem_token=([^;]+)/);
        token = match ? decodeURIComponent(match[1]) : "";
      }
      if (!token) return next(new Error("Authentication required"));

      const payload = verifyHS256JWT(token, jwtSecret);
      const userId = payload.sub as string;
      if (!userId) return next(new Error("Invalid token payload"));

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, username: true },
      });
      if (!user) return next(new Error("User not found"));

      socket.data.userId = userId;
      socket.data.user = user;
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  // ---- Connection handler ---------------------------------------------
  io.on("connection", (rawSocket) => {
    const socket = rawSocket as AuthedSocket;
    const { user } = socket.data;
    logger.info({ userId: user.id, socketId: socket.id }, "Socket connected");

    // -- join:channel ---------------------------------------------------
    socket.on("join:channel", async (data: unknown) => {
      const parsed = JoinChannelSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit("error", { code: "BAD_REQUEST", message: "channelId and groupId must be strings" });
        return;
      }
      const { channelId, groupId } = parsed.data;
      try {
        const membership = await prisma.membership.findUnique({
          where: { userId_groupId: { userId: user.id, groupId } },
        });
        if (!membership || membership.status !== "active") {
          socket.emit("error", { code: "FORBIDDEN", message: "Not an active group member" });
          return;
        }
        const channel = await prisma.channel.findFirst({
          where: { id: channelId, groupId },
        });
        if (!channel) {
          socket.emit("error", { code: "NOT_FOUND", message: "Channel not found" });
          return;
        }

        if (channel.isInviteOnly) {
          const subscription = await prisma.channelSubscription.findUnique({
            where: { userId_channelId: { userId: user.id, channelId } },
          });
          if (!subscription) {
            socket.emit("error", { code: "FORBIDDEN", message: "Not subscribed to this channel" });
            return;
          }
        }

        await socket.join(`channel:${channelId}`);
        socket.emit("joined:channel", { channelId });
        logger.info({ userId: user.id, channelId }, "Joined channel room");
      } catch (err) {
        logger.error(err, "join:channel error");
        socket.emit("error", { code: "INTERNAL", message: "Failed to join channel" });
      }
    });

    // -- leave:channel --------------------------------------------------
    socket.on("leave:channel", (data: unknown) => {
      const parsed = ChannelIdSchema.safeParse(data);
      if (!parsed.success) return;
      const channelId = parsed.data;
      socket.leave(`channel:${channelId}`);
      socket.emit("left:channel", { channelId });
    });

    // -- channel:message:send -------------------------------------------
    socket.on("channel:message:send", async (data: unknown) => {
      const parsed = SendMessageSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit("error", { code: "BAD_REQUEST", message: "Invalid channel message payload" });
        return;
      }
      const { channelId, content, replyToId } = parsed.data;
      const trimmed = content.trim();
      if (!trimmed) {
        socket.emit("error", { code: "BAD_REQUEST", message: "Message content is empty" });
        return;
      }
      if (!socket.rooms.has(`channel:${channelId}`)) {
        socket.emit("error", { code: "FORBIDDEN", message: "Join the channel room first" });
        return;
      }
      const quota = await consumeChatQuota(redis, user.id);
      if (quota.limited) {
        socket.emit("error", {
          code: "RATE_LIMITED",
          message: `Too many messages. Try again in ${quota.retryAfterSeconds}s`,
          retryAfterSeconds: quota.retryAfterSeconds,
        });
        return;
      }
      try {
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          select: { id: true, groupId: true },
        });
        if (!channel) {
          socket.emit("error", { code: "NOT_FOUND", message: "Channel not found" });
          return;
        }
        // Check mute status
        const muteMembership = await prisma.membership.findUnique({
          where: { userId_groupId: { userId: user.id, groupId: channel.groupId } },
          select: { mutedUntil: true },
        });
        if (muteMembership?.mutedUntil && muteMembership.mutedUntil > new Date()) {
          socket.emit("error", { code: "MUTED", message: "You are muted in this group" });
          return;
        }
        const message = await prisma.message.create({
          data: {
            channelId,
            userId: user.id,
            content: trimmed,
            ...(replyToId ? { replyToId } : {}),
          },
          include: {
            user: { select: { id: true, name: true, email: true, avatarUrl: true } },
            replyTo: { select: { id: true, content: true, user: { select: { id: true, name: true } } } },
          },
        });
        // Strip server-only fields before broadcast
        io.to(`channel:${channelId}`).emit("channel:message:new", {
          id: message.id,
          channelId: message.channelId,
          userId: message.userId,
          content: message.content,
          pinned: message.pinned,
          replyToId: message.replyToId,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
          user: {
            id: message.user.id,
            name: message.user.name,
            avatarUrl: message.user.avatarUrl ?? null,
          },
          replyTo: message.replyTo ?? null,
          reactions: [],
        });
        if (onChannelMessageCreated) {
          await onChannelMessageCreated({
            messageId: message.id,
            channelId,
            groupId: channel.groupId,
            userId: user.id,
            name: user.name,
            username: user.username ?? null,
            content: message.content,
          });
        }
      } catch (err) {
        logger.error(err, "channel:message:send error");
        socket.emit("error", { code: "INTERNAL", message: "Failed to persist channel message" });
      }
    });

    // -- channel:typing:start -------------------------------------------
    socket.on("channel:typing:start", (data: unknown) => {
      const parsed = ChannelIdSchema.safeParse(data);
      if (!parsed.success) return;
      const channelId = parsed.data;
      if (!socket.rooms.has(`channel:${channelId}`)) return;
      socket.to(`channel:${channelId}`).emit("channel:typing:start", {
        userId: user.id,
        name: user.name,
        channelId,
      });
    });

    // -- channel:typing:stop --------------------------------------------
    socket.on("channel:typing:stop", (data: unknown) => {
      const parsed = ChannelIdSchema.safeParse(data);
      if (!parsed.success) return;
      const channelId = parsed.data;
      if (!socket.rooms.has(`channel:${channelId}`)) return;
      socket.to(`channel:${channelId}`).emit("channel:typing:stop", {
        userId: user.id,
        channelId,
      });
    });

    // -- disconnect -----------------------------------------------------
    socket.on("disconnect", () => {
      logger.info({ userId: user.id, socketId: socket.id }, "Socket disconnected");
    });
  });

  return io;
}
