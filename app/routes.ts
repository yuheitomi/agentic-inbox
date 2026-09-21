// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { autoRoutes } from "react-router-auto-routes";

// File-based routing: `app/routes/**` defines the route table. `_layout.tsx`
// is the only file that creates nesting, `$name` marks a dynamic segment.
export default autoRoutes();
