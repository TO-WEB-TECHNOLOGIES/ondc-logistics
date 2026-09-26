# Refresh cancellation failing-checks list from latest report

**Date:** 2026-09-25
**Type:** task

## What changed

Regenerated `tasks/cancellation.md` from the latest `reports/cancellation.html`
(run 2026-09-24T17:46Z → 2026-09-25T15:34Z, now 8 run blocks: 4 × Buyer,
4 × Seller). 44 failures / 31 unique (previously 34 / 30). New: a
`cancel request verification` failure where `cancellation_reason_id` `'051'`
is not in the validator's allowed enum `['004','005','007','996']` (2 Buyer
runs). Unchanged: the `on_init` / `on_confirm` sync response `context` checks
(13 each, still one Buyer run only) and the 4 `on_cancel` request checks (now in
all 4 Seller runs).

## Why

A newer report was generated; the task list must reflect only what still fails.

## Files

- tasks/cancellation.md

## Validation

Extracted with a scratchpad Node script following
`tasks/_report-extraction-guide.md` (double-quoted `data-raw` variant); grouped
failure count (44) matched `stats.failures` (44).
