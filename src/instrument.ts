// Preloaded via --import (see package.json dev/start) so Sentry instruments
// express/http/pg before they are imported. No-op when SENTRY_DSN is unset.
import "dotenv/config";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const SENSITIVE_HEADERS = ["authorization", "cookie", "x-api-key"];

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV ?? "development",
  tracesSampleRate: 0.1,
  profilesSampleRate: 0.1,
  integrations: [nodeProfilingIntegration()],
  // ONDC requests carry signatures in Authorization — never ship them.
  beforeSend(event) {
    const headers = event.request?.headers;
    if (headers) {
      for (const key of Object.keys(headers)) {
        if (SENSITIVE_HEADERS.includes(key.toLowerCase())) delete headers[key];
      }
    }
    return event;
  },
});
