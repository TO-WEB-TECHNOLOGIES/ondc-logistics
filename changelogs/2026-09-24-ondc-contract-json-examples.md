# ONDC contract JSON examples extracted into ondc-api-contract skill

**Date:** 2026-09-24
**Type:** chore

## What changed

Extracted the illustrative JSON request/response payload for every ONDC
Logistics action from `docs/ondc/ondc logistics.docx` (v1.2.5) into
`.claude/skills/ondc-api-contract/examples/*.json` — one file per action
(`lookup`, `vlookup`, `search`, `on_search`, `init`, `on_init`, `confirm`,
`on_confirm`, `update`, `on_update`, `cancel`, `on_cancel`, `track`,
`on_track`, `status`, `on_status`). `on_search.json`, `on_cancel.json`,
and `lookup.json` each hold more than one named example. Updated
`.claude/skills/ondc-api-contract/SKILL.md` to point at this new
`examples/` folder.

Two JSON syntax typos in the source docx were corrected in the extracted
copies only, so they parse as valid JSON:
- `update.json`: missing comma after
  `fulfillments[0].start.instructions.short_desc`.
- `on_status.json`: trailing comma after
  `fulfillments[0].state.descriptor.short_desc`.

No other content was altered, and `docs/ondc/ondc logistics.docx` itself
was not modified.

## Why

So future ONDC contract work can reference a concrete example payload
directly from the skill instead of re-parsing the 105KB docx each time.

## Files

- `.claude/skills/ondc-api-contract/examples/*.json` (16 new files)
- `.claude/skills/ondc-api-contract/SKILL.md`

## API/contract impact

None — reference material only, no wire-format or app-code change.

## Validation

- Every extracted `.json` file re-parsed with `JSON.parse` after the two
  typo fixes and the manual variant-label renames — all 16 files valid.
