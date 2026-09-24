// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";
import { useFetcher, useLocation } from "react-router";
import EmailPanel from "~/components/EmailPanel";
import { useMailboxData } from "~/hooks/useMailboxData";
import { withoutCompose } from "~/lib/compose";
import type { Email } from "~/types";

/**
 * The body of an email detail route: marks the thread read on open and
 * renders the reading pane. Shared by the folder and search routes, whose
 * loaders and actions come from `mail.server`.
 */
export default function EmailDetail({
  email,
  thread,
  folder,
  listPath,
}: {
  email: Email;
  thread: Email[];
  folder: string;
  /** The list route this detail is nested in, without a query string. */
  listPath: string;
}) {
  const { folders, mailbox } = useMailboxData();
  const location = useLocation();
  const markRead = useFetcher();

  // Mark read by POSTing to this route's action rather than writing from the
  // loader: GETs stay side-effect free, and an action revalidates every loader
  // on the page, so the row's unread dot and the sidebar's counts update too.
  const markedRef = useRef<string | null>(null);
  const needsMarking = !email.read || thread.some((m) => !m.read);

  useEffect(() => {
    if (!needsMarking) return;
    if (markedRef.current === email.id) return;
    markedRef.current = email.id;

    const fields: Record<string, string> = { intent: "markThreadRead", emailId: email.id };
    if (email.thread_id && thread.length > 1) fields.threadId = email.thread_id;
    void markRead.submit(fields, { method: "post" });
    // `markRead` is stable per fetcher; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.id, needsMarking]);

  return (
    <EmailPanel
      email={email}
      thread={thread}
      folders={folders}
      mailbox={mailbox}
      folder={folder}
      listHref={`${listPath}${withoutCompose(location.search)}`}
    />
  );
}
