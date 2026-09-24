// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ShouldRevalidateFunctionArgs } from "react-router";

/**
 * `shouldRevalidate` for a loader that reads only some of the URL.
 *
 * Mutations and explicit `revalidate()` calls (same URL in and out) always
 * defer to React Router's default, so polling, the refresh button and every
 * action keep the data fresh. A plain navigation re-runs the loader only when
 * one of the params it names, or one of the search keys it names, changed.
 */
export function revalidateOn(
  args: ShouldRevalidateFunctionArgs,
  deps: { params?: readonly string[]; search?: readonly string[] },
): boolean {
  const { currentUrl, nextUrl, currentParams, nextParams, formMethod } = args;
  if (formMethod && formMethod !== "GET") return args.defaultShouldRevalidate;
  if (currentUrl.href === nextUrl.href) return args.defaultShouldRevalidate;

  const paramChanged = (deps.params ?? []).some((key) => currentParams[key] !== nextParams[key]);
  const searchChanged = (deps.search ?? []).some(
    (key) => currentUrl.searchParams.get(key) !== nextUrl.searchParams.get(key),
  );
  return paramChanged || searchChanged;
}
