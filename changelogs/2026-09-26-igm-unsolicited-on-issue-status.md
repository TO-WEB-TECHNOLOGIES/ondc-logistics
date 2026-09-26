# IGM: accept unsolicited on_issue_status; baseline-igm flow closes after pushed status

**Date:** 2026-09-26
**Type:** fix | flow-script

## What changed

- `IssueRepository.handleOnIssueStatus` now handles `/on_issue_status` with no matching `/issue_status` of ours (unsolicited push), mirroring unsolicited `/on_issue`:
  - correlated by `message.issue.id` → `issues` row (`not_found` if unknown),
  - `bpp_id` checked against the issue row,
  - deduped by an existing `ondc_transactions` row for (transaction_id, message_id, action `issue_status`),
  - actions/issue patch persisted and an `issue_status` audit row inserted in one DB transaction,
  - `issue_status_updated` / `issue_status_error` SSE emitted with the issue's `orderId`.
  Solicited callbacks behave as before.
- `flow:baseline-igm` (`src/flows/ondc-baseline-igm.flow.ts`): removed the `/issue_status` request and the `INFO_PROVIDED` issue step. After `on_issue` it waits for the pushed `on_issue_status` (push timeout), sends the `CLOSED` `/issue`, and exits without waiting for a callback.

## Why

The workbench pushes `on_issue_status` on its own; previously such a callback returned `not_found` with no SSE event, so the flow could not observe it.

## Files

- src/repositories/issue.repository.ts
- src/flows/ondc-baseline-igm.flow.ts

## API/contract impact

No wire-format change; inbound correlation only. The IGM spec is not in `docs/ondc/`, so the unsolicited `on_issue_status` behaviour was implemented on request, not verified against the contract.

## Validation

- `npx tsc --noEmit` — passed (exit 0).
- Diff inspected. The flow was not run.
