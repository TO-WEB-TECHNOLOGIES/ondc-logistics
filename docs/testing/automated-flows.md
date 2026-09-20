# Automated Workbench Flows

Standalone scripts in `src/flows/` that drive a full ONDC logistics scenario end to end against the **deployed Render service** (`https://ondc-logistics.onrender.com`, set in `src/flows/flow-kit.ts`). They are not part of the app runtime.

## How a flow works

1. Opens the unified SSE stream `GET /logistics/stream/:clientId` with a random `clientId`.
2. Sends each app-facing request (`/logistics/search`, `init`, `confirm`, `update`, `track`, `cancel`, ...).
3. Waits **with no timeout** for the matching SSE event before moving on.
4. Any `*_error` SSE event aborts the flow. Exit code `0` = success, `1` = failure.

Callbacks that the LSP/workbench pushes on its own (`on_status`, workbench `on_cancel`) are waited on, not sent. The workbench must be driven to send them.

## Flows

| Command | Sequence |
| --- | --- |
| `npm run flow:baseline` | search → on_search → init → on_init → confirm → on_confirm → update → on_update → on_status ×2 → track → on_track → on_status ×2 |
| `npm run flow:baseline-no-rts` | search → … → on_confirm → on_status ×4 (no update/track) |
| `npm run flow:cancellation` | search → … → on_confirm → cancel → on_cancel |
| `npm run flow:rto` | search → … → on_confirm → on_status ×3 → on_cancel (workbench-initiated) → on_status ×1 |
| `npm run flow:baseline-igm` | IGM (issue/grievance) workbench flow, `src/flows/ondc-baseline-igm.flow.ts` |
| `npm run keep-alive` | Pings the Render URL every 14 min to avoid idle spin-down. Separate long-running process; the file is git-ignored. |

## Shared kit (`src/flows/flow-kit.ts`)

- `runSearchInitConfirm()` — steps 1–6 shared by all flows; returns `orderId`, `fulfillmentId`, `initTransactionId`.
- `post`, `waitFor`, `waitForCount`, `runFlow`, `log` helpers.
- SSE events consumed: `search_result`, `init_result`, `order_confirmed`, `order_updated`, `order_status`, `order_tracking` (plus the cancel event in the cancellation/RTO flows).

## Notes

- Request bodies mirror `postman/Ustart.postman_collection.json`.
- Flows hit a live deployment; they create real workbench orders.
- Because waits have no timeout, a missing callback hangs the run — interrupt with Ctrl+C.
