import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { validateRequest } from "../lib/validation.js";

describe("validation helpers", () => {
  it("parses valid payloads", async () => {
    const result = await validateRequest(
      z.object({ email: z.string().email(), count: z.number().int() }),
      { email: "owner@friendgroup.dev", count: 2 }
    );

    expect(result).toEqual({ email: "owner@friendgroup.dev", count: 2 });
  });

  it("rethrows zod validation errors for the global handler", async () => {
    await expect(
      validateRequest(z.object({ email: z.string().email() }), {
        email: "not-an-email",
      })
    ).rejects.toBeInstanceOf(ZodError);
  });
});