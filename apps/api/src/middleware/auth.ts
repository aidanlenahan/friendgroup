import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../generated/prisma/index.js";
import { AppError } from "../lib/errors.js";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
};

type JwtPayload = {
  sub?: string;
  email?: string;
};

export async function requireAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
  prisma: PrismaClient
): Promise<CurrentUser> {
  await request.jwtVerify();

  const payload = request.user as JwtPayload;
  if (!payload.sub) {
    throw new AppError(401, "Invalid token payload", "UNAUTHORIZED");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    throw new AppError(401, "User not found for token", "UNAUTHORIZED");
  }

  (request as FastifyRequest & { currentUser: CurrentUser }).currentUser = user;
  return user;
}

export function getCurrentUser(request: FastifyRequest): CurrentUser {
  const req = request as FastifyRequest & { currentUser?: CurrentUser };
  if (!req.currentUser) {
    throw new AppError(401, "Authentication required", "UNAUTHORIZED");
  }
  return req.currentUser;
}
