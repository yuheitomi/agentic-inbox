// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";
import { Outlet, useParams } from "react-router";
import AgentSidebar from "~/components/AgentSidebar";
import ComposeEmail from "~/components/ComposeEmail";
import Header from "~/components/Header";
import Sidebar from "~/components/Sidebar";
import { useUIStore } from "~/hooks/useUIStore";
import { requireMailbox } from "~/lib/mailbox.server";
import type { Folder, Mailbox } from "~/types";
import type { Route } from "./+types/_layout";

/** Route id for `useRouteLoaderData` in descendants. */
export const MAILBOX_ROUTE_ID = "routes/mailbox/$mailboxId/_layout";

export interface MailboxLayoutData {
  mailbox: Mailbox;
  folders: Folder[];
}

/**
 * Loads the mailbox record and its folder list -- the data the sidebar needs.
 * Runs in the Worker, so it calls the Durable Object directly rather than
 * fetching `/api/v1/mailboxes/:id` back through the network.
 */
export async function loader({ params, context }: Route.LoaderArgs): Promise<MailboxLayoutData> {
  const mailboxId = decodeURIComponent(params.mailboxId);
  const { stub, settings } = await requireMailbox(context, mailboxId);
  const folders = (await stub.getFolders()) as Folder[];

  return {
    mailbox: { id: mailboxId, email: mailboxId, name: mailboxId, settings },
    folders,
  };
}

export default function MailboxRoute() {
  const { mailboxId } = useParams<{ mailboxId: string }>();
  const prevMailboxIdRef = useRef<string | undefined>(undefined);
  const { isSidebarOpen, closeSidebar, isAgentPanelOpen, closePanel, closeComposeModal } =
    useUIStore();

  useEffect(() => {
    if (prevMailboxIdRef.current && mailboxId && prevMailboxIdRef.current !== mailboxId) {
      closePanel();
      closeComposeModal();
      closeSidebar();
    }

    prevMailboxIdRef.current = mailboxId;
  }, [mailboxId, closeComposeModal, closePanel, closeSidebar]);

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

      <ComposeEmail />
    </div>
  );
}
