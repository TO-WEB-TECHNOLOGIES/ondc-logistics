# Task note: flow resume from the failed step (to-do-later)

**Date:** 2026-09-25
**Type:** task

## What changed

Added `tasks/flow-resume-from-failed-step.md`, marked **to-do-later**. It's the plan for a
`--resume` option in the automated flows: steps grouped into checkpointed units, `clientId`
and ids reused from `reports/flow-runs/<flow>.checkpoint.json`, and a `retry` command in the
failure box. It includes the unit breakdown per flow, the files involved, risks (server restart
losing the binding, workbench-pushed events, re-init snapshots, workbench scoring) and optional
extras. It also records that the triggering `CANCEL_SUBMISSION_FAILED` failure should be checked
in the Render logs first.

## Why

The user asked for the plan to be parked as a to-do-later task instead of implemented now.

## Files

- tasks/flow-resume-from-failed-step.md

## Validation

None needed. Documentation only; no code changed.
