import * as Sentry from "@sentry/nextjs";
import { initBotId } from "botid/client/core";

const environment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development";

Sentry.init({
  dsn: "https://e48cf5854eb0c3c67bb667c60d0c9035@o4512136275492864.ingest.us.sentry.io/4512136275689472",
  // Off for a page load that starts on /activate: the set-password token rides
  // in the URL fragment, and Sentry sends the full URL, fragment included.
  enabled:
    process.env.NEXT_PUBLIC_SENTRY_ENABLED === "1" &&
    window.location.pathname !== "/activate",
  environment,
  tracesSampleRate: environment === "production" ? 0.05 : 0,
  dataCollection: {
    userInfo: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    httpBodies: [],
    httpHeaders: false,
    cookies: false,
    urlQueryParams: false,
    stackFrameVariables: false,
  },
});

/** Invisible, free BotID Basic protection for the login Server Action only. */
initBotId({
  protect: [{ path: "/login", method: "POST" }],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
