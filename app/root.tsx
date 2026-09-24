// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Empty, LinkButton, LinkProvider, Loader, Toasty, TooltipProvider } from "@cloudflare/kumo";
import { WarningIcon } from "@phosphor-icons/react";
import { forwardRef } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Link as RouterLink,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import "./index.css";

export function meta() {
  return [{ title: "Agentic Inbox" }];
}

const KumoLink = forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }
>(function KumoLink({ href, ...props }, ref) {
  if (href && !href.startsWith("http")) {
    return <RouterLink to={href} ref={ref} {...(props as Record<string, unknown>)} />;
  }
  return <a href={href} ref={ref} {...props} />;
});

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" sizes="48x48 32x32 16x16" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <Meta />
        <Links />
      </head>
      <body className="bg-kumo-recessed text-kumo-default antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <Loader size="lg" />
    </div>
  );
}

export default function App() {
  return (
    <LinkProvider component={KumoLink}>
      <TooltipProvider>
        <Toasty>
          <Outlet />
        </Toasty>
      </TooltipProvider>
    </LinkProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let description = "An unexpected error occurred. Please try again.";
  let status: number | null = null;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (error.status === 404) {
      title = "Page not found";
      description = "The page you're looking for doesn't exist or has been moved.";
    } else {
      title = `Error ${error.status}`;
      description = error.statusText || description;
    }
  } else if (error instanceof Error && import.meta.env.DEV) {
    description = error.message;
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-8">
      <Empty
        icon={<WarningIcon size={48} className="text-kumo-inactive" />}
        title={status === 404 ? "404 — Page not found" : title}
        description={description}
        contents={
          <LinkButton href="/" variant="primary">
            Go Home
          </LinkButton>
        }
      />
    </div>
  );
}
