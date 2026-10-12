# CORS origins from env + GET /logistics/issues

**Date:** 2026-10-12
**Type:** feature

## What changed

- CORS is now actually applied. Allowed browser origins come from the comma-separated
  `CORS_ALLOWED_ORIGINS` env var (unset/empty → no cross-origin access). Uses the `cors`
  package with methods `GET, POST, OPTIONS`, header `Content-Type`, no credentials.
  Disallowed origins get no CORS headers; requests without an `Origin` header (ONDC
  callbacks, server-to-server) are unaffected. The unused hard-coded `ALLOWED_ORIGINS`
  constant was replaced.
- New `GET /logistics/issues` — lists issues across all orders, newest first (by
  `created_at`). Optional query: `status` (`OPEN` | `CLOSED`), `limit` (1–200, default 50),
  `offset` (default 0). Returns `{ issues, limit, offset }`; each item is the per-order
  issue summary plus `orderId`. Invalid query → 400 `INVALID_ISSUE_LIST_REQUEST` with
  `details[]`; DB failure → 500 `ISSUES_LIST_FAILED`. Read-only, no ONDC call.
- `.env.example` documents `CORS_ALLOWED_ORIGINS`.

## Why

The IGM UI needs cross-origin access when deployed on a separate origin, and an inbox view
that doesn't require starting from an order ID.

## Files

- src/index.ts
- src/repositories/issue.repository.ts
- src/controllers/issue.controller.ts
- src/routes/issue.routes.ts
- .env.example
- package.json, package-lock.json (`cors`, `@types/cors`)

## API/contract impact

None on the ONDC wire format. New internal BFF endpoint `GET /logistics/issues`; the existing
`GET /logistics/orders/:orderId/issues` response is unchanged.

**Deploy note:** `CORS_ALLOWED_ORIGINS` must be set in each environment's `.env`; when it is
missing, no origin is allowed cross-origin.

## Validation

- `npm run build` (tsc + tsc-alias) — passed.
- Ran the built server on port 3999 with `CORS_ALLOWED_ORIGINS=http://localhost:5173`:
  - `GET /logistics/issues?limit=2` → 200 with 2 items including `orderId`.
  - `?status=OPEN&limit=1` → 200.
  - `?status=FOO&limit=500&offset=-1` → 400 with three `details` entries.
  - Preflight `OPTIONS /logistics/issue` from the allowed origin → 204 with
    `Access-Control-Allow-*` headers.
  - Request from a disallowed origin, and with no Origin → 200 with no CORS headers.
  - `GET /logistics/issues/does-not-exist` → 404 (detail route unaffected).
