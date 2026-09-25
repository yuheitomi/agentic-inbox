// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Loaders and actions shared by the routes that show a mailbox's mail.
 *
 * The reading pane appears under both the folder list and the search results,
 * so its loader and its mutations live here rather than in either route. The
 * outgoing-message builder is here too: the sender address is always derived
 * from the mailbox record on the server, never taken from the form.
 */

import { data, redirect } from "react-router";
import { htmlToPlainText, splitEmailList, toEmailListValue } from "~/lib/utils";
import type { Mailbox } from "~/types";
import { type ActionResult, field, ok, redirectTarget, result, type RpcClient } from "./api.server";
import { type CallTiming, serverTimingHeader, timed } from "./timing.server";

// ── Reading pane ───────────────────────────────────────────────────

/**
 * An email and every message in its thread, bodies and attachments included,
 * in two in-process calls. A missing email answers 404, which `ok` rethrows as
 * the error boundary's response.
 */
export async function loadEmailDetail(api: RpcClient, mailboxId: string, emailId: string) {
  const mailbox = api.mailboxes[":mailboxId"];
  // TEMP (latency measurement): each call is timed and the breakdown is
  // logged and sent to the browser as `Server-Timing`.
  const timings: CallTiming[] = [];
  const start = performance.now();

  const email = await ok(
    timed(timings, "email", () =>
      mailbox.emails[":id"].$get({ param: { mailboxId, id: emailId } }),
    ),
  );
  const threadId = email.thread_id;
  const thread = threadId
    ? await ok(
        timed(timings, "thread", () =>
          mailbox.threads[":threadId"].$get({ param: { mailboxId, threadId } }),
        ),
      )
    : [];

  const totalMs = performance.now() - start;
  console.log(
    JSON.stringify({ kind: "emailDetail", totalMs, threadSize: thread.length, calls: timings }),
  );
  return data(
    { email, thread },
    { headers: { "Server-Timing": serverTimingHeader(timings, totalMs) } },
  );
}

/**
 * Every per-email mutation: star, read state, move, delete, and sending or
 * discarding a draft. `emailId` in the form targets another message of the
 * open thread (a draft reply, say); it defaults to the route's email.
 *
 * Mutations that take the email out of view (move, delete, sending a draft
 * from the drafts folder) carry a `redirectTo` so the pane closes on success.
 */
export async function emailAction(
  api: RpcClient,
  mailboxId: string,
  routeEmailId: string,
  form: FormData,
): Promise<ActionResult | Response> {
  const intent = field(form, "intent");
  const id = field(form, "emailId") || routeEmailId;
  const param = { mailboxId, id };
  const email = api.mailboxes[":mailboxId"].emails[":id"];
  const redirectTo = redirectTarget(form);
  const thenRedirect = (outcome: ActionResult) =>
    outcome.ok && redirectTo ? redirect(redirectTo) : outcome;

  switch (intent) {
    case "star":
      return result(
        email.$put({ param, json: { starred: field(form, "starred") === "true" } }),
        "Failed to update email",
      );

    case "read":
      return result(
        email.$put({ param, json: { read: field(form, "read") === "true" } }),
        "Failed to update email",
      );

    case "markThreadRead": {
      const threadId = field(form, "threadId");
      return threadId
        ? result(
            api.mailboxes[":mailboxId"].threads[":threadId"].read.$post({
              param: { mailboxId, threadId },
            }),
            "Failed to mark thread read",
          )
        : result(email.$put({ param, json: { read: true } }), "Failed to mark email read");
    }

    case "move":
      return thenRedirect(
        await result(
          email.move.$post({ param, json: { folderId: field(form, "folderId") } }),
          "Failed to move email",
        ),
      );

    // The API deletes the email's attachment blobs from R2 along with it.
    case "delete":
    case "discardDraft":
      return thenRedirect(await result(email.$delete({ param }), "Failed to delete email"));

    case "sendDraft":
      return thenRedirect(await sendDraft(api, mailboxId, id));

    default:
      return { ok: false, error: `Unknown intent: ${intent}` };
  }
}

/** Send a stored draft as it is, as a reply when it answers a message, then delete it. */
async function sendDraft(api: RpcClient, mailboxId: string, id: string): Promise<ActionResult> {
  const mailboxApi = api.mailboxes[":mailboxId"];
  const [mailbox, draftRes] = await Promise.all([
    ok(mailboxApi.$get({ param: { mailboxId } })),
    mailboxApi.emails[":id"].$get({ param: { mailboxId, id } }),
  ]);
  if (!draftRes.ok) return { ok: false, error: "Draft not found" };
  const draft = await draftRes.json();

  // A draft that answers a message is sent as a reply so it threads, unless
  // that message has since been deleted.
  let originalId: string | undefined;
  if (draft.in_reply_to) {
    const originalRes = await mailboxApi.emails[":id"].$get({
      param: { mailboxId, id: draft.in_reply_to },
    });
    if (originalRes.ok) originalId = draft.in_reply_to;
  }

  const sent = await sendMessage(api, mailbox, {
    mode: originalId ? "reply" : "new",
    originalId,
    to: draft.recipient,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject || "(no subject)",
    html: draft.body || "",
  });
  if (!sent.ok) return sent;

  return result(
    mailboxApi.emails[":id"].$delete({ param: { mailboxId, id } }),
    "Email sent, but the draft could not be removed",
  );
}

// ── Sending ────────────────────────────────────────────────────────

export interface OutgoingMessage {
  mode: "new" | "reply" | "forward";
  /** The message a reply answers or a forward quotes. */
  originalId?: string;
  /** Comma-separated address lists, as the form and stored drafts hold them. */
  to: string;
  cc?: string | null;
  bcc?: string | null;
  subject: string;
  html: string;
}

/** `name <address>` when the mailbox has a display name, else the bare address. */
function senderFor(mailbox: Mailbox) {
  const name = mailbox.settings?.fromName || mailbox.name;
  return name && name !== mailbox.email ? { email: mailbox.email, name } : mailbox.email;
}

/** Send `message` from `mailbox`, through the reply or forward endpoint when it has an original. */
export async function sendMessage(
  api: RpcClient,
  mailbox: Mailbox,
  message: OutgoingMessage,
): Promise<ActionResult> {
  const to = toEmailListValue(splitEmailList(message.to));
  if (to === undefined) return { ok: false, error: "Add at least one recipient." };

  const json = {
    to,
    cc: toEmailListValue(splitEmailList(message.cc)),
    bcc: toEmailListValue(splitEmailList(message.bcc)),
    from: senderFor(mailbox),
    subject: message.subject,
    html: message.html,
    text: htmlToPlainText(message.html),
  };
  const emails = api.mailboxes[":mailboxId"].emails;
  const mailboxId = mailbox.id;

  if (message.mode !== "new" && message.originalId) {
    const param = { mailboxId, id: message.originalId };
    const endpoint = message.mode === "reply" ? emails[":id"].reply : emails[":id"].forward;
    return result(endpoint.$post({ param, json }), "Failed to send email");
  }
  return result(emails.$post({ param: { mailboxId }, json }), "Failed to send email");
}
