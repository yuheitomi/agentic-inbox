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

/** The same reading pane as a folder's, opened from a search result. */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  return loadEmailDetail(serverApi(context, request), params.mailboxId, params.emailId);
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const form = await request.formData();
  return emailAction(serverApi(context, request), params.mailboxId, params.emailId, form);
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return revalidateOn(args, { params: ["mailboxId", "emailId"] });
}

/** TEMP (latency measurement): pass the loader's `Server-Timing` through to the browser. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ loaderData }: Route.MetaArgs) {
  const subject = loaderData ? loaderData.email.subject || "(no subject)" : "Email not found";
  return [{ title: `${subject} — Agentic Inbox` }];
}

export default function SearchEmailRoute({ loaderData, params }: Route.ComponentProps) {
  const { email, thread } = loaderData;
  return (
    <EmailDetail
      email={email}
      thread={thread}
      // Results span folders, so the email's own folder decides its actions.
      folder={email.folder_id ?? ""}
      listPath={href("/mailbox/:mailboxId/search", { mailboxId: params.mailboxId })}
    />
  );
}

export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  return (
    <EmailDetailError
      error={error}
      listPath={href("/mailbox/:mailboxId/search", { mailboxId: params.mailboxId })}
    />
  );
}
