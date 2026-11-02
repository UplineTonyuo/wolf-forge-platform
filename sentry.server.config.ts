// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { sanitizeInvoiceShareTelemetry } from "./src/domain/observability/invoice-share-privacy";

Sentry.init({
  dsn: "https://e48cf5854eb0c3c67bb667c60d0c9035@o4512136275492864.ingest.us.sentry.io/4512136275689472",
  enabled:
    process.env.VERCEL === "1" || process.env.SENTRY_ENABLE_DEV === "1",
  environment: process.env.VERCEL_ENV ?? "development",
  beforeSend: (event) => sanitizeInvoiceShareTelemetry(event),
  beforeSendSpan: (span) => sanitizeInvoiceShareTelemetry(span),
  beforeBreadcrumb: (breadcrumb) => sanitizeInvoiceShareTelemetry(breadcrumb),
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
