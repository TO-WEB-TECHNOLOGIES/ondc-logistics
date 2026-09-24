# Fix /logistics/search: payment, schedule duration/holidays, GPS precision

**Date:** 2026-09-24
**Type:** fix

## What changed

Fixed the 11 "search request verification" failures from the Pramaan
cancellation cert run (`tasks/cancellation.md`), traced to the
`/logistics/search` request-building path:

- `src/utils/search-validation.ts` (`parseMinimalSearchRequest`): now parses
  optional `schedule.duration` (string) and `schedule.holidays` (string
  array), and a new optional `payment` block (`{ type, collection_amount? }`,
  `type` validated against `ON-ORDER | ON-FULFILLMENT | POST-FULFILLMENT`) —
  previously `payment` wasn't read at all, so it was always dropped.
- Added a `gpsString` helper that validates any `gps` value against the
  contract's `^-?\d{1,3}\.\d{6}, ?-?\d{1,3}\.\d{6}$` pattern (exactly 6
  decimal digits per coordinate) and applied it everywhere a `gps` field is
  parsed (`parseSearchRequest`'s `location()` helper and
  `parseMinimalSearchRequest`'s `start.gps`/`end.gps`), so a malformed GPS
  string is now rejected at intake with a clear `SearchValidationError`
  instead of silently reaching the ONDC network and failing certification.
- `src/mappers/search.mapper.ts` (`mapSearchRequestToOndc`): now forwards
  `schedule.duration` and `schedule.holidays` (as `intent.provider.time.
  duration` / `intent.provider.time.schedule.holidays`) into the outbound
  ONDC `/search` payload — previously only `days`/`range` were forwarded.

## Why

The cert suite requires `intent.provider.time.duration`,
`intent.provider.time.schedule.holidays`, and `intent.payment` (with a valid
`type`) on every `/search` request, and requires `gps` fields to carry
exactly 6 decimal digits. None of these were being read from the incoming
request, parsed, or forwarded to the ONDC payload, so they were always
`undefined` on the wire.

## Files

- `src/utils/search-validation.ts`
- `src/mappers/search.mapper.ts`

## API/contract impact

`/logistics/search` request body gains three new optional fields:
`schedule.duration`, `schedule.holidays`, `payment`. Non-breaking — callers
that omit them keep the previous behavior (field simply absent from the
outbound ONDC intent). `gps` fields are now validated against the contract
pattern at intake; a caller sending fewer/more than 6 decimal digits now
gets a 400 `INVALID_SEARCH_REQUEST` instead of a silently malformed ONDC
request.

## Validation

- `npx tsc --noEmit -p .` — passes with no errors.
- Manually diffed the fields added to `mapSearchRequestToOndc`'s output
  against `.claude/skills/ondc-api-contract/examples/search.json`
  (`intent.provider.time.duration`, `.schedule.holidays`, `intent.payment`)
  — shapes match.
- Not re-run against the live Pramaan suite in this session; see
  `changelogs/local/2026-09-24-flow-search-payload-fix.md` for the flow
  script that now exercises this path end-to-end.
