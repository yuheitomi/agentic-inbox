// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLocation, useNavigate } from "react-router";
import { Folders } from "shared/folders";
import EmailPanelDialogs from "~/components/email-panel/EmailPanelDialogs";
import EmailPanelHeader from "~/components/email-panel/EmailPanelHeader";
import EmailPanelToolbar from "~/components/email-panel/EmailPanelToolbar";
import SingleMessageView from "~/components/email-panel/SingleMessageView";
import ThreadMessage from "~/components/email-panel/ThreadMessage";
import { useSubmissionToast } from "~/hooks/useSubmissionToast";
import { type ComposeParams, withCompose } from "~/lib/compose";
import type { Email, Folder, Mailbox } from "~/types";

/**
 * Fetcher key for the pane's mutations that can close it (move, delete,
 * sending or discarding a draft). The mailbox layout watches the same key to
 * report the outcome after the pane has gone.
 */
export const EMAIL_PANEL_FETCHER_KEY = "email-panel";

export function EmailPanelSkeleton() {
  return (
    <div className="animate-pulse p-5 space-y-4">
      <div className="h-5 w-2/3 rounded bg-kumo-fill" />
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-kumo-fill" />
        <div className="space-y-2 flex-1">
          <div className="h-3 w-40 rounded bg-kumo-fill" />
          <div className="h-2.5 w-24 rounded bg-kumo-fill" />
        </div>
      </div>
      <div className="space-y-2 pt-4">
        <div className="h-2.5 w-full rounded bg-kumo-fill" />
        <div className="h-2.5 w-5/6 rounded bg-kumo-fill" />
        <div className="h-2.5 w-4/6 rounded bg-kumo-fill" />
        <div className="h-2.5 w-3/4 rounded bg-kumo-fill" />
      </div>
    </div>
  );
}

export interface EmailPanelProps {
  email: Email;
  /** Every message in the thread, including `email` itself. */
  thread: Email[];
  folders: Folder[];
  mailbox: Mailbox;
  /** The folder the email is being viewed from; drafts get draft actions. */
  folder: string;
  /** The list the pane was opened from, which closing it returns to. */
  listHref: string;
}

/**
 * The reading pane. Its data arrives as props from a route loader, and every
 * mutation posts to that route's action: the pane never fetches or caches.
 */
export default function EmailPanel({
  email,
  thread,
  folders,
  mailbox,
  folder,
  listHref,
}: EmailPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const emailId = email.id;

  // Star and read toggles keep the pane open, so they use a fetcher of their
  // own whose pending submission doubles as optimistic state.
  const toggles = useFetcher();
  useSubmissionToast(toggles, {});
  const panel = useFetcher({ key: EMAIL_PANEL_FETCHER_KEY });

  const pendingToggle = toggles.formData?.get("intent");
  const starred =
    pendingToggle === "star" ? toggles.formData?.get("starred") === "true" : email.starred;
  const read = pendingToggle === "read" ? toggles.formData?.get("read") === "true" : email.read;
  const isSending = panel.state !== "idle" && panel.formData?.get("intent") === "sendDraft";

  const [sourceViewEmail, setSourceViewEmail] = useState<Email | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [previewImage, setPreviewImage] = useState<{ url: string; filename: string } | null>(null);
  const isDraftFolder = folder === Folders.DRAFT;

  const threadReplies = useMemo(() => thread.filter((e) => e.id !== email.id), [thread, email]);

  const allMessages = useMemo(() => {
    return [email, ...threadReplies].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [email, threadReplies]);

  // Reset expanded state only when the selected email changes, not on every revalidation.
  // Using allMessages as a dependency would reset user expand/collapse state on background polls.
  const currentEmailId = email.id;
  useEffect(() => {
    if (allMessages.length > 1) setExpandedMessages(new Set([allMessages[0].id]));
  }, [currentEmailId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (msgId: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const draftMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of allMessages) {
      if (msg.folder_id === Folders.DRAFT) ids.add(msg.id);
      else if (isDraftFolder && msg.id === emailId) ids.add(msg.id);
    }
    return ids;
  }, [allMessages, isDraftFolder, emailId]);

  const lastReceivedMessage = useMemo(() => {
    const own = mailbox.email;
    const received = allMessages.filter(
      (msg) => !draftMessageIds.has(msg.id) && msg.sender !== own,
    );
    if (received.length > 0) return received[0];
    const nonDrafts = allMessages.filter((msg) => !draftMessageIds.has(msg.id));
    return nonDrafts.length > 0 ? nonDrafts[0] : email;
  }, [allMessages, draftMessageIds, mailbox.email, email]);

  const moveToFolders = useMemo(() => {
    const cur = folder || email.folder_id;
    return folders.filter((f) => f.id !== cur);
  }, [folders, folder, email.folder_id]);

  /** This page with the composer opened as `params`, keeping the email in view. */
  const composeHref = (params: ComposeParams) =>
    `${location.pathname}${withCompose(location.search, params)}`;

  /**
   * Post a pane mutation. `closes` sends `redirectTo`, so the action lands on
   * the list once the email is gone from this view.
   */
  const submit = (fields: Record<string, string>, closes: boolean) => {
    void panel.submit(closes ? { ...fields, redirectTo: listHref } : fields, { method: "post" });
  };

  const toggle = (fields: Record<string, string>) => {
    void toggles.submit(fields, { method: "post" });
  };

  const handleDelete = () => {
    if (!window.confirm("Are you sure you want to delete this email?")) return;
    submit({ intent: "delete", emailId }, true);
  };

  const handleDeleteDraft = (target: Email) => {
    if (!window.confirm("Discard this draft?")) return;
    submit({ intent: "discardDraft", emailId: target.id }, target.id === emailId);
  };

  // The action re-reads the stored draft and builds the message on the server.
  const handleSendDraft = (target: Email) => {
    submit({ intent: "sendDraft", emailId: target.id }, isDraftFolder && target.id === emailId);
  };

  const hasThread = allMessages.length > 1;

  return (
    <div className="flex flex-col h-full">
      <EmailPanelToolbar
        email={{ ...email, starred, read }}
        isDraftFolder={isDraftFolder}
        isSending={isSending}
        moveToFolders={moveToFolders}
        backHref={listHref}
        editDraftHref={composeHref({ mode: "draft", draft: emailId })}
        replyHref={composeHref({ mode: "reply", original: lastReceivedMessage.id })}
        replyAllHref={composeHref({ mode: "reply-all", original: lastReceivedMessage.id })}
        forwardHref={composeHref({ mode: "forward", original: emailId })}
        onSendDraft={() => handleSendDraft(email)}
        onToggleStar={() => toggle({ intent: "star", emailId, starred: String(!starred) })}
        onToggleRead={() => toggle({ intent: "read", emailId, read: String(!read) })}
        onMove={(folderId) => submit({ intent: "move", emailId, folderId }, true)}
        onViewSource={() => setSourceViewEmail(email)}
        onDelete={handleDelete}
      />

      <EmailPanelHeader
        subject={email.subject}
        messageCount={allMessages.length}
        showThreadCount={hasThread}
      />

      <div className="flex-1 overflow-y-auto">
        {hasThread ? (
          allMessages.map((msg, idx) => {
            const isDraft = draftMessageIds.has(msg.id);
            return (
              <ThreadMessage
                key={msg.id}
                email={msg}
                mailboxId={mailbox.id}
                mailboxEmail={mailbox.email}
                isLast={idx === allMessages.length - 1}
                isDraft={isDraft}
                isSending={isDraft ? isSending : false}
                isExpanded={expandedMessages.has(msg.id)}
                onToggleExpand={() => toggleExpand(msg.id)}
                onSendDraft={isDraft ? () => handleSendDraft(msg) : undefined}
                onEditDraft={
                  isDraft
                    ? () => void navigate(composeHref({ mode: "draft", draft: msg.id }))
                    : undefined
                }
                onDeleteDraft={isDraft ? () => handleDeleteDraft(msg) : undefined}
                onViewSource={() => setSourceViewEmail(msg)}
                onPreviewImage={(url, filename) => setPreviewImage({ url, filename })}
              />
            );
          })
        ) : (
          <SingleMessageView
            email={email}
            mailboxId={mailbox.id}
            onPreviewImage={(url, filename) => setPreviewImage({ url, filename })}
          />
        )}
      </div>

      <EmailPanelDialogs
        sourceViewEmail={sourceViewEmail}
        previewImage={previewImage}
        onCloseSource={() => setSourceViewEmail(null)}
        onClosePreview={() => setPreviewImage(null)}
      />
    </div>
  );
}
