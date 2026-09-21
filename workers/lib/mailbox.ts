// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hono middleware to handle repetitive Mailbox Durable Object instantiation.
 * Checks if the mailbox exists in R2, then instantiates the DO stub
 * and attaches it to the Hono context (`c.var.mailboxStub`).
 */
import { createMiddleware } from "hono/factory";
import type { Email } from "~/types";
import type { MailboxDO } from "../durableObject";
import type { Env } from "../types";

export type MailboxStub = DurableObjectStub<MailboxDO>;

export type MailboxContext = {
  Bindings: Env;
  Variables: {
    mailboxStub: MailboxStub;
  };
};

export interface SearchFilters {
  query: string;
  folder?: string;
  from?: string;
  to?: string;
  subject?: string;
  date_start?: string;
  date_end?: string;
  is_read?: boolean;
  is_starred?: boolean;
  has_attachment?: boolean;
}

/**
 * Durable Object methods the RPC stub type cannot express -- they read off raw
 * `sql.exec` rows. Declared separately and reached through `rawOps()` rather
 * than intersected into `MailboxStub`, which would make the stub's mapped type
 * too deep for the compiler. Mirrors `threadOps` in `app/lib/mailbox.server.ts`.
 */
export interface MailboxRawOps {
  getThreadedEmails(options: { folder: string; page?: number; limit?: number }): Promise<Email[]>;
  countThreadedEmails(folder: string): Promise<number>;
  getThreadEmails(threadId: string): Promise<Email[]>;
  searchEmails(options: SearchFilters & { page?: number; limit?: number }): Promise<Email[]>;
  countSearchResults(options: SearchFilters): Promise<number>;
  checkSendRateLimit(): Promise<string | null>;
}

export function rawOps(stub: MailboxStub): MailboxRawOps {
  return stub as unknown as MailboxRawOps;
}

/**
 * Narrow a Drizzle row to the DTO the UI consumes. The columns are nullable in
 * SQLite but always populated by `createEmail`, so the API is the boundary
 * where they become `Email`.
 */
export function toEmail<T>(row: T): T extends null ? null : Email {
  return row as T extends null ? null : Email;
}

export function toEmails(rows: unknown[]): Email[] {
  return rows as Email[];
}

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
  const rawId = c.req.param("mailboxId");
  if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);
  const mailboxId = decodeURIComponent(rawId);

  // Verify mailbox exists
  const key = `mailboxes/${mailboxId}.json`;
  const obj = await c.env.BUCKET.head(key);
  if (!obj) {
    return c.json({ error: "Not found" }, 404);
  }

  // Instantiate DO stub
  const ns = c.env.MAILBOX;
  const id = ns.idFromName(mailboxId);
  const stub = ns.get(id);

  c.set("mailboxStub", stub);

  await next();
});
