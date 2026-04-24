import { FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errorHandler = async (
  error: Error,
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const logger = request.server.log;

  if (error instanceof AppError) {
    logger.warn(
      { statusCode: error.statusCode, code: error.code, message: error.message },
      "App error"
    );
    return reply.status(error.statusCode).send({
      error: error.message,
      code: error.code || "UNKNOWN_ERROR",
    });
  }

  if (error instanceof ZodError) {
    logger.warn({ issues: error.issues }, "Validation error");
    return reply.status(400).send({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const fastifyError = error as Error & {
    statusCode?: number;
    code?: string;
  };

  if (fastifyError.statusCode && fastifyError.statusCode >= 400) {
    logger.warn(
      {
        statusCode: fastifyError.statusCode,
        code: fastifyError.code,
        message: fastifyError.message,
      },
      "Fastify handled error"
    );
    return reply.status(fastifyError.statusCode).send({
      error: fastifyError.message,
      code: fastifyError.code || "REQUEST_ERROR",
    });
  }

  // Unhandled error
  logger.error({ error }, "Unhandled error");
  return reply.status(500).send({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
  });
};
