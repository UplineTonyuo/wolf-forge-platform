import { createRequire, Module } from "node:module";
import { startTransition, type ReactNode } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

const require = createRequire(import.meta.url);
// Mirror Next's browser build alias in this isolated DOM harness; no RSC requests are executed.
const webpackGlobal = globalThis as typeof globalThis & { __webpack_require__?: { u: () => never } };
const previousWebpack = webpackGlobal.__webpack_require__;
webpackGlobal.__webpack_require__ ??= { u() { throw new Error("Unexpected RSC chunk request in DOM navigation test"); } };
require("next/dist/server/require-hook").addHookAliases([
  ["react-server-dom-webpack/client", require.resolve("next/dist/compiled/react-server-dom-webpack/client.browser")],
]);
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime") as typeof import("next/dist/shared/lib/app-router-context.shared-runtime");
const installedLink = require("next/dist/client/app-dir/link");
if (previousWebpack) webpackGlobal.__webpack_require__ = previousWebpack;
else delete webpackGlobal.__webpack_require__;
export const appLinkModule = { default: installedLink.default, useLinkStatus: installedLink.useLinkStatus };

// Exercise installed Next Link's event handling; replace only its router dispatch, never fetch a route.
export function interceptNextLinkNavigation(push: (href: string) => void) {
  const stopBrowserNavigation = (event: Event) => event.preventDefault();
  // Window receives the bubble after React/Next, avoiding jsdom's unsupported document navigation.
  window.addEventListener("click", stopBrowserNavigation);
  const path = require.resolve("next/dist/client/components/navigator");
  const original = require.cache[path];
  const stub = new Module(path);
  stub.loaded = true;
  stub.exports = {
    navigate(href: string, _type: string, _scroll: unknown, link: unknown) {
      startTransition(() => {
        require("next/dist/client/components/links").setLinkForCurrentNavigation(link);
        push(href);
      });
    },
  };
  require.cache[path] = stub;
  return () => {
    window.removeEventListener("click", stopBrowserNavigation);
    if (original) require.cache[path] = original; else delete require.cache[path];
  };
}

export function NextLinkRouter({ children }: { children: ReactNode }) {
  return <AppRouterContext.Provider value={{} as AppRouterInstance}>{children}</AppRouterContext.Provider>;
}
