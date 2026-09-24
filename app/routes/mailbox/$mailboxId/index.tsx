// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { href, redirect } from "react-router";
import { Folders } from "shared/folders";
import type { Route } from "./+types/index";

/** A mailbox opens on its inbox; redirecting here means the first response is already it. */
export function loader({ params, request }: Route.LoaderArgs) {
  const inbox = href("/mailbox/:mailboxId/emails/:folder", {
    mailboxId: params.mailboxId,
    folder: Folders.INBOX,
  });
  // Keep the query string so `/mailbox/x?compose=new` still opens the composer.
  throw redirect(`${inbox}${new URL(request.url).search}`);
}
