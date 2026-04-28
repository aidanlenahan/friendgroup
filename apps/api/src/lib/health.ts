import { PrismaClient } from "../generated/prisma/index.js";
import { Redis } from "ioredis";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";

export interface HealthStatus {
  status: "ok" | "degraded" | "unhealthy";
  message?: string;
  timestamp: string;
}

/**
 * Check database connectivity and basic query.
 */
export async function checkDatabase(prisma: PrismaClient): Promise<HealthStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", timestamp: new Date().toISOString() };
  } catch (error) {
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Unknown database error",
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Check Redis connectivity.
 */
export async function checkRedis(redis: Redis): Promise<HealthStatus> {
  try {
    const pong = await redis.ping();
    if (pong === "PONG") {
      return { status: "ok", timestamp: new Date().toISOString() };
    }
    return {
      status: "unhealthy",
      message: `Unexpected PING response: ${pong}`,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Unknown Redis error",
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Check S3-compatible storage (MinIO) connectivity.
 */
export async function checkStorage(s3: S3Client): Promise<HealthStatus> {
  try {
    const bucket = process.env.S3_BUCKET || "gem-media";
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return { status: "ok", timestamp: new Date().toISOString() };
  } catch (error) {
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Unknown storage error",
      timestamp: new Date().toISOString(),
    };
  }
}
