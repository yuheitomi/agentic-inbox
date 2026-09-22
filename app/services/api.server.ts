// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The same Hono RPC contract as `api.ts`, for route loaders and actions,
 * plus the few helpers every action needs to read a form and report a
 * failure.
 *
 * Loaders run inside the Worker that serves the API, so this client's `fetch`
 * dispatches straight into the Hono app instead of going back out over the
 * network. Routes get the typed RPC surface without paying a round trip for
 * it: the only cost over calling the Durable Object directly is a JSON
 * encode/decode, and in exchange loaders, actions and the browser all go
 * through one contract.
 *
 * The `.server.ts` suffix keeps the Worker module out of the client bundle.
 */

import { hc } from "hono/client";
import { data, type RouterContextProvider } from "react-router";
import { app, type AppType } from "workers/index";
import { cloudflareContext } from "~/context";
import type { AnyResponse, OkBody } from "./api";

/**
 * An RPC client bound to this request's `env` and `ExecutionContext`.
 *
 * `request` only supplies an origin: nothing leaves the isolate, but Hono
 * needs an absolute URL to build a `Request` from.
 */
export function serverApi(context: Readonly<RouterContextProvider>, request: Request) {
  const { env, ctx } = context.get(cloudflareContext);
  const origin = new URL(request.url).origin;

  return hc<AppType>(origin, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      app.fetch(new Request(input, init), env, ctx),
  }).api.v1;
}

/** `FormData.get` widens to `string | File | null`; action fields are always text. */
export function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * The `error` string a failed RPC answer carries, or `fallback` when the body
 * is missing or shaped differently. Actions that render a failure in place
 * use this directly; `ok()` uses it to build the response it throws.
 */
export async function errorMessage(res: AnyResponse, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

/** The thrown `Response` React Router renders as an error boundary. */
async function thrown(res: AnyResponse) {
  const error = await errorMessage(res, `Request failed: ${res.status}`);
  return data({ error }, { status: res.status });
}

/**
 * Await an RPC call and return its success body, turning a non-2xx answer
 * into the thrown `Response` React Router renders as an error boundary.
 */
export async function ok<R>(pending: R | Promise<R>): Promise<OkBody<R>> {
  const res = (await pending) as AnyResponse;
  if (!res.ok) throw await thrown(res);
  return (await res.json()) as OkBody<R>;
}

/** Await an RPC call whose body we discard. A 204 has none to read. */
export async function okEmpty<R>(pending: R | Promise<R>): Promise<void> {
  const res = (await pending) as AnyResponse;
  if (!res.ok) throw await thrown(res);
}
