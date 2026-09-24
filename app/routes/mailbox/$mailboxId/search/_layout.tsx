// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, LinkButton, Loader, Pagination, Tooltip } from "@cloudflare/kumo";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  href,
  Link,
  useMatches,
  useNavigation,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { Folders } from "shared/folders";
import MailboxSplitView from "~/components/MailboxSplitView";
import { withoutCompose } from "~/lib/compose";
import { revalidateOn } from "~/lib/revalidation";
import { SEARCH_EMAIL_ROUTE_ID } from "~/lib/route-ids";
import { parseSearchQuery } from "~/lib/search-parser";
import { formatListDate, getSnippetText } from "~/lib/utils";
import { ok, serverApi } from "~/services/api.server";
import type { Email } from "~/types";
import type { Route } from "./+types/_layout";

const SEARCH_PAGE_SIZE = 25;

/**
 * Results for `?q`, a page at a time (`?page`). The query string is the whole
 * search state, so a results page can be refreshed, shared, or gone back to.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const rawPage = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  if (!q) return { q, page, results: [], totalCount: 0 };

  const parsed = parseSearchQuery(q);
  const { emails, totalCount } = await ok(
    serverApi(context, request).mailboxes[":mailboxId"].search.$get({
      param: { mailboxId: params.mailboxId },
      query: {
        page,
        limit: SEARCH_PAGE_SIZE,
        ...(parsed.query && { query: parsed.query }),
        ...(parsed.from && { from: parsed.from }),
        ...(parsed.to && { to: parsed.to }),
        ...(parsed.subject && { subject: parsed.subject }),
        ...(parsed.folder && { folder: parsed.folder }),
        ...(parsed.date_start && { date_start: parsed.date_start }),
        ...(parsed.date_end && { date_end: parsed.date_end }),
        ...(parsed.is_read !== undefined && { is_read: parsed.is_read }),
        ...(parsed.is_starred !== undefined && { is_starred: parsed.is_starred }),
        ...(parsed.has_attachment && { has_attachment: true }),
      },
    }),
  );
  return { q, page, results: emails, totalCount };
}

/** Opening a result or the composer keeps the result list; a new query or page reloads it. */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return revalidateOn(args, { params: ["mailboxId"], search: ["q", "page"] });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.q ? `“${loaderData.q}”` : "Search"} — Agentic Inbox` }];
}

function highlightTerms(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const freeText = query
    .replace(/\b(?:from|to|subject|in|is|has|before|after):"[^"]*"/gi, "")
    .replace(/\b(?:from|to|subject|in|is|has|before|after):\S+/gi, "")
    .trim();
  if (!freeText) return text;
  try {
    const escaped = freeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(regex);
    if (parts.length === 1) return text;
    // Use case-insensitive string comparison instead of regex.test() with g flag,
    // which has stateful lastIndex causing alternating true/false results.
    const lowerEscaped = escaped.toLowerCase();
    return parts.map((part, i) =>
      part.toLowerCase() === lowerEscaped ? (
        <mark key={i} className="bg-kumo-warning-muted text-kumo-default rounded-sm px-0.5">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  } catch {
    return text;
  }
}

export default function SearchResultsRoute({ loaderData, params }: Route.ComponentProps) {
  const { q: urlQuery, page: currentPage, results, totalCount } = loaderData;
  const { mailboxId } = params;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();

  // `useParams` in a parent route does not see descendant params, so read the
  // selected result from the match list instead.
  const selectedEmailId =
    (
      useMatches().find((m) => m.id === SEARCH_EMAIL_ROUTE_ID)?.params as
        | { emailId?: string }
        | undefined
    )?.emailId ?? null;
  const isPanelOpen = selectedEmailId !== null;
  // A new query is on its way: show that rather than the results it replaces.
  const pendingQuery =
    navigation.state === "loading" && navigation.location.pathname.endsWith("/search")
      ? new URLSearchParams(navigation.location.search).get("q")?.trim()
      : undefined;
  const isLoading = pendingQuery !== undefined && pendingQuery !== urlQuery;
  // Results open in place of any open composer, like rows in a folder.
  const search = withoutCompose(searchParams);

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

  const folderDisplayName = (name: string | null | undefined): string => {
    if (!name) return "";
    const map: Record<string, string> = {
      inbox: "Inbox",
      sent: "Sent",
      draft: "Drafts",
      archive: "Archive",
      trash: "Trash",
    };
    return map[name.toLowerCase()] || name;
  };

  return (
    <MailboxSplitView>
      <>
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-kumo-line shrink-0 md:px-5">
          <Tooltip content="Back to inbox" side="bottom" asChild>
            <LinkButton
              href={href("/mailbox/:mailboxId/emails/:folder", {
                mailboxId,
                folder: Folders.INBOX,
              })}
              variant="ghost"
              shape="square"
              size="sm"
              icon={<ArrowLeftIcon size={18} />}
              aria-label="Back to inbox"
            />
          </Tooltip>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-kumo-default truncate">Search Results</h1>
            {!isLoading && (
              <span className="text-sm text-kumo-subtle">
                {totalCount} result{totalCount !== 1 ? "s" : ""}
                {urlQuery ? ` for "${urlQuery}"` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader size="lg" />
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
              <div className="mb-4">
                <MagnifyingGlassIcon size={48} weight="thin" className="text-kumo-subtle" />
              </div>
              <h3 className="text-base font-semibold text-kumo-default mb-1.5">No results found</h3>
              <p className="text-sm text-kumo-subtle max-w-xs">
                {urlQuery
                  ? `Nothing matched "${urlQuery}". Try different keywords or check your spelling.`
                  : "Enter a search term to find emails by subject, sender, or content."}
              </p>
              {urlQuery && (
                <p className="text-xs text-kumo-subtle mt-3 max-w-sm">
                  Tip: Use operators like{" "}
                  <code className="bg-kumo-tint px-1 rounded">from:name</code>,{" "}
                  <code className="bg-kumo-tint px-1 rounded">is:unread</code>,{" "}
                  <code className="bg-kumo-tint px-1 rounded">has:attachment</code>,{" "}
                  <code className="bg-kumo-tint px-1 rounded">before:2025-01-01</code>
                </p>
              )}
            </div>
          ) : (
            <div>
              {results.map((email) => {
                const isSelected = selectedEmailId === email.id;
                const snippet = getSnippetText(email.snippet, 120);
                const folderName = (email as Email & { folder_name?: string }).folder_name;
                return (
                  <Link
                    key={email.id}
                    to={{ pathname: email.id, search }}
                    prefetch="intent"
                    className={`group flex items-center gap-3 w-full text-left no-underline text-inherit transition-colors border-b border-kumo-line px-4 py-2.5 md:px-5 md:py-3 ${isPanelOpen ? "md:px-4 md:py-2.5" : ""} ${isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}
                  >
                    <div className="w-2.5 shrink-0 flex justify-center">
                      {!email.read && <div className="h-2 w-2 rounded-full bg-kumo-brand" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate text-sm ${!email.read ? "font-semibold text-kumo-default" : "text-kumo-strong"}`}
                        >
                          {highlightTerms(email.sender.split("@")[0], urlQuery)}
                        </span>
                        {folderName && (
                          <Badge variant="outline">{folderDisplayName(folderName)}</Badge>
                        )}
                        <span className="text-sm text-kumo-subtle shrink-0 ml-auto">
                          {formatListDate(email.date)}
                        </span>
                      </div>
                      <div
                        className={`truncate text-sm mt-0.5 ${!email.read ? "font-medium text-kumo-default" : "text-kumo-subtle"}`}
                      >
                        {highlightTerms(email.subject, urlQuery)}
                      </div>
                      {snippet && (
                        <div className="truncate text-xs text-kumo-subtle mt-0.5">
                          {highlightTerms(snippet, urlQuery)}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        {totalCount > SEARCH_PAGE_SIZE && (
          <div className="flex justify-center py-3 border-t border-kumo-line shrink-0">
            <Pagination
              page={currentPage}
              setPage={setPage}
              perPage={SEARCH_PAGE_SIZE}
              totalCount={totalCount}
            />
          </div>
        )}
      </>
    </MailboxSplitView>
  );
}
