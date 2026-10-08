# IGM issue read endpoints

**Date:** 2026-10-08
**Type:** feature

## What changed

- `GET /logistics/issues/:issueId`: returns the persisted issue (status, level, latest
  resolution, refs, actors, full complainant/respondent action timeline sorted by the action's
  `updated_at`). `404 ISSUE_NOT_FOUND` for unknown ids.
- `GET /logistics/orders/:orderId/issues`: `{ orderId, issues: [...] }` summary list, newest
  first, `[]` when none.
- New repository read methods `getIssueDetails` / `listIssuesByOrder` with their own
  `IssueDetails` / `IssueSummary` read models. `findByIssueId` (used to build outbound /issue
  payloads) is unchanged.
- `docs/integration/igm.md`, `README.md`, `errors.md` updated for the new endpoints.

## Why

The frontend had no way to read an issue's progress or resolution. The SSE events only carry
`{ issueId, orderId, newActionCount }`.

## Files

- src/repositories/issue.repository.ts
- src/controllers/issue.controller.ts
- src/routes/issue.routes.ts
- docs/integration/igm.md, docs/integration/README.md, docs/integration/errors.md

## API/contract impact

None on the ONDC wire. App-level read-only endpoints only. No DB schema change.

## Validation

- `npx tsc --noEmit -p .`: passed.
- Not exercised against a live database.
