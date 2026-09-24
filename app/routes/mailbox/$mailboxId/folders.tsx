// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Folder management, submitted from the sidebar. A resource route with no UI:
 * posting to the mailbox layout's own URL would target its index route.
 */

import { type ActionResult, field, result, serverApi } from "~/services/api.server";
import type { Route } from "./+types/folders";

export async function action({
  params,
  request,
  context,
}: Route.ActionArgs): Promise<ActionResult> {
  const api = serverApi(context, request);
  const form = await request.formData();
  const intent = field(form, "intent");

  switch (intent) {
    case "createFolder":
      return result(
        api.mailboxes[":mailboxId"].folders.$post({
          param: { mailboxId: params.mailboxId },
          json: { name: field(form, "name").trim() },
        }),
        "Failed to create folder",
      );

    default:
      return { ok: false, error: `Unknown intent: ${intent}` };
  }
}
