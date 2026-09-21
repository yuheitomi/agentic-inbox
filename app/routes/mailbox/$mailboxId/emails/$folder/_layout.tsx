// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Pagination, Tooltip } from "@cloudflare/kumo";
import {
  ArchiveIcon,
  ArrowBendUpLeftIcon,
  ArrowsClockwiseIcon,
  EnvelopeOpenIcon,
  EnvelopeSimpleIcon,
  FileIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  StarIcon,
  TrashIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import {
  Link,
  redirect,
  useFetcher,
  useMatches,
  useNavigation,
  useRevalidator,
  useRouteLoaderData,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { formatListDate } from "shared/dates";
import { Folders } from "shared/folders";
import MailboxSplitView from "~/components/MailboxSplitView";
import { useRevalidateInterval } from "~/hooks/useRevalidateInterval";
import { useUIStore } from "~/hooks/useUIStore";
import { deleteEmailWithAttachments, requireMailboxStub, threadOps } from "~/lib/mailbox.server";
import { getSnippetText } from "~/lib/utils";
import { MAILBOX_ROUTE_ID, type MailboxLayoutData } from "~/routes/mailbox/$mailboxId/_layout";
import type { Email } from "~/types";
import type { Route } from "./+types/_layout";

const PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 30_000;

export const EMAIL_DETAIL_ROUTE_ID = "routes/mailbox/$mailboxId/emails/$folder/$emailId";

// ── Data ───────────────────────────────────────────────────────────

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const mailboxId = decodeURIComponent(params.mailboxId);
  const stub = await requireMailboxStub(context, mailboxId);

  const rawPage = Number(new URL(request.url).searchParams.get("page") ?? "1");
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  // Both queries hit the same Durable Object; issuing them together lets the
  // DO pipeline them rather than paying two sequential RPC round trips.
  const threads = threadOps(stub);
  const [emails, totalCount] = await Promise.all([
    threads.getThreadedEmails({ folder: params.folder, page, limit: PAGE_SIZE }),
    threads.countThreadedEmails(params.folder),
  ]);

  return { emails, totalCount, page };
}

/** `FormData.get` widens to `string | File | null`; these fields are always text. */
function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const mailboxId = decodeURIComponent(params.mailboxId);
  const stub = await requireMailboxStub(context, mailboxId);

  const form = await request.formData();
  const intent = field(form, "intent");
  const emailId = field(form, "emailId");

  switch (intent) {
    case "star":
      await stub.updateEmail(emailId, { starred: form.get("starred") === "true" });
      return { ok: true };

    case "read":
      await stub.updateEmail(emailId, { read: form.get("read") === "true" });
      return { ok: true };

    case "markThreadRead": {
      const threadId = field(form, "threadId");
      if (threadId) await stub.markThreadRead(threadId);
      else await stub.updateEmail(emailId, { read: true });
      return { ok: true };
    }

    case "delete": {
      const deleted = await deleteEmailWithAttachments(context, stub, emailId);
      if (!deleted) return { ok: false, error: "Email not found" };
      // The row sends `redirectTo` when it is the one open in the reading
      // pane; the action cannot see the child route's `:emailId` itself.
      const redirectTo = field(form, "redirectTo");
      if (redirectTo.startsWith("/")) return redirect(redirectTo);
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown intent: ${intent}` };
  }
}

/**
 * The list must NOT refetch when the user selects a different email -- that
 * navigation only changes the child route's `:emailId`. Without this, clicking
 * through a thread list refetches 25 conversations every time.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  currentParams,
  nextParams,
  formMethod,
}: ShouldRevalidateFunctionArgs) {
  // Any mutation can change read state, starred state, or membership. Always
  // revalidate rather than inspecting the action result -- a future action
  // that returns nothing would otherwise silently stop refreshing the list.
  if (formMethod && formMethod !== "GET") return true;
  if (currentParams.folder !== nextParams.folder) return true;
  if (currentParams.mailboxId !== nextParams.mailboxId) return true;
  // Pagination and sort live in the query string.
  return currentUrl.search !== nextUrl.search;
}

// ── Presentation ───────────────────────────────────────────────────

const FOLDER_EMPTY_STATES: Record<
  string,
  {
    icon: React.ReactNode;
    title: string;
    description: string;
    showCompose?: boolean;
  }
> = {
  [Folders.INBOX]: {
    icon: <TrayIcon size={48} weight="thin" className="text-kumo-subtle" />,
    title: "Your inbox is empty",
    description:
      "New emails will appear here when they arrive. Send an email to get the conversation started.",
    showCompose: true,
  },
  [Folders.SENT]: {
    icon: <PaperPlaneTiltIcon size={48} weight="thin" className="text-kumo-subtle" />,
    title: "No sent emails",
    description: "Emails you send will show up here.",
    showCompose: true,
  },
  [Folders.DRAFT]: {
    icon: <FileIcon size={48} weight="thin" className="text-kumo-subtle" />,
    title: "No drafts",
    description: "Emails you're still working on will be saved here.",
    showCompose: true,
  },
  [Folders.ARCHIVE]: {
    icon: <ArchiveIcon size={48} weight="thin" className="text-kumo-subtle" />,
    title: "Archive is empty",
    description: "Move emails here to keep your inbox clean without deleting them.",
  },
  [Folders.TRASH]: {
    icon: <TrashIcon size={48} weight="thin" className="text-kumo-subtle" />,
    title: "Trash is empty",
    description:
      "Deleted emails will appear here. You can restore them or permanently delete them.",
  },
};

function EmailListSkeleton() {
  return (
    <div className="animate-pulse space-y-1 p-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <div className="w-4 h-4 rounded bg-kumo-fill" />
          <div className="w-5 h-5 rounded bg-kumo-fill" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-3 w-24 rounded bg-kumo-fill" />
              <div className="h-3 w-4 rounded bg-kumo-fill" />
              <div className="h-3 flex-1 rounded bg-kumo-fill" />
              <div className="h-3 w-12 rounded bg-kumo-fill" />
            </div>
            <div className="h-2.5 w-3/4 rounded bg-kumo-fill" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FolderEmptyState({ folder, onCompose }: { folder?: string; onCompose: () => void }) {
  const config = (folder && FOLDER_EMPTY_STATES[folder]) || {
    icon: <EnvelopeSimpleIcon size={48} weight="thin" className="text-kumo-subtle" />,
    title: "No emails",
    description: "This folder is empty.",
  };

  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="mb-4">{config.icon}</div>
      <h3 className="text-base font-semibold text-kumo-default mb-1.5">{config.title}</h3>
      <p className="text-sm text-kumo-subtle max-w-xs mb-5">{config.description}</p>
      {"showCompose" in config && config.showCompose && (
        <Button
          variant="primary"
          size="sm"
          icon={<PencilSimpleIcon size={16} />}
          onClick={onCompose}
        >
          Compose
        </Button>
      )}
    </div>
  );
}

function hasUnread(email: Email): boolean {
  if (email.thread_unread_count !== undefined) return email.thread_unread_count > 0;
  return !email.read;
}

function formatParticipants(email: Email): string {
  if (email.participants) {
    const names = email.participants
      .split(",")
      .map((p) => p.trim().split("@")[0])
      .filter((name, idx, arr) => arr.indexOf(name) === idx);
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }
  return email.sender.split("@")[0];
}

/**
 * One row. Extracted so each row can own a `useFetcher`, which gives
 * optimistic star/read state for free: `fetcher.formData` holds the pending
 * submission, and it clears automatically if the action fails -- no cache
 * snapshot or rollback code.
 */
function EmailRow({
  email,
  isSelected,
  isPanelOpen,
  search,
  listPath,
}: {
  email: Email;
  isSelected: boolean;
  isPanelOpen: boolean;
  search: string;
  listPath: string;
}) {
  const fetcher = useFetcher<typeof action>();

  const pendingIntent = fetcher.formData?.get("intent");
  const starred =
    pendingIntent === "star" ? fetcher.formData?.get("starred") === "true" : email.starred;
  const read = pendingIntent === "read" ? fetcher.formData?.get("read") === "true" : email.read;
  const isDeleting = pendingIntent === "delete";

  const unread = pendingIntent === "read" ? !read : hasUnread(email);
  const snippet = getSnippetText(email.snippet);

  if (isDeleting) return null;

  return (
    <div
      className={`group flex items-center gap-3 w-full border-b border-kumo-line px-4 md:px-6 ${
        isPanelOpen ? "md:px-4" : ""
      } ${isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}
    >
      {/* Unread dot */}
      <div className="w-2.5 shrink-0 flex justify-center">
        {unread && <div className="h-2 w-2 rounded-full bg-kumo-brand" />}
      </div>

      {/* Star */}
      <fetcher.Form method="post" className="shrink-0 flex">
        <input type="hidden" name="intent" value="star" />
        <input type="hidden" name="emailId" value={email.id} />
        <input type="hidden" name="starred" value={String(!starred)} />
        <button
          type="submit"
          className="p-0.5 bg-transparent border-0 cursor-pointer"
          aria-label={starred ? "Unstar" : "Star"}
        >
          <StarIcon
            size={16}
            weight={starred ? "fill" : "regular"}
            className={starred ? "text-kumo-warning" : "text-kumo-subtle hover:text-kumo-warning"}
          />
        </button>
      </fetcher.Form>

      {/* Content -- a real anchor, so cmd-click and middle-click work */}
      <Link
        to={{ pathname: email.id, search }}
        prefetch="intent"
        className={`min-w-0 flex-1 block no-underline text-inherit py-2.5 ${
          isPanelOpen ? "md:py-2.5" : "md:py-3"
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm ${
              unread ? "font-semibold text-kumo-default" : "text-kumo-strong"
            }`}
          >
            {formatParticipants(email)}
          </span>
          {(email.thread_count ?? 1) > 1 && (
            <span className="shrink-0 text-xs text-kumo-subtle bg-kumo-fill rounded-full px-1.5 py-0.5 font-medium">
              {email.thread_count}
            </span>
          )}
          {email.has_draft && (
            <span className="shrink-0 text-xs text-kumo-destructive font-medium">Draft</span>
          )}
          {email.needs_reply && !email.has_draft && (
            <Tooltip content="Needs reply" asChild>
              <span className="shrink-0 text-kumo-warning">
                <ArrowBendUpLeftIcon size={14} weight="bold" />
              </span>
            </Tooltip>
          )}
          <span className="text-sm text-kumo-subtle shrink-0 ml-auto">
            {formatListDate(email.date)}
          </span>
        </div>
        <div className="truncate text-sm mt-0.5">
          <span className={unread ? "font-medium text-kumo-default" : "text-kumo-subtle"}>
            {email.subject}
          </span>
          {snippet && <span className="text-kumo-subtle font-normal"> &mdash; {snippet}</span>}
        </div>
      </Link>

      {/* Hover actions */}
      <div className="hidden group-hover:flex items-center shrink-0">
        <fetcher.Form method="post" className="flex">
          <input type="hidden" name="intent" value="read" />
          <input type="hidden" name="emailId" value={email.id} />
          <input type="hidden" name="read" value={String(!read)} />
          <Tooltip content={read ? "Mark unread" : "Mark read"} asChild>
            <Button
              type="submit"
              variant="ghost"
              shape="square"
              size="sm"
              icon={read ? <EnvelopeSimpleIcon size={14} /> : <EnvelopeOpenIcon size={14} />}
              aria-label={read ? "Mark unread" : "Mark read"}
            />
          </Tooltip>
        </fetcher.Form>

        <fetcher.Form
          method="post"
          className="flex"
          onSubmit={(e) => {
            if (!window.confirm("Are you sure you want to delete this email?")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="emailId" value={email.id} />
          {isSelected && <input type="hidden" name="redirectTo" value={`${listPath}${search}`} />}
          <Tooltip content="Delete" asChild>
            <Button
              type="submit"
              variant="ghost"
              shape="square"
              size="sm"
              icon={<TrashIcon size={14} />}
              aria-label="Delete"
            />
          </Tooltip>
        </fetcher.Form>
      </div>
    </div>
  );
}

// ── Route ──────────────────────────────────────────────────────────

export default function EmailListRoute({ loaderData, params }: Route.ComponentProps) {
  const { emails, totalCount, page } = loaderData;
  const { folder } = params;

  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const { startCompose } = useUIStore();

  useRevalidateInterval(POLL_INTERVAL_MS);

  // `useParams` in a parent route does not see descendant params, so read the
  // selected email from the match list instead.
  const matches = useMatches();
  const selectedEmailId =
    (
      matches.find((m) => m.id === EMAIL_DETAIL_ROUTE_ID)?.params as
        | { emailId?: string }
        | undefined
    )?.emailId ?? null;

  const folders = useRouteLoaderData<MailboxLayoutData>(MAILBOX_ROUTE_ID)?.folders ?? [];
  const folderName = useMemo(() => {
    const found = folders.find((f) => f.id === folder);
    if (found) return found.name;
    return folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : "Inbox";
  }, [folders, folder]);

  const isRefreshing = revalidator.state !== "idle" || navigation.state === "loading";
  const isChangingFolder =
    navigation.state === "loading" && navigation.location?.pathname.includes("/emails/");
  const isPanelOpen = selectedEmailId !== null;
  const search = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const listPath = `/mailbox/${encodeURIComponent(params.mailboxId)}/emails/${folder}`;

  const setPage = (next: number) => {
    setSearchParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        if (next <= 1) nextParams.delete("page");
        else nextParams.set("page", String(next));
        return nextParams;
      },
      { preventScrollReset: true },
    );
  };

  return (
    <MailboxSplitView>
      {/* Folder header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-kumo-line shrink-0 md:px-5">
        <h1 className="text-lg font-semibold text-kumo-default">{folderName}</h1>
        <div className="flex items-center gap-1">
          {totalCount > 0 && (
            <span className="text-sm text-kumo-subtle mr-2 hidden sm:inline">
              {totalCount} conversation{totalCount !== 1 ? "s" : ""}
            </span>
          )}
          <Tooltip content={isRefreshing ? "Refreshing..." : "Refresh"} side="bottom" asChild>
            <Button
              variant="ghost"
              shape="square"
              size="sm"
              icon={
                <ArrowsClockwiseIcon size={18} className={isRefreshing ? "animate-spin" : ""} />
              }
              onClick={() => void revalidator.revalidate()}
              disabled={isRefreshing}
              aria-label="Refresh"
            />
          </Tooltip>
        </div>
      </div>

      {/* Email rows */}
      <div className="flex-1 overflow-y-auto">
        {isChangingFolder && emails.length === 0 ? (
          <EmailListSkeleton />
        ) : emails.length > 0 ? (
          <div>
            {emails.map((email) => (
              <EmailRow
                key={email.id}
                email={email}
                isSelected={selectedEmailId === email.id}
                isPanelOpen={isPanelOpen}
                search={search}
                listPath={listPath}
              />
            ))}
          </div>
        ) : (
          <FolderEmptyState folder={folder} onCompose={() => startCompose()} />
        )}
      </div>

      {/* Pagination */}
      {totalCount > PAGE_SIZE && (
        <div className="flex justify-center py-3 border-t border-kumo-line shrink-0">
          <Pagination page={page} setPage={setPage} perPage={PAGE_SIZE} totalCount={totalCount} />
        </div>
      )}
    </MailboxSplitView>
  );
}
