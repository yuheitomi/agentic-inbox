// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Input, LinkButton } from "@cloudflare/kumo";
import { FloppyDiskIcon, PaperPlaneTiltIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { href, useFetcher, useLocation } from "react-router";
import { useMailboxData } from "~/hooks/useMailboxData";
import {
  COMPOSE_FETCHER_KEY,
  type ComposeMode,
  type ComposeState,
  withoutCompose,
} from "~/lib/compose";
import {
  buildQuotedReplyBlock,
  escapeHtml,
  formatComposeDate,
  getSignatureBlock,
  splitEmailList,
  stripHtml,
} from "~/lib/utils";
import type { Email } from "~/types";
import RichTextEditor from "./RichTextEditor";

function appendUniqueAddress(
  addresses: string[],
  seen: Set<string>,
  address: string,
  exclude?: string,
) {
  const trimmed = address.trim();
  if (!trimmed) return;

  const normalized = trimmed.toLowerCase();
  if (normalized === exclude || seen.has(normalized)) return;

  seen.add(normalized);
  addresses.push(trimmed);
}

interface ComposeFormFields {
  to: string;
  cc: string;
  bcc: string;
  showCcBcc: boolean;
  subject: string;
  body: string;
}

const EMPTY_FIELDS: ComposeFormFields = {
  to: "",
  cc: "",
  bcc: "",
  showCcBcc: false,
  subject: "",
  body: "",
};

function getPrefixedSubject(subject: string, prefix: "Re" | "Fwd") {
  const expectedPrefix = `${prefix}: `;
  return subject.startsWith(expectedPrefix) ? subject : `${expectedPrefix}${subject}`;
}

function buildForwardBody(original: Email, sigBlock: string) {
  const safeSender = escapeHtml(original.sender);
  const safeSubject = escapeHtml(original.subject);
  const safeBody = escapeHtml(stripHtml(original.body || "")).replace(/\n/g, "<br>");

  return `<p><br></p>${sigBlock ? `${sigBlock}<br>` : ""}<div style="border: 1px solid #ddd; padding: 1em; background-color: #f9f9f9; margin: 1em 0;"><strong>Forwarded message:</strong><br><strong>From:</strong> ${safeSender}<br><strong>Date:</strong> ${formatComposeDate(original.date)}<br><strong>Subject:</strong> ${safeSubject}<br><br>${safeBody}</div>`;
}

function buildReplyAllFields(original: Email, selfAddress?: string) {
  const toRecipients: string[] = [];
  const toSeen = new Set<string>();
  appendUniqueAddress(toRecipients, toSeen, original.sender, selfAddress);

  for (const recipient of splitEmailList(original.recipient)) {
    appendUniqueAddress(toRecipients, toSeen, recipient, selfAddress);
  }

  const ccRecipients: string[] = [];
  const ccSeen = new Set<string>();
  for (const recipient of splitEmailList(original.cc)) {
    const normalized = recipient.toLowerCase();
    if (normalized === selfAddress || toSeen.has(normalized) || ccSeen.has(normalized)) {
      continue;
    }
    ccSeen.add(normalized);
    ccRecipients.push(recipient);
  }

  return {
    to: toRecipients.join(", "),
    cc: ccRecipients.join(", "),
    showCcBcc: ccRecipients.length > 0,
  };
}

function buildInitialComposeFields(
  { mode, original, draft }: ComposeState,
  mailboxEmail: string,
  sigBlock: string,
): ComposeFormFields {
  if (draft) {
    return {
      to: draft.recipient || "",
      cc: draft.cc || "",
      bcc: draft.bcc || "",
      showCcBcc: Boolean(draft.cc || draft.bcc),
      subject: draft.subject || "",
      body: draft.body || "",
    };
  }

  const newMessage = { ...EMPTY_FIELDS, body: sigBlock ? `<p><br></p>${sigBlock}` : "" };
  if (!original) return newMessage;

  const quoted = `<p><br></p>${sigBlock ? `${sigBlock}<br>` : ""}${buildQuotedReplyBlock(original.date, original.sender, original.body || "")}`;

  switch (mode) {
    case "reply":
      return {
        ...EMPTY_FIELDS,
        to: original.sender,
        subject: getPrefixedSubject(original.subject, "Re"),
        body: quoted,
      };
    case "reply-all":
      return {
        ...EMPTY_FIELDS,
        ...buildReplyAllFields(original, mailboxEmail.toLowerCase()),
        subject: getPrefixedSubject(original.subject, "Re"),
        body: quoted,
      };
    case "forward":
      return {
        ...EMPTY_FIELDS,
        subject: getPrefixedSubject(original.subject, "Fwd"),
        body: buildForwardBody(original, sigBlock),
      };
    default:
      return newMessage;
  }
}

const TITLES: Record<ComposeMode, string> = {
  new: "New Message",
  reply: "Reply",
  "reply-all": "Reply All",
  forward: "Forward",
  draft: "Edit Draft",
};

/**
 * The composer, opened by `?compose` and seeded from the mailbox layout's
 * loader. It posts to the `compose` route, which sends or saves on the server
 * and redirects back here -- closed after a send, still open on the stored
 * draft after a save.
 */
export default function ComposePanel({ compose }: { compose: ComposeState }) {
  const { mailbox } = useMailboxData();
  const location = useLocation();
  // Keyed so the mailbox layout can report the outcome once this has unmounted.
  const fetcher = useFetcher<{ ok: false; error: string }>({ key: COMPOSE_FETCHER_KEY });

  // Seeded once per composer; the parent's key starts a new one per message.
  const [initial] = useState(() =>
    buildInitialComposeFields(compose, mailbox.email, getSignatureBlock(mailbox.settings)),
  );
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [bcc, setBcc] = useState(initial.bcc);
  const [showCcBcc, setShowCcBcc] = useState(initial.showCcBcc);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  // The keyed fetcher outlives this composer, so only show an error for a
  // submission made from this one.
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const pendingIntent = fetcher.state === "idle" ? null : fetcher.formData?.get("intent");
  const isSending = pendingIntent === "send";
  const isSavingDraft = pendingIntent === "saveDraft";
  const error =
    hasSubmitted && fetcher.state === "idle" && fetcher.data?.ok === false
      ? fetcher.data.error
      : null;

  const closeHref = `${location.pathname}${withoutCompose(location.search)}`;
  const original = compose.original;
  const threadId = original?.thread_id || compose.draft?.thread_id || "";

  return (
    <div className="flex flex-col h-full bg-kumo-base">
      <div className="flex items-center justify-between px-4 py-3 border-b border-kumo-line shrink-0 md:px-6">
        <h2 className="text-base font-semibold text-kumo-default">{TITLES[compose.mode]}</h2>
        <div className="flex items-center gap-1">
          <LinkButton
            href={closeHref}
            variant="ghost"
            shape="square"
            size="sm"
            icon={<XIcon size={18} />}
            disabled={isSending}
            aria-label="Close compose"
          />
        </div>
      </div>

      <fetcher.Form
        method="post"
        action={href("/mailbox/:mailboxId/compose", { mailboxId: mailbox.id })}
        onSubmit={() => setHasSubmitted(true)}
        className="flex flex-col flex-1 min-h-0 overflow-y-auto"
      >
        <input type="hidden" name="mode" value={compose.mode} />
        <input type="hidden" name="original" value={original?.id ?? ""} />
        <input type="hidden" name="draft" value={compose.draft?.id ?? ""} />
        <input type="hidden" name="threadId" value={threadId} />
        <input type="hidden" name="returnTo" value={`${location.pathname}${location.search}`} />
        <input type="hidden" name="body" value={body} />
        <div className="p-4 md:p-6 space-y-4">
          {error && <Banner variant="error" text={error} />}

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">To</label>
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <Input
                  type="text"
                  placeholder="recipient@example.com"
                  size="sm"
                  name="to"
                  aria-label="To"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  required
                />
                {!showCcBcc && (
                  <button
                    type="button"
                    onClick={() => setShowCcBcc(true)}
                    className="shrink-0 text-xs text-kumo-link hover:text-kumo-link-hover font-medium"
                  >
                    CC / BCC
                  </button>
                )}
              </div>
            </div>

            {showCcBcc && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">CC</label>
                <div className="flex-1">
                  <Input
                    type="text"
                    size="sm"
                    name="cc"
                    aria-label="CC"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="Separate multiple addresses with commas"
                  />
                </div>
              </div>
            )}

            {showCcBcc && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">BCC</label>
                <div className="flex-1">
                  <Input
                    type="text"
                    size="sm"
                    name="bcc"
                    aria-label="BCC"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="Separate multiple addresses with commas"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">Subject</label>
              <div className="flex-1">
                <Input
                  type="text"
                  placeholder="Email subject"
                  size="sm"
                  name="subject"
                  aria-label="Subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="border border-kumo-line rounded-md overflow-hidden bg-kumo-base">
            <RichTextEditor value={body} onChange={setBody} />
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-auto px-4 py-3 border-t border-kumo-line bg-kumo-fill/30 shrink-0 md:px-6">
          <div className="flex items-center justify-between">
            <LinkButton href={closeHref} variant="ghost" size="sm" disabled={isSending}>
              Discard
            </LinkButton>
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                name="intent"
                value="saveDraft"
                // A draft may be saved before it has a recipient or subject.
                formNoValidate
                variant="secondary"
                size="sm"
                loading={isSavingDraft}
                disabled={isSending}
                icon={<FloppyDiskIcon size={14} />}
              >
                {isSavingDraft ? "Saving..." : "Save as Draft"}
              </Button>
              <Button
                type="submit"
                name="intent"
                value="send"
                variant="primary"
                size="sm"
                loading={isSending}
                disabled={isSavingDraft || isSending}
                icon={<PaperPlaneTiltIcon size={14} />}
              >
                {isSending ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </fetcher.Form>
    </div>
  );
}
