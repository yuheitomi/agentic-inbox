// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * TEMP (email-detail latency measurement): time a loader's in-process API
 * calls and break each one down with the `Server-Timing` metrics the Hono
 * handler reported (`r2` for the mailbox check, `do` for the Durable Object
 * call, `total` for the whole handler).
 *
 * On Workers the clock only advances across I/O, so these numbers are the
 * network waits (R2, the Durable Object) and never the JSON encode/decode.
 */

export interface CallTiming {
  name: string;
  ms: number;
  server: Record<string, number>;
}

/** Run `call`, recording how long its response took and what the handler reported. */
export async function timed<R extends { headers: Headers }>(
  timings: CallTiming[],
  name: string,
  call: () => Promise<R>,
): Promise<R> {
  const start = performance.now();
  const res = await call();
  timings.push({
    name,
    ms: performance.now() - start,
    server: parseServerTiming(res.headers.get("Server-Timing")),
  });
  return res;
}

function parseServerTiming(header: string | null): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const entry of (header ?? "").split(",")) {
    const [name, ...params] = entry.trim().split(";");
    const dur = params.find((p) => p.trim().startsWith("dur="));
    if (name && dur) metrics[name] = Number(dur.trim().slice(4));
  }
  return metrics;
}

/**
 * The calls as one `Server-Timing` header for the browser, e.g.
 * `email-r2;dur=12.0, email-do;dur=31.0, email;dur=44.0, ..., loader;dur=90.0`.
 */
export function serverTimingHeader(timings: CallTiming[], totalMs: number): string {
  const metrics = timings.flatMap(({ name, ms, server }) => [
    ...Object.entries(server)
      .filter(([key]) => key !== "total")
      .map(([key, dur]) => `${name}-${key};dur=${dur.toFixed(1)}`),
    `${name};dur=${ms.toFixed(1)}`,
  ]);
  return [...metrics, `loader;dur=${totalMs.toFixed(1)}`].join(", ");
}
