// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ReactNode } from "react";
import { useOutlet } from "react-router";
import ComposePanel from "~/components/ComposePanel";
import EmailPanelQuery from "~/components/EmailPanelQuery";
import { useUIStore } from "~/hooks/useUIStore";

interface MailboxSplitViewProps {
  /**
   * Legacy selection, still used by the search results route. The email list
   * route drives the reading pane through a nested route instead, which this
   * component picks up via `useOutlet`.
   */
  selectedEmailId?: string | null;
  isComposing?: boolean;
  children: ReactNode;
}

export default function MailboxSplitView({
  selectedEmailId = null,
  isComposing: isComposingProp,
  children,
}: MailboxSplitViewProps) {
  const outlet = useOutlet();
  const isComposingStore = useUIStore((s) => s.isComposing);
  const isComposing = isComposingProp ?? isComposingStore;

  const detail = outlet ?? (selectedEmailId ? <EmailPanelQuery emailId={selectedEmailId} /> : null);
  const isPanelOpen = detail !== null || isComposing;

  return (
    <div className="flex h-full">
      <div
        className={`flex flex-col min-w-0 shrink-0 ${
          isPanelOpen ? "hidden md:flex md:w-[380px] md:border-r md:border-kumo-line" : "w-full"
        }`}
      >
        {children}
      </div>
      {isPanelOpen && (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full md:w-auto">
          {isComposing && !detail ? (
            <ComposePanel />
          ) : isComposing && detail ? (
            <div className="flex flex-col h-full overflow-y-auto">
              <ComposePanel />
              <div className="border-t border-kumo-line">{detail}</div>
            </div>
          ) : (
            detail
          )}
        </div>
      )}
    </div>
  );
}
