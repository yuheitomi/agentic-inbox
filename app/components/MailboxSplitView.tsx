// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ReactNode } from "react";
import { useOutlet } from "react-router";
import ComposePanel from "~/components/ComposePanel";
import { useMailboxData } from "~/hooks/useMailboxData";

/**
 * A list with its reading pane beside it. The pane is the nested route's
 * outlet (the open email), the composer (`?compose`), or both stacked.
 */
export default function MailboxSplitView({ children }: { children: ReactNode }) {
  const detail = useOutlet();
  const { compose } = useMailboxData();

  // Keyed on what the composer starts from, so opening another reply or draft
  // starts a fresh form instead of keeping the last one's fields.
  const composer = compose && (
    <ComposePanel
      key={`${compose.mode}:${compose.original?.id ?? ""}:${compose.draft?.id ?? ""}`}
      compose={compose}
    />
  );
  const isPanelOpen = detail !== null || composer !== null;

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
          {composer && detail ? (
            <div className="flex flex-col h-full overflow-y-auto">
              {composer}
              <div className="border-t border-kumo-line">{detail}</div>
            </div>
          ) : (
            (composer ?? detail)
          )}
        </div>
      )}
    </div>
  );
}
