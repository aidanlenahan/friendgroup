import type { PrismaClient } from "../generated/prisma/index.js";
import { AppError } from "../lib/errors.js";

const ADMIN_ROLES = ["owner", "admin"] as const;

export async function requireGroupMembership(
  prisma: PrismaClient,
  userId: string,
  groupId: string
) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_groupId: {
        userId,
        groupId,
      },
    },
  });

  if (!membership) {
    throw new AppError(403, "Group membership required", "FORBIDDEN");
  }

  if (membership.status !== "active") {
    throw new AppError(403, "Your join request for this group has not been approved by the admins yet. Please try again later.", "MEMBERSHIP_PENDING");
  }

  return membership;
}

export function requireRole(
  role: string,
  allowed: readonly string[] = ADMIN_ROLES
) {
  if (!allowed.includes(role)) {
    throw new AppError(403, "Insufficient permissions", "FORBIDDEN");
  }
}

export async function canAccessEvent(
  prisma: PrismaClient,
  eventId: string,
  userId: string
) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      invites: true,
    },
  });

  if (!event) {
    throw new AppError(404, "Event not found", "NOT_FOUND");
  }

  const membership = await requireGroupMembership(prisma, userId, event.groupId);

  const isAdmin = ADMIN_ROLES.includes(membership.role as (typeof ADMIN_ROLES)[number]);
  const isCreator = event.createdById === userId;
  const hasInvite = event.invites.some((invite) => invite.userId === userId);
  const isInviteOnly = event.invites.length > 0;

  if (isInviteOnly && !isAdmin && !isCreator && !hasInvite) {
    throw new AppError(
      403,
      "This event is invite-only",
      "INVITE_ONLY_FORBIDDEN"
    );
  }

  return {
    event,
    membership,
    isAdmin,
    isCreator,
    hasInvite,
    isInviteOnly,
  };
}
