// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Empty, LinkButton } from "@cloudflare/kumo";
import { WarningIcon } from "@phosphor-icons/react";
import { isRouteErrorResponse } from "react-router";

/** Error boundary body for an email detail route, drawn inside the reading pane. */
export default function EmailDetailError({
  error,
  listPath,
}: {
  error: unknown;
  listPath: string;
}) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="flex items-center justify-center h-full p-8">
      <Empty
        icon={<WarningIcon size={48} className="text-kumo-inactive" />}
        title={notFound ? "Email not found" : "Couldn't load this email"}
        description={
          notFound
            ? "It may have been moved or deleted."
            : "Something went wrong while loading it. Try again in a moment."
        }
        contents={
          <LinkButton href={listPath} variant="secondary" size="sm">
            Back to list
          </LinkButton>
        }
      />
    </div>
  );
}
