// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { createContext } from "react-router";
import type { Env } from "../workers/types";

/**
 * Router context holding the Worker's environment bindings.
 *
 * Defined here rather than in `workers/app.ts` so route modules can read it
 * from a loader without pulling the whole Hono app into the client bundle.
 * Everything this module imports is type-only, so it erases at build time.
 */
export const cloudflareContext = createContext<{
  env: Env;
  ctx: ExecutionContext;
}>();
