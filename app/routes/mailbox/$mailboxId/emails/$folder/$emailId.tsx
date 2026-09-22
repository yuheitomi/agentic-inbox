// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";
import {
  href,
  unstable_useRoute as useRoute,
  useFetcher,
  useNavigate,
  useSearchParams,
} from "react-router";
import EmailPanel from "~/components/EmailPanel";
import { MAILBOX_ROUTE_ID } from "~/routes/mailbox/$mailboxId/_layout";
import { ok, serverApi } from "~/services/api.server";
import type { Route } from "./+types/$emailId";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const mailboxId = decodeURIComponent(params.mailboxId);
  const api = serverApi(context, request);

  // A missing email answers 404, which `ok` rethrows as the error boundary's
  // response.
  const email = await ok(
    api.mailboxes[":mailboxId"].emails[":id"].$get({
      param: { mailboxId, id: params.emailId },
    }),
  );

  // One request returns every message in the thread with bodies and
  // attachments. Replaces the client's getEmail-per-message waterfall.
  const thread = email.thread_id
    ? await ok(
        api.mailboxes[":mailboxId"].threads[":threadId"].$get({
          param: { mailboxId, threadId: email.thread_id },
        }),
      )
    : [];

  return { email, thread };
}

export default function EmailDetailRoute({ loaderData, params }: Route.ComponentProps) {
  const { email, thread } = loaderData;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const markRead = useFetcher();
  const layout = useRoute(MAILBOX_ROUTE_ID)?.loaderData;

  const listPath = href("/mailbox/:mailboxId/emails/:folder", {
    mailboxId: params.mailboxId,
    folder: params.folder,
  });
  const search = searchParams.toString() ? `?${searchParams.toString()}` : "";

  // Mark read by POSTing to the LIST route's action rather than writing from
  // this loader. An action revalidates every loader in the matched chain, so
  // the row's unread dot and the sidebar's folder counts update too -- a
  // loader-side write would leave both stale.
  const markedRef = useRef<string | null>(null);
  const threadUnread = thread.some((m) => !m.read);
  const needsMarking = !email.read || threadUnread;

  useEffect(() => {
    if (!needsMarking) return;
    if (markedRef.current === email.id) return;
    markedRef.current = email.id;

    const form = new FormData();
    form.set("intent", "markThreadRead");
    form.set("emailId", email.id);
    if (email.thread_id && thread.length > 1) form.set("threadId", email.thread_id);
    void markRead.submit(form, { method: "post", action: `${listPath}${search}` });
    // `markRead` is stable per fetcher key; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.id, needsMarking]);

  return (
    <EmailPanel
      email={email}
      thread={thread}
      folders={layout?.folders ?? []}
      mailbox={layout?.mailbox}
      onClose={() => void navigate(`${listPath}${search}`)}
    />
  );
}
