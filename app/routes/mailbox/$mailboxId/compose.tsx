// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The composer's mutations: send (new, reply or forward) and save as draft.
 *
 * A resource route with no UI -- the composer is opened by `?compose` on
 * whatever page is showing, and posts here. Both intents redirect back to
 * that page (`returnTo`): a send drops the composer from the URL, a save keeps
 * it open on the draft it just stored.
 */

import { href, redirect } from "react-router";
import { Folders } from "shared/folders";
import { withCompose, withoutCompose } from "~/lib/compose";
import {
  type ActionResult,
  errorMessage,
  field,
  ok,
  redirectTarget,
  serverApi,
} from "~/services/api.server";
import { sendMessage } from "~/services/mail.server";
import type { Route } from "./+types/compose";

/** A GET here has nothing to show; open the composer over the inbox instead. */
export function loader({ params }: Route.LoaderArgs) {
  const inbox = href("/mailbox/:mailboxId/emails/:folder", {
    mailboxId: params.mailboxId,
    folder: Folders.INBOX,
  });
  throw redirect(`${inbox}${withCompose("", { mode: "new" })}`);
}

/**
 * `path` with a trailing `/<from>` segment swapped for `/<to>`, or dropped
 * when `to` is null. Keeps the reading pane off a draft id that no longer
 * exists: the API replaces a draft with a new id on every save, and deletes
 * it once it is sent.
 */
function replaceTrailingId(path: string, from: string, to: string | null): string {
  if (!from || !path.endsWith(`/${from}`)) return path;
  const parent = path.slice(0, -from.length - 1);
  return to ? `${parent}/${to}` : parent;
}

export async function action({
  params,
  request,
  context,
}: Route.ActionArgs): Promise<ActionResult | Response> {
  const { mailboxId } = params;
  const api = serverApi(context, request);
  const form = await request.formData();
  const intent = field(form, "intent");

  const mode = field(form, "mode");
  const original = field(form, "original") || undefined;
  const draftId = field(form, "draft");
  const message = {
    to: field(form, "to"),
    cc: field(form, "cc"),
    bcc: field(form, "bcc"),
    subject: field(form, "subject"),
    html: field(form, "body"),
  };

  const fallback = href("/mailbox/:mailboxId/emails/:folder", {
    mailboxId,
    folder: Folders.INBOX,
  });
  const returnTo = new URL(redirectTarget(form, "returnTo") ?? fallback, request.url);

  switch (intent) {
    case "send": {
      const mailbox = await ok(api.mailboxes[":mailboxId"].$get({ param: { mailboxId } }));
      const sendMode =
        mode === "forward" ? "forward" : mode === "new" || !original ? "new" : "reply";
      const sent = await sendMessage(api, mailbox, {
        ...message,
        mode: sendMode,
        originalId: original,
      });
      if (!sent.ok) return sent;

      // The message is out; a draft left behind would only be a duplicate.
      if (draftId) {
        await api.mailboxes[":mailboxId"].emails[":id"].$delete({
          param: { mailboxId, id: draftId },
        });
      }
      const path = replaceTrailingId(returnTo.pathname, draftId, null);
      return redirect(`${path}${withoutCompose(returnTo.searchParams)}`);
    }

    case "saveDraft": {
      const res = await api.mailboxes[":mailboxId"].drafts.$post({
        param: { mailboxId },
        json: {
          to: message.to,
          cc: message.cc || undefined,
          bcc: message.bcc || undefined,
          subject: message.subject,
          body: message.html,
          in_reply_to: original,
          thread_id: field(form, "threadId") || undefined,
          draft_id: draftId || undefined,
        },
      });
      if (!res.ok) return { ok: false, error: await errorMessage(res, "Failed to save draft") };
      const saved = await res.json();

      // Stay in the composer, now editing the stored draft, so the next save
      // replaces it rather than adding another.
      const path = replaceTrailingId(returnTo.pathname, draftId, saved.id);
      return redirect(
        `${path}${withCompose(returnTo.searchParams, { mode: "draft", draft: saved.id })}`,
      );
    }

    default:
      return { ok: false, error: `Unknown intent: ${intent}` };
  }
}
