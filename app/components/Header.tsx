// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, LinkButton, Tooltip } from "@cloudflare/kumo";
import {
  GearSixIcon,
  ListIcon,
  MagnifyingGlassIcon,
  RobotIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type KeyboardEvent, useState } from "react";
import { Form, href, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Folders } from "shared/folders";
import { useUIStore } from "~/hooks/useUIStore";

export default function Header() {
  const { mailboxId = "" } = useParams<{ mailboxId: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { toggleSidebar, toggleAgentPanel, isAgentPanelOpen } = useUIStore();
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  // On the results page the box shows the query it ran; keyed on it so going
  // back to an earlier search refills the box instead of keeping stale text.
  const onSearchPage = location.pathname.includes("/search");
  const urlQuery = onSearchPage ? searchParams.get("q") || "" : "";

  const inboxHref = href("/mailbox/:mailboxId/emails/:folder", {
    mailboxId,
    folder: Folders.INBOX,
  });
  const isSettingsActive = location.pathname.includes("/settings");

  return (
    <header className="flex items-center gap-2 px-3 py-2.5 bg-kumo-base border-b border-kumo-line sticky top-0 z-10 md:px-5 md:gap-4">
      {/* Hamburger menu - mobile only */}
      <Button
        variant="ghost"
        shape="square"
        size="sm"
        icon={<ListIcon size={20} />}
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
        className="md:hidden shrink-0"
      />

      {/* Search - full on desktop, collapsible on mobile */}
      <SearchBox
        key={urlQuery}
        action={href("/mailbox/:mailboxId/search", { mailboxId })}
        initialQuery={urlQuery}
        clearHref={onSearchPage ? inboxHref : null}
        isExpanded={isSearchExpanded}
        onCollapse={() => setIsSearchExpanded(false)}
      />

      {/* Search toggle button - mobile only, hidden when search is expanded */}
      {!isSearchExpanded && (
        <Button
          variant="ghost"
          shape="square"
          size="sm"
          icon={<MagnifyingGlassIcon size={20} />}
          onClick={() => setIsSearchExpanded(true)}
          aria-label="Search"
          className="md:hidden shrink-0"
        />
      )}

      <div className="flex items-center gap-1 ml-auto shrink-0">
        <Tooltip
          content={isAgentPanelOpen ? "Hide agent panel" : "Show agent panel"}
          side="bottom"
          asChild
        >
          <Button
            variant={isAgentPanelOpen ? "secondary" : "ghost"}
            shape="square"
            icon={<RobotIcon size={20} />}
            onClick={toggleAgentPanel}
            aria-label="Toggle agent panel"
            className="hidden lg:inline-flex"
          />
        </Tooltip>
        <Tooltip content="Settings" side="bottom" asChild>
          <LinkButton
            href={
              isSettingsActive ? inboxHref : href("/mailbox/:mailboxId/settings", { mailboxId })
            }
            variant={isSettingsActive ? "secondary" : "ghost"}
            shape="square"
            icon={<GearSixIcon size={20} />}
            aria-label="Settings"
          />
        </Tooltip>
      </div>
    </header>
  );
}

/**
 * The search box: a GET form to the results route, so submitting it is an
 * ordinary navigation to `/search?q=...` that works before hydration too.
 */
function SearchBox({
  action,
  initialQuery,
  clearHref,
  isExpanded,
  onCollapse,
}: {
  action: string;
  initialQuery: string;
  /** Where clearing the box goes: back to the inbox from the results page, else nowhere. */
  clearHref: string | null;
  isExpanded: boolean;
  onCollapse: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);

  const clear = () => {
    setQuery("");
    if (clearHref) void navigate(clearHref);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (query) clear();
    else onCollapse();
  };

  return (
    <Form
      method="get"
      action={action}
      role="search"
      onSubmit={(e) => {
        if (!query.trim()) e.preventDefault();
        else onCollapse();
      }}
      className={`flex-1 max-w-lg transition-all flex items-center gap-1 ${
        isExpanded ? "flex" : "hidden md:flex"
      }`}
    >
      <div className="flex-1 relative flex items-center">
        <Input
          className="w-full"
          name="q"
          aria-label="Search emails"
          placeholder="Search emails... (try from:name, is:unread, has:attachment)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors"
            aria-label="Clear search"
          >
            <XIcon size={14} />
          </button>
        )}
      </div>
      <Tooltip content="Search" side="bottom" asChild>
        <Button
          type="submit"
          variant="ghost"
          shape="square"
          icon={<MagnifyingGlassIcon size={20} />}
          aria-label="Search"
        />
      </Tooltip>
    </Form>
  );
}
