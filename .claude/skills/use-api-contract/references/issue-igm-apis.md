# ONDC IGM — Issue / Grievance / Dispute APIs (v2.0.0)

## What is IGM?

IGM (Issue Grievance Message) is ONDC's **post-order escalation protocol** for handling
buyer (or seller) complaints about an order or transaction interaction. It is a separate
protocol from the core transaction (`/search`, `/select`, `/init`, `/confirm`, `/status`,
`/cancel`, etc.) and operates alongside it.

**IGM is NOT a replacement for the core transaction APIs.** It runs in parallel — the
order still follows its normal fulfillment lifecycle. IGM handles the complaint side-channel.

**Core version**: `1.2.0` for RET10/RET11 (F&B). `2.0.1` for TRV10.

---

## IGM API Summary

| Action | Direction | Purpose |
|--------|-----------|---------|
| `issue` | BAP ↔ BPP | Either party raises/updates a complaint |
| `on_issue` | BPP ↔ BAP | Respondent acknowledges, requests info, or offers resolution |
| `issue_status` | BAP → BPP | Either party checks complaint status |
| `on_issue_status` | BPP → BAP | Respondent returns current issue state |

**Bi-directional**: Both buyer apps AND seller apps can raise complaints. All NPs must
**send AND consume** all 4 APIs.

All four APIs share the **same context object** as core ONDC APIs and use ACK/NACK responses.

---

## When to Use IGM (Buyer NP Perspective)

IGM is the escalation path when:
- BPP does not respond to a `/cancel` request within TAT → force cancel → still no response → issue
- Order has a problem that cannot be resolved through cancellation (e.g., quality issue, wrong item delivered)
- Buyer needs a refund or replacement for an order that is in-flight or already delivered
- BPP sends an unsolicited `/on_cancel` and buyer disputes it

**IGM Flow 1** (RET/F&B): Buyer raises complaint → Seller analyzes → Seller requests more
info → Buyer provides → Seller offers resolutions → Buyer accepts → Seller resolves
(executes the resolution) → Buyer closes (optionally provides feedback).

**IGM Flow 2**: Must also be implemented. Covers seller-side complaints (e.g., catalog
visibility issues, settlement disputes).

**Both Flow 1 and Flow 2 must be implemented.**

---

## Context Object (IGM APIs)

Same structure as core ONDC context, with `core_version` specific to IGM:

```json
{
  "domain": "ONDC:RET10",
  "action": "issue",
  "country": "IND",
  "city": "std:080",
  "core_version": "1.2.0",
  "bap_id": "buyerNP.com",
  "bap_uri": "https://buyerNP.com/ondc",
  "bpp_id": "sellerapp.com",
  "bpp_uri": "https://sellerapp.com/ondc",
  "transaction_id": "T1",
  "message_id": "M1",
  "timestamp": "2023-06-03T08:00:00.000Z",
  "ttl": "PT30S"
}
```

| Field | Value |
|-------|-------|
| `domain` | `"ONDC:RET10"` for RET flows; `"ONDC:TRV10"` for travel |
| `action` | `"issue"`, `"on_issue"`, `"issue_status"`, or `"on_issue_status"` |
| `core_version` | `"1.2.0"` for RET10/RET11; `"2.0.1"` for TRV10 |
| `ttl` | Always `"PT30S"` — IGM TTL is fixed |
| `location` object | Used with `core_version` 2.x; `country`/`city` used with 1.x |

---

## `/issue` — Raise or Update a Complaint

**Sent by**: BAP or BPP (bi-directional — either party can raise a complaint)

### `message.issue` Schema

```json
{
  "id": "ISSUE-1",
  "status": "OPEN",
  "level": "ISSUE",
  "created_at": "2023-01-15T10:00:00.469Z",
  "updated_at": "2023-01-15T10:00:00.469Z",
  "expected_response_time": { "duration": "PT2H" },
  "expected_resolution_time": { "duration": "P1D" },
  "refs": [
    {
      "ref_id": "O1",
      "ref_type": "ORDER"
    },
    {
      "ref_id": "P1",
      "ref_type": "PROVIDER"
    },
    {
      "ref_id": "F1",
      "ref_type": "FULFILLMENT"
    },
    {
      "ref_id": "I1",
      "ref_type": "ITEM",
      "tags": [
        {
          "descriptor": { "code": "message.order.items" },
          "list": [
            { "descriptor": { "code": "quantity.selected.count" }, "value": "2" }
          ]
        }
      ]
    }
  ],
  "actors": [
    {
      "id": "CUST1",
      "type": "CONSUMER",
      "info": {
        "org": { "name": "buyerapp.com::ONDC:RET10" },
        "person": { "name": "Sam Manuel" },
        "contact": { "phone": "9879879870", "email": "sam@yahoo.com" }
      }
    },
    {
      "id": "NP1",
      "type": "INTERFACING_NP",
      "info": { ... }
    }
  ],
  "source_id": "CUST1",
  "complainant_id": "NP1",
  "descriptor": {
    "code": "ITM004",
    "short_desc": "Issue with product quality",
    "long_desc": "Product quality is not correct. facing issues while using the product",
    "additional_desc": {
      "url": "https://buyerapp.com/additonal-details/desc.txt",
      "content_type": "text/plain"
    },
    "images": [
      { "url": "http://buyerapp.com/addtional-details/img1.png", "size_type": "xs" }
    ],
    "media": [
      { "url": "https://transitsolutions.in/logos/logo.icon" }
    ]
  },
  "last_action_id": "A1",
  "actions": [
    {
      "id": "A1",
      "descriptor": {
        "code": "OPEN",
        "short_desc": "Complaint created"
      },
      "updated_at": "2023-01-15T10:00:00.469Z",
      "action_by": "NP1",
      "actor_details": {
        "name": "Sam Manuel"
      }
    }
  ]
}
```

### Issue Status Values

| Status | Description |
|--------|-------------|
| `OPEN` | New complaint, awaiting respondent action |
| `PROCESSING` | Respondent is looking into it / has taken ownership |
| `RESOLVED` | Respondent has executed the resolution |
| `CLOSED` | Complaint is closed |

### Issue Level Values

| Level | Description |
|-------|-------------|
| `ISSUE` | Standard complaint (Level 1) |
| `GRIEVANCE` | Escalated complaint — GRO officers are involved (Level 2) |
| `DISPUTE` | Escalated to ODR (Level 3) — **not yet implemented** |

**Level 3 (ODR/arbitration) is not yet live.** If resolution is not achieved at Level 2,
complainants can use the **manual ODR process** via ONDC Web.

### Actor Type Values

| Type | Description |
|------|-------------|
| `CONSUMER` | The end buyer who placed the order |
| `INTERFACING_NP` | The NP that is the complainants interface (e.g., buyer app for buyer complaints) |
| `COUNTERPARTY_NP` | The NP that is the transaction counterparty |
| `INTERFACING_NP_GRO` | GRO of the interfacing NP (appears when issue escalates to GRIEVANCE) |
| `COUNTERPARTY_NP_GRO` | GRO of the counterparty NP (appears when issue escalates to GRIEVANCE) |

### Action `descriptor.code` Values (Action Codes)

| Code | Used By | Description |
|------|---------|-------------|
| `OPEN` | Complainant (buyer or seller app) | New complaint created |
| `PROCESSING` | Respondent | Acknowledged and working on it |
| `INFO_REQUESTED` | Respondent | Requesting more information from complainant |
| `INFO_PROVIDED` | Complainant | Providing requested information |
| `INFO_NOT_AVAILABLE` | Complainant | Requested information not available |
| `RESOLUTION_PROPOSED` | Respondent | Proposed resolution options to complainant |
| `RESOLUTION_ACCEPTED` | Complainant | Complainant accepted a proposed resolution |
| `RESOLUTION_REJECTED` | Complainant | Complainant rejected the proposed resolution (TRV Flow 5) |
| `RESOLUTION_CASCADED` | Respondent | Resolution cascaded to another party (e.g., LSP) |
| `RESOLVED` | Respondent | Resolution has been executed |
| `CLOSED` | Complainant or Respondent | Complaint closed |

### Issue Status → Valid Actions Mapping

| Status | Valid Actions |
|--------|--------------|
| `OPEN` | `OPEN` |
| `PROCESSING` | `PROCESSING`, `INFO_REQUESTED`, `INFO_PROVIDED`, `INFO_NOT_AVAILABLE`, `RESOLUTION_PROPOSED`, `RESOLUTION_ACCEPTED`, `RESOLUTION_REJECTED`, `RESOLUTION_CASCADED` |
| `RESOLVED` | `RESOLVED` |
| `CLOSED` | `CLOSED` |

### Issue `status` Lifecycle

```
OPEN → PROCESSING → RESOLVED → CLOSED
         ↓
    (buyer can REJECT resolution → stays PROCESSING → seller proposes new resolution)
```

If resolution is not executed satisfactorily after acceptance:
- Buyer escalates to GRIEVANCE level → GRO officers from both NPs get involved
- If still unresolved → dispute via ODR (manual process, not yet on-protocol)

### complainant_id vs source_id

- **`source_id`**: The entity that **originated** the complaint (e.g., `CUST1` = the consumer)
- **`complainant_id`**: The NP that **filed** the complaint to the network (e.g., `NP1` = the buyer app)

In a buyer complaint: `source_id = CUST1`, `complainant_id = NP1` (buyer app that filed on behalf of consumer)

### Ref Type Values

| Ref Type | Description |
|----------|-------------|
| `ORDER` | References the parent order |
| `PROVIDER` | References the seller/provider |
| `FULFILLMENT` | References the delivery fulfillment |
| `ITEM` | References the specific item(s) in the order |

### Timing Fields

| Field | Duration | Meaning |
|-------|----------|---------|
| `expected_response_time` | `PT2H` | Respondent must acknowledge within 2 hours |
| `expected_resolution_time` | `P1D` | Resolution expected within 1 day |

---

## `/on_issue` — Respondent's Reply

**Sent by**: BPP (Seller App) or BAP (Buyer App) in response to `issue`

### `message.issue` Additions in `on_issue`

```json
{
  "respondent_ids": ["NP2"],
  "resolver_ids": ["NP2"],
  "update_target": [
    {
      "path": "issue.actions",
      "action": "APPENDED"
    }
  ],
  "actions": [
    {
      "id": "A2",
      "descriptor": {
        "code": "PROCESSING",
        "short_desc": "Complaint is being reviewed"
      },
      "updated_at": "2023-01-15T12:00:00.469Z",
      "action_by": "NP2",
      "actor_details": {
        "name": "Jane Doe"
      }
    }
  ]
}
```

- **`respondent_ids`**: Array of NP IDs that are responding to this complaint
- **`resolver_ids`**: Array of NP IDs that are responsible for resolving the complaint
  (GROs' IDs appear here when escalation to GRIEVANCE level occurs)
- **`update_target`**: `path: "issue.actions"`, `action: "APPENDED"` — always append actions,
  never modify or delete prior actions

### Seller Action Types

1. **`PROCESSING`** — Seller acknowledges and is working on it
2. **`INFO_REQUESTED`** — Seller asks for more information (images, invoice, etc.)
   - Info request tag codes: `INFO001` (images), `INFO002` (video), `INFO003` (invoice)
3. **`RESOLUTION_PROPOSED`** — Seller offers resolution options to the complainant
4. **`RESOLVED`** — Seller has executed the resolution
5. **`CLOSED`** — Seller closes the complaint (rare from seller side)

### Resolution Structure

Resolutions appear **nested within the action** (`action.descriptor`) when code is `RESOLUTION_PROPOSED`:

```json
{
  "id": "A10",
  "descriptor": {
    "code": "RESOLUTION_PROPOSED",
    "short_desc": "PROVIDING RESOLUTION OPTIONS. PLEASE SELECT ONE"
  },
  "updated_at": "...",
  "action_by": "NP2",
  "resolutions": [
    {
      "id": "RESO-1",
      "descriptor": {
        "code": "REFUND",
        "short_desc": "Full refund for the item"
      },
      "ref": {
        "ref_id": "I1",
        "ref_type": "ITEM"
      },
      "requested_refund_amount": {
        "currency": "INR",
        "value": "300.00"
      },
      "tags": [
        {
          "code": "RESOLUTION_DETAILS",
          "list": [
            { "code": "ITEM", "value": "I1" },
            { "code": "REFUND_AMOUNT", "value": "300.00" }
          ]
        }
      ]
    },
    {
      "id": "RESO-2",
      "descriptor": {
        "code": "REPLACEMENT",
        "short_desc": "Replacement item"
      },
      "ref": {
        "ref_id": "I1",
        "ref_type": "ITEM"
      }
    }
  ]
}
```

**Resolution ref_type values**: `ORDER`, `PROVIDER`, `FULFILLMENT`, `ITEM`, `RESOLUTIONS`

### Resolution `descriptor.code` Values

| Code | Description |
|------|-------------|
| `REFUND` | Monetary refund |
| `REPLACEMENT` | Replacement item |
| `RETURN` | Return item (domain-specific) |

### RESOLUTION_DETAILS Tag Codes

| Tag Code | Description |
|----------|-------------|
| `ITEM` | The item ID(s) covered by the resolution |
| `REFUND_AMOUNT` | The refund amount (required when resolution involves refund) |

### Buyer Acceptance Flow

1. Seller sends `on_issue` with action `RESOLUTION_PROPOSED` and resolutions array
2. Buyer sends `issue` with action `RESOLUTION_ACCEPTED` and the accepted `resolution.id`
3. Seller sends `on_issue` with action `RESOLVED` (resolution has been **executed**)
4. Buyer sends `issue` with action `CLOSED` (optionally with positive/negative feedback)

**Important**: Resolution must be **executed** (step 3) before the ticket can be closed.
If buyer is not satisfied with execution, they escalate to GRIEVANCE level (GRO involvement).

### Resolution Rejection (TRV Flow 5)

If buyer rejects a resolution:
1. Buyer sends `issue` with action `RESOLUTION_REJECTED`
2. Seller must propose a **new** resolution (not just repeat the same one)

---

## `/issue_status` — Check Complaint Status

**Sent by**: BAP or BPP to poll for current complaint status

```json
{
  "context": { ... },
  "message": {
    "issue_id": "ISSUE-1",
    "status": {
      "descriptor": {
        "code": "OPEN"
      }
    }
  }
}
```

**Key difference from `/issue`**: `message.issue_id` is a **string ID** (not a full issue object).
This is a status-check call — the party already has the `issue_id` from the original `/issue`.
Contains **only** `issue_id` and `status` — it cannot modify the issue state.

---

## `/on_issue_status` — Returns Current State

**Sent by**: Respondent in response to `issue_status`

Returns the current full issue object with all action history so the requester can see
all updates that have happened since the issue was opened.

---

## TTL and Timing Rules

| Field | Value |
|-------|-------|
| TTL on all IGM calls | `PT30S` |
| Expected response time | `PT2H` (2 hours) |
| Expected resolution time | `P1D` (1 day) |

IGM TTL is fixed at `PT30S` — unlike core ONDC where TTL can vary per API.

---

## Error Codes (IGM)

| Code | API | Description |
|------|-----|-------------|
| *(domain errors)* | All (NACK) | Bad Request Error / Signature failure |
| `IGM001` | All (NACK) | Required fields not updated in API request / Schema failure |
| `IGM002` | `/on_issue` (error) | `order_id` does not exist or mismatched |
| `IGM003` | `/on_issue` (error) | `fulfillment_id` does not exist or mismatched |
| `IGM004` | `/on_issue` (error) | `item_id` does not exist or mismatched |
| `IGM005` | `/on_issue_status` (error) | Specified network issue id does not exist |
| `IGM006` | `/on_issue_status` (error) | NP subscriber id is not correct (`bap_id` / `bpp_id`) |
| `IGM007` | `/on_issue` (error) | Wrong escalation — issue must be escalated to GRO before going to ODR |
| `IGM008` | `/on_issue` (error) | Duplicate complaint (an OPEN complaint already exists with same item/fulfillment + same category + same sub-category) |
| `IGM009` | `/on_issue` (error) | Invalid `context.transaction_id` |
| `31001` | `issue` / `issue_status` (NACK) | Failed due to internal errors — retry per retrial mechanism |
| `23001` | `on_issue` / `on_issue_status` (NACK) | Failed due to internal errors — retry per retrial mechanism |

**Note**: `31001` and `23001` are **NACK** errors (signature/auth failures and internal errors),
not error objects within the response payload. The distinction is important for retry logic.

---

## `issue_status` vs `issue` — What's the Difference?

- **`/issue`**: Full complaint message — used to **raise** a new complaint, **update** it
  with information, **respond** to resolution offers, **accept/reject** resolutions, or **close** it.
- **`/issue_status`**: Status check — used to **poll** for the current state without modifying it.
  Contains only `issue_id` and `status` descriptor.

`issue_status` cannot modify issue state. You must use `/issue` for any state change.

---

## BAP IGM Processing Algorithm

When receiving `/on_issue`:

1. **Always `ACK`/`NACK`** — validate context, verify signature.
2. **Check `respondent_ids`** — confirm the responding NP(s) have taken ownership.
3. **Check `update_target`** — if `path = "issue.actions"` and `action = "APPENDED"`,
   a new action has been added — append it to local action history.
4. **Inspect `action.descriptor.code`**:
   - `PROCESSING` → issue is acknowledged, update local status to `PROCESSING`
   - `INFO_REQUESTED` → prompt buyer/user to provide requested info (images, invoice, etc.)
   - `INFO_PROVIDED` → info has been sent
   - `RESOLUTION_PROPOSED` → show resolution options to buyer for acceptance/rejection
   - `RESOLVED` → resolution has been executed — prompt buyer to close the ticket
   - `CLOSED` → no further action needed
5. **Store all action history** — the `actions` array is append-only.
6. **Check `resolver_ids`** — when GRO officers are involved, `resolver_ids` will contain
   their NP IDs (e.g., `NP2-GRO` with type `COUNTERPARTY_NP_GRO`).
7. **Buyer accepts resolution** — send `/issue` with `descriptor.code: "RESOLUTION_ACCEPTED"`
   and the `resolution.id`.
8. **Buyer rejects resolution** — send `/issue` with `descriptor.code: "RESOLUTION_REJECTED"`.
9. **Resolution executed** → prompt buyer to close with optional feedback.

---

## IGM and Core Transaction Interaction

- IGM **does not replace** the core transaction. The order still progresses through its
  normal fulfillment states (`Pending` → `Packed` → `Delivered` etc.).
- A buyer can have **multiple open issues** for the same order (separate `issue_id` for each).
- Issues can reference: ORDER, PROVIDER, FULFILLMENT, and ITEM levels.
- Settlement/refund via IGM resolution is **separate** from the cancellation settlement trail.
  When resolution involves a refund, seller sends `/on_update` to update the order with
  refund details and the settlement trail.
- **Cascaded complaints**: If a seller needs to involve another party (e.g., LSP for
  logistics issues), it can either reuse the same `issue.id` (maintaining a single
  complaint trail) or create a separate complaint trail. Both approaches are valid.

---

## Force Cancel → IGM Escalation Path

When BPP does not respond to `/cancel` within TAT:

```
1. BAP sends /cancel → no response within TAT
2. BAP resends /cancel with force:"yes" → no response within TAT
3. BAP sends /issue to escalate the complaint
   - status: "OPEN"
   - level: "ISSUE"
   - descriptor.code: issue category code (e.g., "CNR001" for cancellation issues)
   - refs: include ORDER ref
4. Seller responds via /on_issue
```

---

## Flow Summary: Buyer Complaint (Flow 1 — Item Quality)

```
[Buyer App]  /issue (OPEN) ────────────────→ [Seller App]  "Item quality issue (ITM004)"
[Seller App] /on_issue (PROCESSING) ─────────→ [Buyer App]   "Looking into it"
[Seller App] /on_issue (INFO_REQUESTED) ──────→ [Buyer App]  "Please upload images (INFO001)"
[Buyer App]  /issue (INFO_PROVIDED) ───────────→ [Seller App]  "Here are images"
[Seller App] /on_issue (RESOLUTION_PROPOSED) ──→ [Buyer App]  "Options: REFUND or REPLACEMENT"
[Buyer App]  /issue (RESOLUTION_ACCEPTED) ─────→ [Seller App]  "I accept REFUND"
[Seller App] /on_issue (RESOLVED) ─────────────→ [Buyer App]   "Refund processed"
[Buyer App]  /issue (CLOSED + feedback) ───────→ [Seller App]  "Confirmed closed"
```

For TRV Flow 5 (resolution rejection): after RESOLUTION_PROPOSED, buyer sends
RESOLUTION_REJECTED, seller must propose a new resolution.

---

## Key Constraints

- **Both Flow 1 and Flow 2 must be implemented** — all NPs must send AND consume all 4 APIs.
- `issue_status` is **status check only** — no state modifications via this API.
- The context object follows the same structure as core ONDC — same signing rules apply.
- `update_target = "issue.actions"` with `action = "APPENDED"` is how respondents append
  new actions to the issue history. Actions are **append-only**.
- **GRO escalation**: When a resolution is not executed satisfactorily, buyer escalates
  the issue level from `ISSUE` to `GRIEVANCE`. GRO officers from both NPs get involved.
- **Level 3 (ODR) is not yet on-protocol** — use the manual ODR process via ONDC Web.
- **Duplicate complaint rule**: IGM008 fires only when an **OPEN** complaint already exists
  with the same item/fulfillment AND category AND sub-category.
- **Resolution execution**: The resolution must be **executed** (`RESOLVED` action) before
  the buyer closes the ticket. Closing without execution may indicate an issue.
- **Feedback on close**: When buyer closes a complaint, they may optionally provide
  positive/negative or textual feedback.
