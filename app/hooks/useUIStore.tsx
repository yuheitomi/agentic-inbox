// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

/**
 * Chrome toggles that belong to no route: the mobile sidebar and the agent
 * panel. Everything with meaning in the URL -- the open email, the composer,
 * search and pagination -- lives there instead.
 */
interface UIState {
  isSidebarOpen: boolean;
  closeSidebar: () => void;
  toggleSidebar: () => void;

  isAgentPanelOpen: boolean;
  toggleAgentPanel: () => void;
}

const UIContext = createContext<UIState | null>(null);

/** Holds the chrome toggles for everything rendered inside the mailbox layout. */
export function UIStoreProvider({ children }: { children: ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(true);

  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setIsSidebarOpen((open) => !open), []);
  const toggleAgentPanel = useCallback(() => setIsAgentPanelOpen((open) => !open), []);

  const value = useMemo(
    () => ({ isSidebarOpen, closeSidebar, toggleSidebar, isAgentPanelOpen, toggleAgentPanel }),
    [isSidebarOpen, closeSidebar, toggleSidebar, isAgentPanelOpen, toggleAgentPanel],
  );

  return <UIContext value={value}>{children}</UIContext>;
}

export function useUIStore(): UIState {
  const state = useContext(UIContext);
  if (!state) throw new Error("useUIStore must be used inside <UIStoreProvider>");
  return state;
}
