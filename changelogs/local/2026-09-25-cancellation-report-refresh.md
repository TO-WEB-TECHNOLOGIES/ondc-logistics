# Refresh cancellation failing-checks list from new report

**Date:** 2026-09-25
**Type:** task

## What changed

Regenerated `tasks/cancellation.md` from the updated `reports/cancellation.html`
(run 2026-09-24T17:46Z → 2026-09-25T05:49Z). Failures dropped from 61 to 34
(30 unique). Remaining: `on_init` / `on_confirm` sync response `context`
checks (13 each, one Buyer run only) and 4 `on_cancel` request checks (in
both Seller runs, 2 of them optional). Added a `Runs` column (identical
failures across run blocks are deduplicated) and an empty `Solution` column
per table.

Updated `tasks/_report-extraction-guide.md`: documented both `data-raw`
quoting variants (single-quoted multi-line / double-quoted single-line) with
a snippet that handles both, repeat run blocks per Role, deduplication with a
`Runs` column, the `Assertion | Error | Optional | Runs | Solution` table
layout, the rule to replace the file wholesale when regenerating, and an
incident-log entry.

## Why

The report was re-run after the recent cancellation-flow fixes; the task list
needed to show only what still fails, with space to record fixes.

## Files

- tasks/cancellation.md
- tasks/_report-extraction-guide.md

## Validation

Extracted with a scratchpad Node script following
`tasks/_report-extraction-guide.md`; grouped failure count (34) matched
`stats.failures` (34). The new report uses a double-quoted
`data-raw="..." data-config=` attribute, so the guide's single-quote
boundary had to be adapted for this report.
