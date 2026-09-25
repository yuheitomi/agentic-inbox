// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { href, type ShouldRevalidateFunctionArgs } from "react-router";
import EmailDetail from "~/components/EmailDetail";
import EmailDetailError from "~/components/EmailDetailError";
import { revalidateOn } from "~/lib/revalidation";
import { serverApi } from "~/services/api.server";
import { emailAction, loadEmailDetail } from "~/services/mail.server";
import type { Route } from "./+types/$emailId";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  return loadEmailDetail(serverApi(context, request), params.mailboxId, params.emailId);
}

/** Star, read state, move, delete, and draft sends -- from the pane and the list rows alike. */
export async function action({ params, request, context }: Route.ActionArgs) {
  const form = await request.formData();
  return emailAction(serverApi(context, request), params.mailboxId, params.emailId, form);
}

/** Paging the list or opening the composer leaves the open email as it was. */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return revalidateOn(args, { params: ["mailboxId", "emailId"] });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const subject = loaderData ? loaderData.email.subject || "(no subject)" : "Email not found";
  return [{ title: `${subject} — Agentic Inbox` }];
}

export default function FolderEmailRoute({ loaderData, params }: Route.ComponentProps) {
  return (
    <EmailDetail
      email={loaderData.email}
      thread={loaderData.thread}
      folder={params.folder}
      listPath={href("/mailbox/:mailboxId/emails/:folder", {
        mailboxId: params.mailboxId,
        folder: params.folder,
      })}
    />
  );
}

/** A missing email closes just the pane; the list and sidebar stay. */
export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  return (
    <EmailDetailError
      error={error}
      listPath={href("/mailbox/:mailboxId/emails/:folder", {
        mailboxId: params.mailboxId,
        folder: params.folder,
      })}
    />
  );
}
