# Task note: uniform callback ACK lifecycle (to-do-later)

**Date:** 2026-09-25
**Type:** task

## What changed

Added `tasks/uniform-callback-ack-lifecycle.md`, marked **to-do-later**. It records why callback
controllers use two different ACK lifecycles, the problems ACK-first causes, the proposed single
"process first, then ACK/NACK" lifecycle with its result → NACK mapping, the affected files and
the wire impact.

## Why

The user deferred this so the ACK timeout/retry work (Step 3) could go first; the note keeps the
analysis for later.

## Files

- tasks/uniform-callback-ack-lifecycle.md

## Validation

None needed. Documentation only; no code changed.
