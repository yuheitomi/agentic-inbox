// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Client-fetching wrapper around `EmailPanel`.
 *
 * The email list route feeds the panel from its `email-detail` loader. The
 * search route still selects an email in Zustand rather than the URL, so it
 * needs the old TanStack Query path. This keeps both working while the
 * migration is only a slice deep -- delete it once search moves to a nested
 * route too.
 */

import { useParams } from "react-router";
import EmailPanel, { EmailPanelSkeleton } from "~/components/EmailPanel";
import { useUIStore } from "~/hooks/useUIStore";
import { useEmail, useThreadReplies } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";

export default function EmailPanelQuery({ emailId }: { emailId: string }) {
  const { mailboxId } = useParams<{ mailboxId: string }>();
  const { data: email } = useEmail(mailboxId, emailId);
  const { data: thread } = useThreadReplies(mailboxId, email?.thread_id);
  const { data: folders = [] } = useFolders(mailboxId);
  const { data: mailbox } = useMailbox(mailboxId);
  const closePanel = useUIStore((s) => s.closePanel);

  if (!email) return <EmailPanelSkeleton />;

  return (
    <EmailPanel
      email={email}
      thread={thread ?? [email]}
      folders={folders}
      mailbox={mailbox}
      onClose={closePanel}
    />
  );
}
