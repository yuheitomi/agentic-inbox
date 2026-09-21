// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
import { z } from "zod";
import type { Email, Folder, Mailbox } from "~/types";
import { Folders } from "../shared/folders";
import { sendEmail } from "./email-sender";
import { storeAttachments, type StoredAttachment } from "./lib/attachments";
import {
  validateSender,
  SenderValidationError,
  generateMessageId,
  buildThreadingHeaders,
  listMailboxes,
} from "./lib/email-helpers";
import { rawOps, requireMailbox, toEmail, toEmails, type MailboxContext } from "./lib/mailbox";
import { MailboxSettingsSchema, SendEmailRequestSchema } from "./lib/schemas";
import { boolParam, numericParam, zJson, zQuery } from "./lib/validate";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import type { Env } from "./types";

// -- Request schemas ------------------------------------------------
//
// Every body and query string is validated. Besides rejecting bad input with
// a 400, registering a validator is what lets `hc<AppType>` type the request
// side of each call in `app/services/api.ts`.

const CreateMailboxBody = z.object({
  email: z.email(),
  name: z.string().min(1),
  settings: MailboxSettingsSchema.optional(),
});

const UpdateMailboxBody = z.object({
  settings: MailboxSettingsSchema,
});

const DraftBody = z.object({
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().optional(),
  body: z.string(),
  in_reply_to: z.string().optional(),
  thread_id: z.string().optional(),
  draft_id: z.string().optional(),
});

const UpdateEmailBody = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
});

const MoveEmailBody = z.object({
  folderId: z.string().min(1),
});

const FolderBody = z.object({
  name: z.string().min(1),
});

const ListEmailsQuery = z.object({
  folder: z.string().optional(),
  thread_id: z.string().optional(),
  threaded: boolParam,
  page: numericParam,
  limit: numericParam,
  sortColumn: z
    .enum(["id", "subject", "sender", "recipient", "date", "read", "starred"])
    .optional(),
  sortDirection: z.enum(["ASC", "DESC"]).optional(),
});

const SearchQuery = z.object({
  query: z.string().optional(),
  folder: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  date_start: z.string().optional(),
  date_end: z.string().optional(),
  is_read: boolParam,
  is_starred: boolParam,
  has_attachment: boolParam,
  page: numericParam,
  limit: numericParam,
});

// -- Response shapes ------------------------------------------------

interface EmailListResponse {
  emails: Email[];
  totalCount: number;
}

// -- Helpers --------------------------------------------------------

function slugify(text: string) {
  // can return "" for non-alphanumeric input
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      // Same-origin requests have no Origin header — allow them.
      if (!origin) return origin;
      // In development, allow localhost for Vite dev server.
      try {
        const url = new URL(origin);
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
      } catch {
        /* invalid origin */
      }
      // Block all other cross-origin requests. The app is served from the
      // same origin as the API, so legitimate browser requests never send
      // an Origin header. Returning undefined omits Access-Control-Allow-Origin.
      return undefined;
    },
  }),
);
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

/**
 * The route table, declared as one chain.
 *
 * The chaining is load-bearing: Hono accumulates each route's path, validated
 * input and response type into the app's type parameter, and only a chained
 * definition carries that forward. `AppType` below is what `hc<AppType>()`
 * reads to type the client end to end.
 */
const routes = app

  // -- Config -------------------------------------------------------

  .get("/api/v1/config", (c) => {
    const domainsRaw = c.env.DOMAINS || "";
    const domains = domainsRaw
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    // Typed as an empty tuple when wrangler.jsonc declares no addresses.
    const emailAddresses = (c.env.EMAIL_ADDRESSES ?? []) as string[];
    return c.json({ domains, emailAddresses });
  })

  // -- Mailboxes ----------------------------------------------------

  .get("/api/v1/mailboxes", async (c) => {
    const allMailboxes = await listMailboxes(c.env.BUCKET);
    const result: Mailbox[] = allMailboxes.map((m) => ({ ...m, name: m.id }));
    return c.json(result);
  })

  .post("/api/v1/mailboxes", zJson(CreateMailboxBody), async (c) => {
    const { name, settings, email: rawEmail } = c.req.valid("json");
    const email = rawEmail.toLowerCase();
    const allowedAddresses = (c.env.EMAIL_ADDRESSES ?? []) as string[];
    if (
      allowedAddresses.length > 0 &&
      !allowedAddresses.map((a) => a.toLowerCase()).includes(email)
    ) {
      return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
    }
    const key = `mailboxes/${email}.json`;
    if (await c.env.BUCKET.head(key)) return c.json({ error: "Mailbox already exists" }, 409);
    const defaultSettings = {
      fromName: name,
      forwarding: { enabled: false, email: "" },
      signature: { enabled: false, text: "" },
      autoReply: { enabled: false, subject: "", message: "" },
    };
    const finalSettings = { ...defaultSettings, ...settings };
    await c.env.BUCKET.put(key, JSON.stringify(finalSettings));
    const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));
    await stub.getFolders();
    const mailbox: Mailbox = { id: email, email, name, settings: finalSettings };
    return c.json(mailbox, 201);
  })

  .get("/api/v1/mailboxes/:mailboxId", async (c) => {
    const mailboxId = c.req.param("mailboxId");
    const obj = await c.env.BUCKET.get(`mailboxes/${mailboxId}.json`);
    if (!obj) return c.json({ error: "Not found" }, 404);
    const mailbox: Mailbox = {
      id: mailboxId,
      name: mailboxId,
      email: mailboxId,
      settings: await obj.json(),
    };
    return c.json(mailbox);
  })

  .put("/api/v1/mailboxes/:mailboxId", zJson(UpdateMailboxBody), async (c) => {
    const mailboxId = c.req.param("mailboxId");
    const { settings } = c.req.valid("json");
    const key = `mailboxes/${mailboxId}.json`;
    if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
    await c.env.BUCKET.put(key, JSON.stringify(settings));
    const mailbox: Mailbox = { id: mailboxId, name: mailboxId, email: mailboxId, settings };
    return c.json(mailbox);
  })

  .delete("/api/v1/mailboxes/:mailboxId", async (c) => {
    const mailboxId = c.req.param("mailboxId");
    const key = `mailboxes/${mailboxId}.json`;
    if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
    await c.env.BUCKET.delete(key); // TODO: also delete DO data and R2 attachment blobs
    return c.body(null, 204);
  })

  // -- Emails -------------------------------------------------------

  .get("/api/v1/mailboxes/:mailboxId/emails", zQuery(ListEmailsQuery), async (c) => {
    const { folder, thread_id, threaded, page, limit, sortColumn, sortDirection } =
      c.req.valid("query");
    const stub = c.var.mailboxStub;

    // Both queries hit the same Durable Object; issuing them together lets the
    // DO pipeline them rather than paying two sequential RPC round trips.
    if (threaded && folder) {
      const threads = rawOps(stub);
      const [emails, totalCount] = await Promise.all([
        threads.getThreadedEmails({ folder, page, limit }),
        threads.countThreadedEmails(folder),
      ]);
      return c.json({ emails, totalCount } satisfies EmailListResponse);
    }

    const [rows, totalCount] = await Promise.all([
      stub.getEmails({ folder, thread_id, page, limit, sortColumn, sortDirection }),
      stub.countEmails({ folder, thread_id }),
    ]);
    return c.json({ emails: toEmails(rows), totalCount } satisfies EmailListResponse);
  })

  .post("/api/v1/mailboxes/:mailboxId/emails", zJson(SendEmailRequestSchema), async (c) => {
    const mailboxId = c.req.param("mailboxId");
    const {
      to,
      cc,
      bcc,
      from,
      subject,
      html,
      text,
      attachments,
      in_reply_to,
      references,
      thread_id,
    } = c.req.valid("json");

    let toStr: string, fromEmail: string, fromDomain: string;
    try {
      ({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
    } catch (e) {
      if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
      throw e;
    }

    const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
    const stub = c.var.mailboxStub;
    const rateLimitError = await rawOps(stub).checkSendRateLimit();
    if (rateLimitError) return c.json({ error: rateLimitError }, 429);
    const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

    await stub.createEmail(
      Folders.SENT,
      {
        id: messageId,
        subject,
        sender: fromEmail,
        recipient: toStr,
        cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
        bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
        date: new Date().toISOString(),
        body: html || text || "",
        in_reply_to: in_reply_to || null,
        email_references: references ? JSON.stringify(references) : null,
        thread_id: thread_id || in_reply_to || messageId,
        message_id: outgoingMessageId,
        raw_headers: JSON.stringify([
          { key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
          { key: "to", value: Array.isArray(to) ? to.join(", ") : to },
          ...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
          ...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
          { key: "subject", value: subject },
          { key: "date", value: new Date().toISOString() },
          { key: "message-id", value: `<${outgoingMessageId}>` },
        ]),
      },
      attachmentData,
    );

    c.executionCtx.waitUntil(
      sendEmail(c.env.EMAIL, {
        to,
        cc,
        bcc,
        from,
        subject,
        html,
        text,
        attachments: attachments?.map((att) => ({
          content: att.content,
          filename: att.filename,
          type: att.type,
          disposition: att.disposition || "attachment",
          contentId: att.contentId,
        })),
        ...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
      }).catch((e) => console.error("Deferred email delivery failed:", (e as Error).message)),
    );
    return c.json({ id: messageId, status: "sent" }, 202);
  })

  .post("/api/v1/mailboxes/:mailboxId/drafts", zJson(DraftBody), async (c) => {
    const mailboxId = c.req.param("mailboxId");
    const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id } = c.req.valid("json");
    const stub = c.var.mailboxStub;
    if (draft_id) await stub.deleteEmail(draft_id); // not atomic — create-then-delete would be safer
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();
    await stub.createEmail(
      Folders.DRAFT,
      {
        id: messageId,
        subject: subject || "",
        sender: mailboxId.toLowerCase(),
        recipient: (to || "").toLowerCase(),
        cc: cc?.toLowerCase() || null,
        bcc: bcc?.toLowerCase() || null,
        date: now,
        body,
        in_reply_to: in_reply_to || null,
        email_references: null,
        thread_id: thread_id || in_reply_to || messageId,
      },
      [],
    );
    return c.json(
      { id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now },
      201,
    );
  })

  .get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c) => {
    const email = toEmail(await c.var.mailboxStub.getEmail(c.req.param("id")));
    if (!email) return c.json({ error: "Email not found" }, 404);
    return c.json(email);
  })

  .put("/api/v1/mailboxes/:mailboxId/emails/:id", zJson(UpdateEmailBody), async (c) => {
    const { read, starred } = c.req.valid("json");
    const email = toEmail(
      await c.var.mailboxStub.updateEmail(c.req.param("id"), { read, starred }),
    );
    return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
  })

  .delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c) => {
    const id = c.req.param("id");
    const attachments = await c.var.mailboxStub.deleteEmail(id);
    if (attachments === null) return c.json({ error: "Not found" }, 404);
    if (attachments.length > 0)
      await c.env.BUCKET.delete(
        attachments.map((att) => `attachments/${id}/${att.id}/${att.filename}`),
      );
    return c.body(null, 204);
  })

  .post("/api/v1/mailboxes/:mailboxId/emails/:id/move", zJson(MoveEmailBody), async (c) => {
    const { folderId } = c.req.valid("json");
    const success = await c.var.mailboxStub.moveEmail(c.req.param("id"), folderId);
    return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
  })

  // -- Threads ------------------------------------------------------

  .get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c) => {
    const emails = await rawOps(c.var.mailboxStub).getThreadEmails(c.req.param("threadId"));
    return c.json(emails);
  })

  .post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c) => {
    await c.var.mailboxStub.markThreadRead(c.req.param("threadId"));
    return c.json({ status: "marked_read" });
  })

  // -- Reply / Forward ----------------------------------------------

  .post(
    "/api/v1/mailboxes/:mailboxId/emails/:id/reply",
    zJson(SendEmailRequestSchema),
    handleReplyEmail,
  )
  .post(
    "/api/v1/mailboxes/:mailboxId/emails/:id/forward",
    zJson(SendEmailRequestSchema),
    handleForwardEmail,
  )

  // -- Folders ------------------------------------------------------

  .get("/api/v1/mailboxes/:mailboxId/folders", async (c) => {
    const folders: Folder[] = await c.var.mailboxStub.getFolders();
    return c.json(folders);
  })

  .post("/api/v1/mailboxes/:mailboxId/folders", zJson(FolderBody), async (c) => {
    const { name } = c.req.valid("json");
    const slug = slugify(name);
    if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
    const f = await c.var.mailboxStub.createFolder(slug, name);
    return f
      ? c.json(f satisfies Folder, 201)
      : c.json({ error: "Folder with this name already exists" }, 409);
  })

  .put("/api/v1/mailboxes/:mailboxId/folders/:id", zJson(FolderBody), async (c) => {
    const { name } = c.req.valid("json");
    const f = await c.var.mailboxStub.updateFolder(c.req.param("id"), name);
    return f ? c.json(f) : c.json({ error: "Folder not found" }, 404);
  })

  .delete("/api/v1/mailboxes/:mailboxId/folders/:id", async (c) => {
    const ok = await c.var.mailboxStub.deleteFolder(c.req.param("id"));
    return ok ? c.body(null, 204) : c.json({ error: "Folder not found or cannot be deleted" }, 400);
  })

  // -- Search -------------------------------------------------------

  .get("/api/v1/mailboxes/:mailboxId/search", zQuery(SearchQuery), async (c) => {
    const { page, limit, query, ...filters } = c.req.valid("query");
    const searchOpts = { ...filters, query: query ?? "" };
    const search = rawOps(c.var.mailboxStub);
    const [emails, totalCount] = await Promise.all([
      search.searchEmails({ ...searchOpts, page, limit }),
      search.countSearchResults(searchOpts),
    ]);
    return c.json({ emails, totalCount } satisfies EmailListResponse);
  })

  // -- Attachments --------------------------------------------------

  .get(
    "/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId",
    async (c): Promise<Response> => {
      const emailId = c.req.param("emailId");
      const attachmentId = c.req.param("attachmentId");
      const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
      if (!attachment) return c.json({ error: "Attachment not found" }, 404);
      const obj = await c.env.BUCKET.get(
        `attachments/${emailId}/${attachmentId}/${attachment.filename}`,
      );
      if (!obj) return c.json({ error: "Attachment file not found" }, 404);
      const headers = new Headers();
      headers.set("Content-Type", attachment.mimetype);
      // Strip control chars and quotes: they would allow header injection.
      // eslint-disable-next-line no-control-regex
      const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
      headers.set(
        "Content-Disposition",
        `attachment; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      );
      return new Response(obj.body, { headers });
    },
  );

/** The contract `hc<AppType>()` in `app/services/api.ts` is built from. */
export type AppType = typeof routes;

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
  if (streamSize > MAX_EMAIL_SIZE)
    throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
  if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
  const result = new Uint8Array(streamSize);
  let bytesRead = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (bytesRead + value.length > streamSize) {
      void reader.cancel();
      throw new Error(`Stream exceeds declared size`);
    }
    result.set(value, bytesRead);
    bytesRead += value.length;
  }
  return result;
}

async function receiveEmail(
  event: { raw: ReadableStream; rawSize: number },
  env: Env,
  ctx: ExecutionContext,
) {
  const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
  const parsedEmail = await new PostalMime().parse(rawEmail);

  if (!parsedEmail.to?.length || !parsedEmail.to[0].address)
    throw new Error("received email with empty to");

  const allowedAddresses = ((env.EMAIL_ADDRESSES ?? []) as string[]).map((a) => a.toLowerCase());
  const allRecipients = parsedEmail.to
    .map((t) => t.address?.toLowerCase())
    .filter(Boolean) as string[];
  const ccRecipients = (parsedEmail.cc || [])
    .map((e) => e.address?.toLowerCase())
    .filter(Boolean) as string[];
  const bccRecipients = (parsedEmail.bcc || [])
    .map((e) => e.address?.toLowerCase())
    .filter(Boolean) as string[];

  let mailboxId: string | undefined;
  if (allowedAddresses.length > 0) {
    mailboxId = allRecipients.find((addr) => allowedAddresses.includes(addr));
    if (!mailboxId) {
      console.log(`Ignoring email: no recipient matches EMAIL_ADDRESSES.`);
      return;
    }
  } else {
    mailboxId = allRecipients[0];
  }
  if (!mailboxId) throw new Error("received email with no valid recipient address");

  const messageId = crypto.randomUUID();
  if (!(await env.BUCKET.head(`mailboxes/${mailboxId}.json`))) {
    console.log(`Ignoring email for ${mailboxId}: mailbox does not exist`);
    return;
  }

  const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));

  const attachmentData: StoredAttachment[] = [];
  if (parsedEmail.attachments) {
    for (const att of parsedEmail.attachments) {
      const attId = crypto.randomUUID();
      // Sanitize filename to prevent path traversal in R2 keys
      // eslint-disable-next-line no-control-regex
      const filename = (att.filename || "untitled").replace(/[/\\:*?"<>|\x00-\x1f]/g, "_");
      await env.BUCKET.put(`attachments/${messageId}/${attId}/${filename}`, att.content);
      attachmentData.push({
        id: attId,
        email_id: messageId,
        filename,
        mimetype: att.mimeType,
        size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
        content_id: att.contentId || null,
        disposition: att.disposition || "attachment",
      });
    }
  }

  const extractMsgId = (s: string) => {
    const m = s.match(/<([^>]+)>/);
    return m ? m[1] : s.trim().split(/\s+/)[0];
  };
  const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
  const emailReferences = parsedEmail.references
    ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId)
    : [];
  let threadId = emailReferences[0] || inReplyTo || messageId;

  if (!inReplyTo && emailReferences.length === 0) {
    const subjectThread = await stub.findThreadBySubject(
      parsedEmail.subject || "",
      parsedEmail.from?.address || undefined,
    );
    if (subjectThread) threadId = subjectThread;
  }

  const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;

  await stub.createEmail(
    Folders.INBOX,
    {
      id: messageId,
      subject: parsedEmail.subject || "",
      sender: (parsedEmail.from?.address || "").toLowerCase(),
      recipient: allRecipients.join(", "),
      cc: ccRecipients.join(", ") || null,
      bcc: bccRecipients.join(", ") || null,
      date: new Date().toISOString(), // uses receive time, not the email's Date header
      body: parsedEmail.html || parsedEmail.text || "",
      in_reply_to: inReplyTo,
      email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
      thread_id: threadId,
      message_id: originalMessageId,
      raw_headers: JSON.stringify(parsedEmail.headers),
    },
    attachmentData,
  );

  const agentStub = env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(mailboxId));
  ctx.waitUntil(
    agentStub
      .fetch(
        new Request("https://agents/onNewEmail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mailboxId,
            emailId: messageId,
            sender: (parsedEmail.from?.address || "").toLowerCase(),
            subject: parsedEmail.subject || "",
            threadId,
          }),
        }),
      )
      .catch((e) => console.error("Auto-draft trigger failed:", (e as Error).message)),
  );
}

export { app, routes, receiveEmail };
