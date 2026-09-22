// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Typed client for the Worker's API, built on Hono RPC.
 *
 * `hc<AppType>` derives every path, param, query string, request body and
 * response shape from the route chain in `workers/index.ts`, so a change on
 * the server surfaces here as a type error instead of a runtime 404. The
 * import of `AppType` is type-only and erases at build time -- no worker code
 * reaches the client bundle.
 *
 * The wrappers below exist for the two things RPC leaves to the caller:
 * turning a non-2xx response into a thrown `ApiError`, and unwrapping the
 * response body.
 */

import { hc, type InferRequestType } from "hono/client";
import type { AppType } from "workers/index";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super((body.error as string) || `Request failed: ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Combine the caller's signal (e.g. TanStack Query abort) with our timeout. */
function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  return fetch(input, { ...init, signal }).finally(() => clearTimeout(timeout));
}

// Relative base: the API is served from the same origin as the app.
export const client = hc<AppType>("", { fetch: apiFetch });

const v1 = client.api.v1;
const mailboxes = v1.mailboxes;

// ---------- Response unwrapping ----------

/**
 * Hono types a route's response as a union with one member per status code.
 * Explicit failures (`c.json(..., 404)`) carry `ok: false`; dropping them
 * leaves the success arms, so callers get the happy path's type and never
 * have to narrow it themselves. Excluding rather than extracting `ok: true`
 * matters because a bare `c.json(x)` is typed `ContentfulStatusCode`, whose
 * `ok` is `boolean`.
 */
type OkArm<R> = Exclude<R, { ok: false }>;
export type OkBody<R> = OkArm<R> extends { json(): Promise<infer T> } ? T : never;

/** Minimal structural view; the real union is too wide to call `.json()` on. */
export type AnyResponse = { ok: boolean; status: number; json(): Promise<unknown> };

async function toApiError(res: AnyResponse): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  return new ApiError(res.status, (body ?? {}) as Record<string, unknown>);
}

/** Await an RPC call and return its parsed success body. */
async function json<R>(pending: Promise<R>): Promise<OkBody<R>> {
  const res = (await pending) as AnyResponse;
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as OkBody<R>;
}

/** Await an RPC call that answers 204 (or whose body we discard). */
async function empty<R>(pending: Promise<R>): Promise<void> {
  const res = (await pending) as AnyResponse;
  if (!res.ok) throw await toApiError(res);
}

// ---------- Request body types, inferred from the routes ----------

type SendEmailBody = InferRequestType<(typeof mailboxes)[":mailboxId"]["emails"]["$post"]>["json"];
type DraftBody = InferRequestType<(typeof mailboxes)[":mailboxId"]["drafts"]["$post"]>["json"];
type UpdateEmailBody = InferRequestType<
  (typeof mailboxes)[":mailboxId"]["emails"][":id"]["$put"]
>["json"];
type MailboxSettings = InferRequestType<
  (typeof mailboxes)[":mailboxId"]["$put"]
>["json"]["settings"];
type ListEmailsQuery = InferRequestType<
  (typeof mailboxes)[":mailboxId"]["emails"]["$get"]
>["query"];
type SearchQuery = InferRequestType<(typeof mailboxes)[":mailboxId"]["search"]["$get"]>["query"];

export type {
  DraftBody,
  ListEmailsQuery,
  MailboxSettings,
  SearchQuery,
  SendEmailBody,
  UpdateEmailBody,
};

// ---------- API client ----------

const api = {
  // Mailboxes
  getMailbox: (mailboxId: string) => json(mailboxes[":mailboxId"].$get({ param: { mailboxId } })),
  updateMailbox: (mailboxId: string, settings: MailboxSettings) =>
    json(mailboxes[":mailboxId"].$put({ param: { mailboxId }, json: { settings } })),

  // Emails
  listEmails: (mailboxId: string, query: ListEmailsQuery, opts?: { signal?: AbortSignal }) =>
    json(
      mailboxes[":mailboxId"].emails.$get(
        { param: { mailboxId }, query },
        { init: { signal: opts?.signal } },
      ),
    ),
  sendEmail: (mailboxId: string, email: SendEmailBody) =>
    json(mailboxes[":mailboxId"].emails.$post({ param: { mailboxId }, json: email })),
  getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
    json(
      mailboxes[":mailboxId"].emails[":id"].$get(
        { param: { mailboxId, id } },
        { init: { signal: opts?.signal } },
      ),
    ),
  updateEmail: (mailboxId: string, id: string, data: UpdateEmailBody) =>
    json(mailboxes[":mailboxId"].emails[":id"].$put({ param: { mailboxId, id }, json: data })),
  deleteEmail: (mailboxId: string, id: string) =>
    empty(mailboxes[":mailboxId"].emails[":id"].$delete({ param: { mailboxId, id } })),
  moveEmail: (mailboxId: string, id: string, folderId: string) =>
    json(
      mailboxes[":mailboxId"].emails[":id"].move.$post({
        param: { mailboxId, id },
        json: { folderId },
      }),
    ),
  getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
    json(
      mailboxes[":mailboxId"].threads[":threadId"].$get(
        { param: { mailboxId, threadId } },
        { init: { signal: opts?.signal } },
      ),
    ),
  markThreadRead: (mailboxId: string, threadId: string) =>
    json(
      mailboxes[":mailboxId"].threads[":threadId"].read.$post({ param: { mailboxId, threadId } }),
    ),
  getAttachment: async (
    mailboxId: string,
    emailId: string,
    attachmentId: string,
  ): Promise<Blob> => {
    const res = await mailboxes[":mailboxId"].emails[":emailId"].attachments[":attachmentId"].$get(
      { param: { mailboxId, emailId, attachmentId } },
      { headers: { Accept: "*/*" } },
    );
    if (!res.ok) throw await toApiError(res);
    return res.blob();
  },
  saveDraft: (mailboxId: string, draft: DraftBody) =>
    json(mailboxes[":mailboxId"].drafts.$post({ param: { mailboxId }, json: draft })),
  replyToEmail: (mailboxId: string, emailId: string, email: SendEmailBody) =>
    json(
      mailboxes[":mailboxId"].emails[":id"].reply.$post({
        param: { mailboxId, id: emailId },
        json: email,
      }),
    ),
  forwardEmail: (mailboxId: string, emailId: string, email: SendEmailBody) =>
    json(
      mailboxes[":mailboxId"].emails[":id"].forward.$post({
        param: { mailboxId, id: emailId },
        json: email,
      }),
    ),

  // Folders
  listFolders: (mailboxId: string) =>
    json(mailboxes[":mailboxId"].folders.$get({ param: { mailboxId } })),
  createFolder: (mailboxId: string, name: string) =>
    json(mailboxes[":mailboxId"].folders.$post({ param: { mailboxId }, json: { name } })),
  updateFolder: (mailboxId: string, id: string, name: string) =>
    json(mailboxes[":mailboxId"].folders[":id"].$put({ param: { mailboxId, id }, json: { name } })),
  deleteFolder: (mailboxId: string, id: string) =>
    empty(mailboxes[":mailboxId"].folders[":id"].$delete({ param: { mailboxId, id } })),

  // Search
  searchEmails: (mailboxId: string, query: SearchQuery) =>
    json(mailboxes[":mailboxId"].search.$get({ param: { mailboxId }, query })),
};

export default api;
