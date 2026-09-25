// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { create } from "zustand";

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

export const useUIStore = create<UIState>((set, get) => ({
  isSidebarOpen: false,
  isAgentPanelOpen: true,

  closeSidebar: () => set({ isSidebarOpen: false }),
  toggleSidebar: () => set({ isSidebarOpen: !get().isSidebarOpen }),

  toggleAgentPanel: () => set({ isAgentPanelOpen: !get().isAgentPanelOpen }),
}));
