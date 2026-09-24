// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Route ids for `useRoute` and `useMatches` lookups. Kept apart from the
 * route modules so components can name a route without importing it.
 */
export const MAILBOX_ROUTE_ID = "routes/mailbox/$mailboxId/_layout";
export const FOLDER_EMAIL_ROUTE_ID = "routes/mailbox/$mailboxId/emails/$folder/$emailId";
export const SEARCH_EMAIL_ROUTE_ID = "routes/mailbox/$mailboxId/search/$emailId";
