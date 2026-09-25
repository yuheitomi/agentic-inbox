// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect } from "react";
import { Outlet, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import AgentSidebar from "~/components/AgentSidebar";
import { EMAIL_PANEL_FETCHER_KEY } from "~/components/EmailPanel";
import Header from "~/components/Header";
import Sidebar, { FOLDER_FETCHER_KEY } from "~/components/Sidebar";
import { useSubmissionToast } from "~/hooks/useSubmissionToast";
import { UIStoreProvider, useUIStore } from "~/hooks/useUIStore";
import {
  COMPOSE_FETCHER_KEY,
  COMPOSE_SEARCH_KEYS,
  type ComposeParams,
  type ComposeState,
  parseCompose,
} from "~/lib/compose";
import { revalidateOn } from "~/lib/revalidation";
import { ok, type RpcClient, serverApi } from "~/services/api.server";
import type { Email } from "~/types";
import type { Route } from "./+types/_layout";

/**
 * Resolve `?compose=...` to the messages the composer starts from. A link to
 * a message that no longer exists opens a blank composer rather than failing
 * the whole mailbox.
 */
async function loadCompose(
  api: RpcClient,
  mailboxId: string,
  params: ComposeParams | null,
): Promise<ComposeState | null> {
  if (!params) return null;

  const get = async (id: string | null | undefined): Promise<Email | null> => {
    if (!id) return null;
    const res = await api.mailboxes[":mailboxId"].emails[":id"].$get({ param: { mailboxId, id } });
    return res.ok ? await res.json() : null;
  };

  if (params.mode === "draft") {
    const draft = await get(params.draft);
    if (!draft) return { mode: "new", original: null, draft: null };
    return { mode: "draft", original: await get(draft.in_reply_to), draft };
  }

  const original = params.mode === "new" ? null : await get(params.original);
  return { mode: original ? params.mode : "new", original, draft: null };
}

/**
 * The mailbox record and folder list the chrome needs, plus the composer's
 * starting point when `?compose` is set. Every call goes through the
 * in-process RPC client, so none of them leave the isolate.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { mailboxId } = params;
  const api = serverApi(context, request);
  const param = { mailboxId };

  const [mailbox, folders, compose] = await Promise.all([
    ok(api.mailboxes[":mailboxId"].$get({ param })),
    ok(api.mailboxes[":mailboxId"].folders.$get({ param })),
    loadCompose(api, mailboxId, parseCompose(new URL(request.url).searchParams)),
  ]);

  return { mailbox, folders, compose };
}

/**
 * Selecting an email, paging, or switching folders leaves the mailbox and its
 * folder list as they were. Mutations still refresh it (unread counts), and so
 * does opening or closing the composer.
 */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return revalidateOn(args, { params: ["mailboxId"], search: COMPOSE_SEARCH_KEYS });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.mailbox.email} — Agentic Inbox` : "Agentic Inbox" }];
}

/**
 * Report mutations whose form unmounts when they succeed: a sent message
 * closes the composer, a moved email closes the reading pane.
 */
function useMailboxToasts() {
  useSubmissionToast(useFetcher({ key: COMPOSE_FETCHER_KEY }), {
    send: "Email sent!",
    saveDraft: "Draft saved!",
  });
  useSubmissionToast(useFetcher({ key: EMAIL_PANEL_FETCHER_KEY }), {
    sendDraft: "Email sent!",
    discardDraft: "Draft discarded",
  });
  useSubmissionToast(useFetcher({ key: FOLDER_FETCHER_KEY }), {
    createFolder: "Folder created",
  });
}

export default function MailboxRoute({ params }: Route.ComponentProps) {
  return (
    <UIStoreProvider>
      <MailboxChrome mailboxId={params.mailboxId} />
    </UIStoreProvider>
  );
}

function MailboxChrome({ mailboxId }: { mailboxId: string }) {
  const { isSidebarOpen, closeSidebar, isAgentPanelOpen } = useUIStore();
  useMailboxToasts();

  // The mobile sidebar is an overlay; switching mailboxes should not leave it open.
  useEffect(() => {
    closeSidebar();
  }, [mailboxId, closeSidebar]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar overlay backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={closeSidebar}
          onKeyDown={(e) => e.key === "Escape" && closeSidebar()}
          role="button"
          tabIndex={-1}
          aria-label="Close sidebar"
        />
      )}

      {/* Sidebar: hidden on mobile by default, shown as overlay when open */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 md:z-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 bg-kumo-base">
        <Header />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      {/* Agent + MCP sidebar -- togglable on desktop */}
      {isAgentPanelOpen && (
        <div className="hidden lg:flex w-95 shrink-0 border-l border-kumo-line flex-col bg-kumo-base overflow-hidden">
          <AgentSidebar />
        </div>
      )}
    </div>
  );
}
