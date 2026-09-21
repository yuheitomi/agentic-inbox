// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

/**
 * Re-run the matched route chain's loaders on an interval.
 *
 * Framework mode has no equivalent of TanStack Query's `refetchInterval`:
 * loaders only run on navigation and after actions. Inbound mail and
 * agent-generated drafts arrive with no user action, so the list has to poll.
 *
 * This is coarser than refetching a single query -- it revalidates every
 * loader in the chain. Skips ticks while a revalidation is already in flight
 * or the tab is hidden.
 */
export function useRevalidateInterval(intervalMs: number) {
  const revalidator = useRevalidator();
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;

  useEffect(() => {
    const id = setInterval(() => {
      const current = revalidatorRef.current;
      if (current.state !== "idle") return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void current.revalidate();
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);

  return revalidator.state !== "idle";
}
