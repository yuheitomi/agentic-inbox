// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hono middleware to handle repetitive Mailbox Durable Object instantiation.
 * Checks if the mailbox exists in R2, then instantiates the DO stub
 * and attaches it to the Hono context (`c.var.mailboxStub`).
 */
import { createMiddleware } from "hono/factory";
import { type TimingVariables, wrapTime } from "hono/timing";
import type { Email } from "~/types";
import type { MailboxDO } from "../durableObject";
import type { Env } from "../types";

export type MailboxStub = DurableObjectStub<MailboxDO>;

export type MailboxContext = {
  Bindings: Env;
  Variables: TimingVariables & {
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

// -- Mailbox existence cache ------------------------------------------
//
// Every mailbox API call checks that the mailbox record exists in R2, and that
// HEAD costs ~50ms -- most of an email open's server time. Mailboxes are only
// created and deleted by hand, so this isolate remembers the ones it has seen
// exist for a few minutes.
//
// Only positive answers are kept, so a new mailbox is visible at once. A
// deleted one is forgotten here immediately but may pass the check in other
// isolates until its entry expires; the Durable Object behind it then answers
// with whatever it still holds, which the route already allowed a moment ago.

const MAILBOX_EXISTS_TTL_MS = 5 * 60 * 1000;
const MAX_KNOWN_MAILBOXES = 1000;

/** R2 key of a mailbox record -> when this isolate stops trusting it. */
const knownMailboxes = new Map<string, number>();

function mailboxKey(mailboxId: string) {
  return `mailboxes/${mailboxId}.json`;
}

async function mailboxExists(bucket: R2Bucket, mailboxId: string): Promise<boolean> {
  const key = mailboxKey(mailboxId);
  const expiresAt = knownMailboxes.get(key);
  if (expiresAt !== undefined && expiresAt > Date.now()) return true;

  const exists = (await bucket.head(key)) !== null;
  knownMailboxes.delete(key);
  if (exists) {
    // Maps iterate in insertion order, so the first key is the oldest entry.
    if (knownMailboxes.size >= MAX_KNOWN_MAILBOXES) {
      const oldest = knownMailboxes.keys().next().value;
      if (oldest !== undefined) knownMailboxes.delete(oldest);
    }
    knownMailboxes.set(key, Date.now() + MAILBOX_EXISTS_TTL_MS);
  }
  return exists;
}

/** Drop a mailbox from this isolate's existence cache once its record is deleted. */
export function forgetMailbox(mailboxId: string) {
  knownMailboxes.delete(mailboxKey(mailboxId));
}

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
  const rawId = c.req.param("mailboxId");
  if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);
  const mailboxId = decodeURIComponent(rawId);

  // TEMP (latency measurement): reported as `r2`, ~0 on a cache hit.
  if (!(await wrapTime(c, "r2", mailboxExists(c.env.BUCKET, mailboxId)))) {
    return c.json({ error: "Not found" }, 404);
  }

  // Instantiate DO stub
  const ns = c.env.MAILBOX;
  const id = ns.idFromName(mailboxId);
  const stub = ns.get(id);

  c.set("mailboxStub", stub);

  await next();
});
