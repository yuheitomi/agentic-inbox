// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    // House style. These mirror Oxfmt's defaults, pinned so the formatting the
    // repo was normalized to does not shift under a toolchain upgrade.
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: false,
    jsxSingleQuote: false,
    quoteProps: "as-needed",
    trailingComma: "all",
    arrowParens: "always",
    bracketSpacing: true,
    endOfLine: "lf",
    sortPackageJson: true,
    sortImports: {
      // Node builtins, then npm packages, then our own modules, then relative
      // imports, then stylesheets. Side-effect imports keep their position.
      groups: [
        "builtin",
        "external",
        ["internal", "subpath"],
        ["parent", "sibling", "index"],
        "style",
        "unknown",
      ],
      // `~/*` maps to `app/*`; `shared/*` and `workers/*` resolve from the root.
      internalPattern: ["~/", "shared/", "workers/"],
      newlinesBetween: false,
    },
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  plugins: lazyPlugins(() => [
    // The Cloudflare plugin owns the "ssr" environment, which conflicts with the
    // Node environment Vitest sets up, so it is skipped during test runs.
    ...(process.env.VITEST ? [] : [cloudflare({ viteEnvironment: { name: "ssr" } })]),
    tailwindcss(),
    reactRouter(),
  ]),
});
