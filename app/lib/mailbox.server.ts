// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Server-only helpers for route loaders and actions.
 *
 * Loaders run in the same Worker isolate that holds the `MAILBOX` binding, so
 * they talk to the Durable Object directly instead of going back out over HTTP
 * through `/api/v1/*`. That removes a full network round trip per read.
 *
 * The `.server.ts` suffix keeps this module (and the DO types it imports) out
 * of the client bundle.
 */

import { data, type RouterContextProvider } from "react-router";
import { cloudflareContext } from "~/context";
import type { Email, MailboxSettings } from "~/types";
import type { MailboxDO } from "../../workers/durableObject";
import type { Env } from "../../workers/types";

export type MailboxStub = DurableObjectStub<MailboxDO>;

/**
 * Durable Object methods whose return types the RPC stub cannot express --
 * they come off raw `sql.exec` rows. Kept as a separate interface and reached
 * through `threadOps` rather than intersected into `MailboxStub`, which makes
 * the stub's mapped type too deep for the compiler. Mirrors the casts already
 * used in `workers/lib/tools.ts`.
 */
export interface MailboxThreadStub {
  getThreadedEmails: (options: {
    folder: string;
    page?: number;
    limit?: number;
  }) => Promise<Email[]>;
  countThreadedEmails: (folder: string) => Promise<number>;
  getThreadEmails: (threadId: string) => Promise<Email[]>;
}

export function threadOps(stub: MailboxStub): MailboxThreadStub {
  return stub as unknown as MailboxThreadStub;
}

export function getEnv(context: Readonly<RouterContextProvider>): Env {
  return context.get(cloudflareContext).env;
}

/**
 * Resolve a mailbox's DO stub, throwing a 404 response if the mailbox has no
 * R2 registry entry. `idFromName` would otherwise happily conjure an empty
 * Durable Object for any string.
 */
export async function requireMailboxStub(
  context: Readonly<RouterContextProvider>,
  mailboxId: string,
): Promise<MailboxStub> {
  const env = getEnv(context);
  if (!(await env.BUCKET.head(`mailboxes/${mailboxId}.json`))) {
    throw data({ error: "Mailbox not found" }, { status: 404 });
  }
  return env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId)) as MailboxStub;
}

/** Load a mailbox's settings from R2 alongside its DO stub. */
export async function requireMailbox(
  context: Readonly<RouterContextProvider>,
  mailboxId: string,
): Promise<{ stub: MailboxStub; settings: MailboxSettings }> {
  const env = getEnv(context);
  const obj = await env.BUCKET.get(`mailboxes/${mailboxId}.json`);
  if (!obj) {
    throw data({ error: "Mailbox not found" }, { status: 404 });
  }
  const settings = await obj.json<MailboxSettings>();
  const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId)) as MailboxStub;
  return { stub, settings };
}

/** Delete an email and clean up its attachment blobs in R2. */
export async function deleteEmailWithAttachments(
  context: Readonly<RouterContextProvider>,
  stub: MailboxStub,
  emailId: string,
): Promise<boolean> {
  const attachments = await stub.deleteEmail(emailId);
  if (attachments === null) return false;
  if (attachments.length > 0) {
    const env = getEnv(context);
    await env.BUCKET.delete(
      attachments.map((att) => `attachments/${emailId}/${att.id}/${att.filename}`),
    );
  }
  return true;
}
