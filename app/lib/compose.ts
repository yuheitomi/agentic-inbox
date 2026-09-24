// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The composer lives in the URL: `?compose=<mode>` opens it over whatever
 * list or reading pane is showing, `original` names the message a reply or
 * forward quotes, and `draft` names the draft being edited. Refreshing,
 * sharing the link, or going back and forward all restore it.
 */

import type { Email } from "~/types";

export const COMPOSE_MODES = ["new", "reply", "reply-all", "forward", "draft"] as const;
export type ComposeMode = (typeof COMPOSE_MODES)[number];

const COMPOSE_KEYS = ["compose", "original", "draft"] as const;

/** The search keys the mailbox layout loader reads. */
export const COMPOSE_SEARCH_KEYS: readonly string[] = COMPOSE_KEYS;

/** Fetcher key shared by the composer and the layout that reports its outcome. */
export const COMPOSE_FETCHER_KEY = "compose";

export interface ComposeParams {
  mode: ComposeMode;
  original?: string;
  draft?: string;
}

/** What the composer starts from, as the mailbox layout loader resolves it. */
export interface ComposeState {
  mode: ComposeMode;
  /** The message a reply answers or a forward quotes. */
  original: Email | null;
  /** The draft being edited. */
  draft: Email | null;
}

export function parseCompose(search: URLSearchParams): ComposeParams | null {
  const mode = search.get("compose");
  if (!mode || !(COMPOSE_MODES as readonly string[]).includes(mode)) return null;
  return {
    mode: mode as ComposeMode,
    original: search.get("original") || undefined,
    draft: search.get("draft") || undefined,
  };
}

/** `search` with any composer state removed, as a `?...` string or "". */
export function withoutCompose(search: string | URLSearchParams): string {
  const next = new URLSearchParams(search);
  for (const key of COMPOSE_KEYS) next.delete(key);
  const out = next.toString();
  return out ? `?${out}` : "";
}

/** `search` with the composer opened as `params`, as a `?...` string. */
export function withCompose(search: string | URLSearchParams, params: ComposeParams): string {
  const next = new URLSearchParams(withoutCompose(search));
  next.set("compose", params.mode);
  if (params.original) next.set("original", params.original);
  if (params.draft) next.set("draft", params.draft);
  return `?${next.toString()}`;
}

/**
 * Where to open the composer from `location`: over the folder list or search
 * results on screen, or over the inbox from a page with no reading pane
 * (settings).
 */
export function composeHref(
  location: { pathname: string; search: string },
  mailboxId: string,
  params: ComposeParams,
): string {
  if (/\/(emails|search)(\/|$)/.test(location.pathname)) {
    return `${location.pathname}${withCompose(location.search, params)}`;
  }
  const inbox = `/mailbox/${encodeURIComponent(mailboxId)}/emails/inbox`;
  return `${inbox}${withCompose("", params)}`;
}
