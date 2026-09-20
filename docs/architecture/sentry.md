# Sentry Error Tracking & Tracing — Status: Pending Rollout

**Status**: code wired, **not yet active**. Nothing is reported until `SENTRY_DSN` is set.

## What is already in the code

| Piece | Location | Behavior |
| --- | --- | --- |
| SDK init | `src/instrument.ts` | `Sentry.init` with `enabled: Boolean(SENTRY_DSN)` — a no-op when the DSN is unset. `tracesSampleRate` / `profilesSampleRate` = `0.1`, profiling integration enabled. |
| Preload | `package.json` scripts `dev` / `start` | `--import ./src/instrument.ts` (dev) and `--import ./dist/instrument.js` (start) so Sentry patches express/http/pg before they are imported. |
| Express error handler | `src/index.ts` | `Sentry.setupExpressErrorHandler(app)`, registered after all routes. |
| Uncaught exception flush | `src/index.ts` | `Sentry.flush(2000)` before `process.exit(1)` so the final event is delivered. |
| Header scrubbing | `src/instrument.ts` `beforeSend` | Strips `authorization`, `cookie`, `x-api-key` (ONDC signatures live in `Authorization`). |

Dependencies: `@sentry/node`, `@sentry/profiling-node`.

## Pending

- [ ] Create the Sentry project and obtain the DSN.
- [ ] Set `SENTRY_DSN` in the deployment environment (Render) and local `.env` where wanted; add a `SENTRY_DSN=` placeholder to `.env.example`.
- [ ] Confirm `NODE_ENV` is set per environment — it is used as the Sentry `environment`.
- [ ] Verify `npm run build` emits `dist/instrument.js` (required by `npm start`).
- [ ] Trigger a test error in a non-production environment and confirm it arrives with `Authorization` stripped.
- [ ] Review sampling (`0.1`) once real traffic volume is known.
- [ ] Decide whether request bodies (ONDC payloads, PII) should be scrubbed too; only headers are scrubbed today.

## Not to be confused with

ONDC Network Observability (the compliance transaction-log push to ONDC) is a separate mechanism. The two share no code path; Sentry never sees NO API payloads.
