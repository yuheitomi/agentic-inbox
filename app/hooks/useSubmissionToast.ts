// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { useEffect, useRef } from "react";

interface SubmissionLike {
  state: "idle" | "loading" | "submitting";
  formData?: FormData;
  data?: unknown;
}

function failureOf(data: unknown): string | null {
  if (data && typeof data === "object" && "ok" in data && data.ok === false) {
    return "error" in data && typeof data.error === "string" ? data.error : "Something went wrong";
  }
  return null;
}

/**
 * Toast the outcome of a fetcher submission once it settles.
 *
 * A failure is the `{ ok: false, error }` an action answers with. Anything
 * else -- data or a redirect -- is a success, announced with the message for
 * the submitted `intent` if there is one. Submissions that redirect usually
 * unmount the form that sent them, so pass a keyed fetcher from a component
 * that outlives it.
 */
export function useSubmissionToast(
  fetcher: SubmissionLike,
  successMessages: Partial<Record<string, string>>,
) {
  const toastManager = useKumoToastManager();
  const pendingIntent = useRef<string | null>(null);
  const messages = useRef(successMessages);
  messages.current = successMessages;

  useEffect(() => {
    if (fetcher.state !== "idle") {
      const intent = fetcher.formData?.get("intent");
      if (typeof intent === "string") pendingIntent.current = intent;
      return;
    }
    const intent = pendingIntent.current;
    if (intent === null) return;
    pendingIntent.current = null;

    const error = failureOf(fetcher.data);
    if (error) {
      toastManager.add({ title: error, variant: "error" });
      return;
    }
    const message = messages.current[intent];
    if (message) toastManager.add({ title: message });
  }, [fetcher.state, fetcher.formData, fetcher.data, toastManager]);
}
