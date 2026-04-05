import { z } from "zod";
import { AppError } from "./errors.js";

/**
 * Parse and validate request body with Zod schema.
 * Throws AppError on validation failure.
 */
export async function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): Promise<T> {
  try {
    return await schema.parseAsync(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw error; // Re-throw for error handler
    }
    throw new AppError(400, "Validation error");
  }
}

/**
 * Common Zod schemas for API endpoints
 */
export const schemas = {
  // IDs
  id: z.string().cuid("Invalid ID format"),

  // User
  email: z.string().email("Invalid email"),
  name: z.string().min(1).max(255),

  // Event
  title: z.string().min(1).max(255),
  details: z.string().max(5000).optional(),
  dateTime: z.string().datetime(),
  rating: z.number().min(1).max(10).optional(),

  // RSVP
  rsvpStatus: z.enum(["yes", "no", "maybe"]),

  // Message
  content: z.string().min(1).max(10000),

  // Role
  role: z.enum(["owner", "admin", "member"]),
};
