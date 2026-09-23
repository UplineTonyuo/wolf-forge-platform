// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://e48cf5854eb0c3c67bb667c60d0c9035@o4512136275492864.ingest.us.sentry.io/4512136275689472",
  enabled:
    process.env.VERCEL === "1" || process.env.SENTRY_ENABLE_DEV === "1",
  environment: process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: process.env.VERCEL_ENV === "production" ? 0.05 : 0,
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
