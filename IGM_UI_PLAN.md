# IGM UI — Plan

Status: **plan only, nothing built yet.** This waits for approval.

## 1. Goal

A small website just for **IGM (Issue & Grievance Management)**. It lets an operator:

- raise a complaint against a logistics order
- see the complaints on an order
- open one complaint and see its status, resolution and action timeline
- ask the LSP for the latest status (`/issue_status`)
- close a complaint (with an optional rating) or escalate it

Look: **light theme**, **orange as the primary colour**.

Out of scope: search, init, confirm, status, track, cancel, update screens, and login or auth.

## 2. Where it lives

A **separate sibling project** with its own git repo, so the backend stays pure backend:

```
internship/
├── ondc-logistics-api/   ← backend (unchanged)
└── ondc-igm-ui/          ← new frontend
```

This file is the only thing the plan adds to the backend repo. After approval you can move it into `ondc-igm-ui/` or delete it.

## 3. Stack

| Concern | Choice | Why |
|---|---|---|
| Build | Vite | Fast; its dev proxy removes the need for backend CORS changes |
| UI | React 18 + TypeScript | Same language as the backend |
| Styling | Tailwind CSS | Easy to theme orange as the primary colour |
| Routing | React Router | Three or four pages |
| Data fetching | TanStack Query | Caching, refetch and polling for the async callbacks |
| Forms | React Hook Form (optional) | The create form has conditional fields |

### Theme tokens

```
primary        #F97316  (orange-500)   buttons, links, active tab
primary-hover  #EA580C  (orange-600)
primary-soft   #FFF7ED  (orange-50)    selected rows, info banners
background     #FFFFFF / #FAFAF9       page / cards
text           #1C1917  (stone-900)
muted          #78716C  (stone-500)
border         #E7E5E4  (stone-200)
success  #16A34A   warning  #D97706   danger  #DC2626
```

## 4. Backend contract the UI uses (exists today)

All UI calls are app-level BFF endpoints under `/logistics`. The UI never calls `/on_issue` or `/on_issue_status`; the LSP calls those, and they're signature-verified.

| Method | Path | Use |
|---|---|---|
| POST | `/logistics/issue` | Raise a complaint, or close/escalate one (body has `issue_id`) |
| POST | `/logistics/issue_status` | Ask the LSP for the latest status |
| GET | `/logistics/issues/:issueId` | Complaint details and action timeline (from the database, no ONDC call) |
| GET | `/logistics/orders/:orderId/issues` | List an order's complaints, newest first |
| GET | `/logistics/stream/:clientId` | SSE stream (optional; see §7) |

Source: `src/routes/issue.routes.ts`, `src/controllers/issue.controller.ts`, `src/schemas/issue.schema.ts`, `src/repositories/issue.repository.ts`.

### 4.1 Raise a complaint — `POST /logistics/issue`

```json
{
  "order_id": "string",
  "category_code": "ITEM_QUALITY",
  "descriptor_long_desc": "string",
  "descriptor_additional_desc_url": "https://... (optional)",
  "items": [{ "id": "item-id", "quantity": 1 }],
  "images": ["https://.../photo.jpg"]
}
```

- `items` is required for ITEM categories and optional for FULFILLMENT ones.
- `images` (URL strings) is required for categories with `requiresImages`.
- Returns **202** `{ issueId, transactionId, messageId, status: "ISSUE_SENT" }`.
- Returns **400** `INVALID_ISSUE_REQUEST` (has `details[].path`), **409** `ISSUE_STATE_INVALID`, or **502** `ISSUE_SUBMISSION_FAILED`.

### 4.2 Close or escalate — `POST /logistics/issue`

```json
{ "issue_id": "string", "action_code": "CLOSE", "rating": "THUMBS-UP", "short_desc": "optional" }
{ "issue_id": "string", "action_code": "ESCALATE", "short_desc": "optional" }
```

`rating` (`THUMBS-UP` | `THUMBS-DOWN`) is only used with CLOSE.

### 4.3 Refresh status — `POST /logistics/issue_status`

```json
{ "issue_id": "string" }
```

Returns **202**. The new status arrives later through `/on_issue_status`.

### 4.4 Categories the dropdown shows

The backend has no categories endpoint. These come from `ISSUE_CATEGORY_OPTIONS` in `src/constants/issueCategories.ts`, which excludes internal-only entries and entries without an IGM 1.0.0 sub-category:

| category_code | Sub-category | Label | Images required | Items |
|---|---|---|---|---|
| ITEM_MISSING | ITM01 | Missing items | no | required |
| ITEM_QUANTITY | ITM02 | Quantity issue | **yes** | required |
| WRONG_ITEM | ITM03 | Item mismatch | **yes** | required |
| ITEM_QUALITY | ITM04 | Quality issue | **yes** | required |
| ITEM_EXPIRED | ITM05 | Expired item | **yes** | required |
| PACKAGING_ISSUE | FLM04 | Packaging issue | **yes** | optional |

## 5. Screens

### 5.1 Order lookup (`/`)
- An order ID input and a **Find complaints** button (orange).
- Opens `/orders/:orderId`.

### 5.2 Order complaints (`/orders/:orderId`)
- Calls `GET /logistics/orders/:orderId/issues`.
- Table columns: issue ID (short), category label, sub-category, status badge, level (ISSUE / GRIEVANCE / DISPUTE), created, updated.
- If there are none, an empty state with a **Raise complaint** button.
- **Raise complaint** button at the top right.

### 5.3 Raise complaint (`/orders/:orderId/issues/new`)
- Category dropdown (§4.4) with the selected category's description shown underneath.
- Description textarea (required).
- Items editor: repeatable rows of `{ id, quantity }`. Shown and required for ITEM categories.
- Image URLs: repeatable URL inputs. Required when the category needs images.
- Optional additional-description URL.
- Checks the form before sending, then shows 400 `details[].path` errors next to the matching fields.
- On 202, opens the complaint details page and shows a "Sent to LSP, waiting for response" banner.

### 5.4 Complaint details (`/issues/:issueId`)
Calls `GET /logistics/issues/:issueId`.

- **Header:** issue ID, order ID (link), category, status badge (ours: OPEN / CLOSED), latest LSP response (`respondentStatus`), and level.
- **Expected times:** response and resolution durations, shown in readable form (e.g. `PT1H` → "1 hour").
- **Resolution card:** shown when present. Includes the action triggered, descriptions and refund amount.
- **Resolution provider / GRO card:** organisation, support contacts and GRO list.
- **Timeline:** `actions[]` oldest first, styled differently for complainant and respondent, with actor name, code, short description and time.
- **Refs:** order, item and fulfillment references.
- **Actions bar:**
  - **Refresh status** calls `/issue_status`, then polls the details.
  - **Escalate** opens a confirm dialog with an optional note.
  - **Close** opens a dialog with a thumbs up/down rating and an optional note.
  - Buttons are hidden or disabled when the complaint is CLOSED. The backend's 409 is still the final check, and its message is shown when it fires.

## 6. Folder layout (`ondc-igm-ui/`)

```
ondc-igm-ui/
├── index.html
├── package.json
├── vite.config.ts           # dev proxy → http://localhost:3000
├── tailwind.config.ts       # orange primary tokens
├── .env.example             # VITE_API_BASE (empty in dev, uses proxy)
└── src/
    ├── main.tsx
    ├── App.tsx              # router + layout (header, orange accent)
    ├── api/
    │   ├── client.ts        # fetch wrapper, error mapping
    │   ├── issues.ts        # createIssue, updateIssue, checkStatus, getIssue, listOrderIssues
    │   └── types.ts         # copied from IssueDetails / IssueSummary / request shapes
    ├── constants/
    │   └── categories.ts    # copy of ISSUE_CATEGORY_OPTIONS (§4.4)
    ├── pages/
    │   ├── OrderLookup.tsx
    │   ├── OrderIssues.tsx
    │   ├── CreateIssue.tsx
    │   └── IssueDetails.tsx
    └── components/
        ├── StatusBadge.tsx
        ├── Timeline.tsx
        ├── ResolutionCard.tsx
        ├── CloseDialog.tsx
        └── EscalateDialog.tsx
```

## 7. Handling async responses

`/issue` and `/issue_status` only return **202**. The real answer comes later through `/on_issue` or `/on_issue_status`. Recommended v1 approach: **polling.**

- After a create, close, escalate or status request, poll `GET /logistics/issues/:issueId` every 3 seconds for up to about 60 seconds.
- Stop early when `updatedAt` or the length of `actions` changes.
- Always show a manual **Reload** button too.

**Why not SSE in v1?** The backend does push `issue_updated`, `issue_error`, `issue_status_updated` and `issue_status_error` events on the unified stream (`issue.repository.ts`). Those events go to whichever `clientId` the **transaction_id** is bound to, and today that binding only happens through `/search`'s `client_id`. `/issue` takes no `client_id`, so an IGM-only UI has no reliable way to receive them. Making SSE work would be a **backend change** (accept `client_id` on `/issue` and `/issue_status` and call `clientStreamManager.bind`). That would be a separate plan.

## 8. Dev and deploy wiring

- **Dev:** the Vite proxy forwards `/logistics` → `http://localhost:3000`. The browser only sees one origin, so the backend needs no changes.
- **Note:** `src/index.ts` declares `ALLOWED_ORIGINS` (including `http://localhost:5173`), but no `cors` middleware is applied. With the proxy this doesn't matter. For a deployed UI on another origin, either serve it behind the same reverse proxy (recommended) or add CORS to the backend as a separate approved change.

## 9. Backend changes

**None are needed for v1.** These would help later, and each would get its own plan:

1. `GET /logistics/issues` lists all complaints (inbox view). Today the UI must start from an order ID.
2. `GET /logistics/issue-categories` returns the categories so the UI doesn't keep its own copy (§4.4).
3. `client_id` on `/issue` and `/issue_status` enables live SSE updates (§7).
4. An image upload endpoint. Today `images` must already be hosted URLs.

## 10. Risks and open questions

- **Category drift:** the UI's copy of the categories can fall out of sync with `issueCategories.ts`. Fix: item 2 in §9.
- **Item IDs:** the create form needs the order's item IDs. Open question: does `GET /logistics/orders/:orderId/status` return items with IDs the UI could prefill from, or should operators type them in?
- **Image hosting:** where do operators get image URLs from? (No upload endpoint yet.)
- **No auth:** anyone who can reach the backend can raise or close complaints. Fine for a local or internal tool, not for public deployment.
- **Status semantics:** `status` is our own (complainant) OPEN/CLOSED; `respondentStatus` is the LSP's latest action (e.g. PROCESSING / RESOLVED). The UI shows both, clearly labelled, rather than merging them.

## 11. Implementation steps (after approval)

1. Scaffold `../ondc-igm-ui` (Vite React-TS), add Tailwind and the theme tokens.
2. Add the Vite proxy and the API client and types.
3. Build the pages in this order: Order lookup → Order complaints → Complaint details → Raise complaint → Close/Escalate dialogs.
4. Add polling after each action.
5. Verify: `npm run build` plus `tsc --noEmit`, then a manual run against the local backend (raise → details → refresh → close).

No test files will be created unless you ask for them.
