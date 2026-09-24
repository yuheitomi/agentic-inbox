// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { data } from "react-router";

/**
 * Unmatched URLs. Throwing from the loader, rather than rendering a "not
 * found" page, answers with a real 404 status and lets the root error
 * boundary draw the page.
 */
export function loader() {
  throw data(null, { status: 404, statusText: "Not Found" });
}

/**
 * Never rendered -- the loader always throws. Exporting a component keeps this
 * a UI route, so a document request gets the root error page rather than a
 * bare resource-route 404.
 */
export default function NotFoundRoute() {
  return null;
}
