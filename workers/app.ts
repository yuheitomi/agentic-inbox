// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { routeAgentRequest } from "agents";
import { createMcpHandler, type StatelessMcpHandler } from "agents/mcp/server";
import { Hono } from "hono";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "../app/context";
import { app as apiApp, receiveEmail } from "./index";
import { createEmailMcpServer } from "./mcp";
import type { Env } from "./types";

export { MailboxDO } from "./durableObject";
export { EmailAgent } from "./agent";

/**
 * Re-exported for callers that already import it from here. The context itself
 * lives in `app/context.ts` so route modules can read it in a loader without
 * importing this file (and with it, the entire Hono app).
 */
export { cloudflareContext };

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

function getAccessUrls(teamDomain: string) {
  const certsPath = "/cdn-cgi/access/certs";
  const teamUrl = new URL(teamDomain);
  const issuer = teamUrl.origin;
  const certsUrl = teamUrl.pathname.endsWith(certsPath) ? teamUrl : new URL(certsPath, issuer);

  return { issuer, certsUrl };
}

// Main app that wraps the API and adds React Router fallback
const app = new Hono<{ Bindings: Env }>();

// Cloudflare Access JWT validation middleware (production only)
app.use("*", async (c, next) => {
  // Skip validation in development
  if (import.meta.env.DEV) {
    return next();
  }

  const { POLICY_AUD, TEAM_DOMAIN } = c.env;

  // Fail closed in production if Access is not configured.
  if (!POLICY_AUD || !TEAM_DOMAIN) {
    return c.text(
      "Cloudflare Access must be configured in production. Set POLICY_AUD and TEAM_DOMAIN.",
      500,
    );
  }

  const token = c.req.header("cf-access-jwt-assertion");
  if (!token) {
    return c.text("Missing required CF Access JWT", 403);
  }

  try {
    const { issuer, certsUrl } = getAccessUrls(TEAM_DOMAIN);
    const JWKS = createRemoteJWKSet(certsUrl);
    await jwtVerify(token, JWKS, {
      issuer,
      audience: POLICY_AUD,
    });
  } catch {
    return c.text("Invalid or expired Access token", 403);
  }

  // Authorization model note: once a teammate passes the shared Cloudflare
  // Access policy, they can access all mailboxes in this app by design.
  return next();
});

// MCP server endpoint — used by AI coding tools (ProtoAgent, Claude Code, Cursor, etc.)
// Must be before API routes and React Router catch-all.
// The handler is stateless (no Durable Object); it builds one MCP server per
// request. `env` is only available per request, so the handler is memoized for
// the lifetime of the isolate, which shares a single `env`.
let mcpHandler: StatelessMcpHandler | undefined;
app.all("/mcp", async (c) => {
  mcpHandler ??= createMcpHandler(() => createEmailMcpServer(c.env), {
    route: "/mcp",
  });
  return mcpHandler(c.req.raw, c.env, c.executionCtx as ExecutionContext);
});

// Mount the API routes
app.route("/", apiApp);

// Agent WebSocket routing - must be before React Router catch-all
app.all("/agents/*", async (c) => {
  const response = await routeAgentRequest(c.req.raw, c.env);
  if (response) return response;
  return c.text("Agent not found", 404);
});

// React Router catch-all: serves the SPA for all non-API routes
app.all("*", (c) => {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: c.env,
    ctx: c.executionCtx as ExecutionContext,
  });
  return requestHandler(c.req.raw, context);
});

// Export the Hono app as the default export with an email handler
export default {
  fetch: app.fetch,
  async email(event: { raw: ReadableStream; rawSize: number }, env: Env, ctx: ExecutionContext) {
    try {
      await receiveEmail(event, env, ctx);
    } catch (e) {
      console.error("Failed to process incoming email:", (e as Error).message, (e as Error).stack);
      // Re-throw so Cloudflare's email routing can retry delivery or bounce the message.
      // Swallowing the error would silently drop the email.
      throw e;
    }
  },
};
