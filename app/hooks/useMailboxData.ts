// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { unstable_useRoute as useRoute } from "react-router";
import { MAILBOX_ROUTE_ID } from "~/lib/route-ids";

/**
 * The mailbox layout's loader data: the mailbox record, its folders, and the
 * composer's state. Only valid below `/mailbox/:mailboxId`, where that layout
 * is always matched.
 */
export function useMailboxData() {
  const loaderData = useRoute(MAILBOX_ROUTE_ID)?.loaderData;
  if (!loaderData) throw new Error("useMailboxData must be used inside the mailbox layout");
  return loaderData;
}
