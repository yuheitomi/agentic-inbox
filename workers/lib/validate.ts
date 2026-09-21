// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Zod-backed Hono validators.
 *
 * Registering a validator is what makes a route's request body and query
 * string visible to the RPC client: `hc<AppType>` reads the validated input
 * type off the route, so `$post({ json })` and `$get({ query })` are checked
 * against the schema rather than accepting anything.
 *
 * They also turn malformed input into a 400 instead of the 500 a bare
 * `schema.parse()` throw produced.
 *
 * Built on `hono/validator` rather than `@hono/zod-validator` to avoid a
 * dependency for ~20 lines.
 */

import type { Context } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import type { MailboxContext } from "./mailbox";

export function zJson<T extends z.ZodType>(schema: T) {
  return validator("json", (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) return c.json({ error: z.prettifyError(result.error) }, 400);
    return result.data as z.output<T>;
  });
}

export function zQuery<T extends z.ZodType>(schema: T) {
  return validator("query", (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) return c.json({ error: z.prettifyError(result.error) }, 400);
    return result.data as z.output<T>;
  });
}

/**
 * Query params arrive as strings. These keep the *input* side of the schema a
 * string union so the RPC client's `query` argument stays honest about what
 * goes over the wire, while handlers read the coerced value.
 */
export const numericParamSchema = z
  .string()
  .regex(/^\d+$/, "must be a non-negative integer")
  .transform(Number)
  .optional();

export const boolParamSchema = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1")
  .optional();

/** Handler context for a route whose JSON body was validated to `T`. */
export type JsonContext<T> = Context<MailboxContext, string, { in: { json: T }; out: { json: T } }>;
