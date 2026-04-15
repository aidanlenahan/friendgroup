import { createHmac } from "crypto";
import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import type { PrismaClient } from "../generated/prisma/index.js";
import type { FastifyBaseLogger } from "fastify";

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
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SocketUser {
  id: string;
  name: string;
  email: string;
}

interface AuthedSocket extends Socket {
  data: {
    userId: string;
    user: SocketUser;
  };
}

type ChatRateWindow = {
  windowStartMs: number;
  count: number;
};

const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;
const CHAT_MESSAGES_PER_MINUTE = Math.max(
  1,
  Number(process.env.CHAT_MESSAGE_RATE_LIMIT_PER_MINUTE || 30)
);
const chatRateWindows = new Map<string, ChatRateWindow>();

function consumeChatQuota(userId: string) {
  const now = Date.now();
  const current = chatRateWindows.get(userId);

  if (!current || now - current.windowStartMs >= CHAT_RATE_LIMIT_WINDOW_MS) {
    chatRateWindows.set(userId, {
      windowStartMs: now,
      count: 1,
    });
    return { limited: false, retryAfterSeconds: 0 };
  }

  if (current.count >= CHAT_MESSAGES_PER_MINUTE) {
    const retryAfterMs = CHAT_RATE_LIMIT_WINDOW_MS - (now - current.windowStartMs);
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  current.count += 1;
  return { limited: false, retryAfterSeconds: 0 };
}

// ---------------------------------------------------------------------------
// Chat server factory
// ---------------------------------------------------------------------------

export function createChatServer(
  httpServer: HTTPServer,
  prisma: PrismaClient,
  jwtSecret: string,
  corsOrigin: string | boolean,
  logger: FastifyBaseLogger,
  onMessageCreated?: (payload: {
    messageId: string;
    eventId: string;
    userId: string;
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
      const token = (socket.handshake.auth?.token ?? "") as string;
      if (!token) return next(new Error("Authentication required"));

      const payload = verifyHS256JWT(token, jwtSecret);
      const userId = payload.sub as string;
      if (!userId) return next(new Error("Invalid token payload"));

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
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

    // -- join:event -----------------------------------------------------
    socket.on("join:event", async (eventId: unknown) => {
      if (typeof eventId !== "string") {
        socket.emit("error", { code: "BAD_REQUEST", message: "eventId must be a string" });
        return;
      }
      try {
        const event = await prisma.event.findUnique({
          where: { id: eventId },
          include: { invites: true },
        });
        if (!event) {
          socket.emit("error", { code: "NOT_FOUND", message: "Event not found" });
          return;
        }

        const membership = await prisma.membership.findUnique({
          where: { userId_groupId: { userId: user.id, groupId: event.groupId } },
        });
        if (!membership) {
          socket.emit("error", { code: "FORBIDDEN", message: "Not a group member" });
          return;
        }

        const isAdmin = ["owner", "admin"].includes(membership.role);
        const isCreator = event.createdById === user.id;
        const isInvited = event.invites.some((i) => i.userId === user.id);

        if (event.invites.length > 0 && !isAdmin && !isCreator && !isInvited) {
          socket.emit("error", { code: "FORBIDDEN", message: "Not invited to this event" });
          return;
        }

        await socket.join(`event:${eventId}`);
        socket.emit("joined:event", { eventId });
        logger.info({ userId: user.id, eventId }, "Joined event room");
      } catch (err) {
        logger.error(err, "join:event error");
        socket.emit("error", { code: "INTERNAL", message: "Failed to join room" });
      }
    });

    // -- leave:event ----------------------------------------------------
    socket.on("leave:event", (eventId: unknown) => {
      if (typeof eventId !== "string") return;
      socket.leave(`event:${eventId}`);
      socket.emit("left:event", { eventId });
    });

    // -- message:send ---------------------------------------------------
    socket.on("message:send", async (data: unknown) => {
      if (
        typeof data !== "object" ||
        data === null ||
        typeof (data as Record<string, unknown>).eventId !== "string" ||
        typeof (data as Record<string, unknown>).content !== "string"
      ) {
        socket.emit("error", { code: "BAD_REQUEST", message: "Invalid message payload" });
        return;
      }

      const { eventId, content } = data as { eventId: string; content: string };
      const trimmed = content.trim().slice(0, 4000);

      if (!trimmed) {
        socket.emit("error", { code: "BAD_REQUEST", message: "Message content is empty" });
        return;
      }

      if (!socket.rooms.has(`event:${eventId}`)) {
        socket.emit("error", { code: "FORBIDDEN", message: "Join the event room first" });
        return;
      }

      const quota = consumeChatQuota(user.id);
      if (quota.limited) {
        logger.warn(
          { userId: user.id, eventId },
          "Socket message rate limit exceeded"
        );
        socket.emit("error", {
          code: "RATE_LIMITED",
          message: `Too many messages. Try again in ${quota.retryAfterSeconds}s`,
          retryAfterSeconds: quota.retryAfterSeconds,
        });
        return;
      }

      try {
        const message = await prisma.message.create({
          data: {
            eventId,
            userId: user.id,
            content: trimmed,
          },
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        });

        io.to(`event:${eventId}`).emit("message:new", message);

        if (onMessageCreated) {
          await onMessageCreated({
            messageId: message.id,
            eventId,
            userId: user.id,
            content: message.content,
          });
        }
      } catch (err) {
        logger.error(err, "message:send error");
        socket.emit("error", { code: "INTERNAL", message: "Failed to persist message" });
      }
    });

    // -- typing:start ---------------------------------------------------
    socket.on("typing:start", (eventId: unknown) => {
      if (typeof eventId !== "string") return;
      if (!socket.rooms.has(`event:${eventId}`)) return;
      socket.to(`event:${eventId}`).emit("typing:start", {
        userId: user.id,
        name: user.name,
        eventId,
      });
    });

    // -- typing:stop ----------------------------------------------------
    socket.on("typing:stop", (eventId: unknown) => {
      if (typeof eventId !== "string") return;
      if (!socket.rooms.has(`event:${eventId}`)) return;
      socket.to(`event:${eventId}`).emit("typing:stop", {
        userId: user.id,
        eventId,
      });
    });

    // -- disconnect -----------------------------------------------------
    socket.on("disconnect", () => {
      logger.info({ userId: user.id, socketId: socket.id }, "Socket disconnected");
    });
  });

  return io;
}
