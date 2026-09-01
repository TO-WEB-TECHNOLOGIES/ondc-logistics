---
name: use-api-contract
description: >
  Mandatory F&B Buyer NP (BAP) development knowledge for this ONDC project.
  This project is a Buyer App Platform (BAP) for the F&B domain (ONDC:RET11).
  Load this skill whenever working on any ONDC-related code — search/catalog
  ingestion, order flows (select/init/confirm/status/cancel), webhook handlers,
  signing, customization groups, payment flows, post-order escalations, IGM issue
  APIs (issue/on_issue/issue_status/on_issue_status), RSF 2.0 settlement flows
  (/settle, /on_settle, /report, /on_report, /recon, /on_recon), catalog status
  APIs (catalog_rejection), or any API request/response logic. Also trigger for
  questions about F&B catalog structure, customizations, cancellation terms, BPP
  behavior, order states, fulfillment states, transaction IDs, IGM complaint flows,
  settlement amounts (inter_participant, collector, self, provider), reconciliation
  (recon_accord, diff_value, settlement_date), settlement types (NP-NP, MISC, NIL),
  RSF error codes (70000–70030), NOCA/OCA bank accounts, or IGM complaint flows.
  This skill should be active for virtually all development work in this project.
---

# ONDC F&B Buyer NP — Development Knowledge

This project is a **Buyer NP (BAP)** for **ONDC F&B (domain: `ONDC:RET11`)**.
Your role: build the buyer-facing app and integration layer that talks to Seller NPs (BPPs).

Before writing any code, read the two reference files below. They contain the authoritative
rules from the ONDC API Contract for Retail v1.2.0, extracted and organized for this project.

---

## Required Reading

### 1. Core ONDC Knowledge (read first, always)

```
references/ondc-core-knowledge.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/ondc-core-knowledge.md`

Covers: BAP/BPP/Gateway/Registry roles, full order lifecycle, context object, Ed25519 signing,
registry lookup, domain codes, TTL semantics, error codes, NACK shape, incremental refresh.

### 2. F&B Buyer NP Reference (read second, always)

```
references/fnb-buyer-np.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/fnb-buyer-np.md`

Covers: F&B-specific catalog structure, customization groups, make-to-order `/select` payload,
BAP terms in search, transaction ID strategy, payment flows (BAP-collect vs BPP-collect),
cancellation rules, force cancellation, fulfillment states, seller NP behavior, and common BAP mistakes.

### 3. /search + /on_search Deep Reference (read when working on catalog / search logic)

```
references/search-on-search.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/search-on-search.md`

Read this when implementing or debugging anything related to:

- Sending `/search` (full catalog, incremental push/pull, stop, search by item/location)
- Ingesting `/on_search` catalog (providers, locations, categories, items, customizations, offers)
- Validating incoming `/on_search` payloads — field presence, enum values, CG integrity
- Incremental refresh subscription lifecycle and ACK/NACK error codes
- Catalog ingestion logic (full vs incremental, pagination, race condition handling)

Contains: all 7 `/search` payload variants, complete F&B `/on_search` schema with every field
documented, enum reference table, strict validation rules for every object type, and
step-by-step ingestion algorithms.

### 4. /select + /on_select Deep Reference (read when working on cart / quote logic)

```
references/select-on-select.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/select-on-select.md`

Read this when implementing or debugging anything related to:

- Building the `/select` request (F&B customized items with dynamic IDs, plain items, offers, fulfillment location, payment type)
- Processing `/on_select` responses — serviceability, quote structure, fulfillment options, offer breakup
- Validating incoming `/on_select` quotes — price integrity, quantity reductions, out-of-stock customizations
- Dynamic item ID contract — how to group base items + customizations with `parent_item_id`
- Handling multiple fulfillment types (Delivery, Self-Pickup, Buyer-Delivery) and time slots
- Error codes: 30009 (non-serviceable), 40002 (out of stock), 30023 (min order value), 22507 (quote mismatch)

Contains: complete `/select` and `/on_select` schemas, all 7 scenarios from the contract (including F&B
with full customization quote), enum tables for fulfillment state/type/category/title_type, quote
validation rules BAP must enforce, and step-by-step BAP processing algorithm for `/on_select`.

### 5. /init + /on_init Deep Reference (read when working on checkout / cancellation terms)

```
references/init-on-init.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/init-on-init.md`

**Scope**: Delivery fulfillment only. BAP-collected prepaid (ON-ORDER) only. No COD, no BPP payment.

Read this when implementing or debugging anything related to:

- Sending `/init` — billing address, delivery address, fulfillment_id on items, time slots
- Processing `/on_init` — validating frozen quote, storing cancellation terms
- Deciding when to re-call `/select` vs advance to `/init` vs re-call `/init`
- Cancellation terms format — fee per fulfillment state, reason codes, fixed vs percentage fees
- Error codes specific to /init/on_init — 30001, 30006, 30007, 40002
- Cancellation reason codes (Retail) — all current BNP and SNP codes with phases and applicability

Contains: complete `/init` and `/on_init` schemas, 3 `/init` scenarios (plain delivery, F&B customized,
slotted delivery), 3 `/on_init` scenarios (prepaid standard, quote change, F&B customized), full
cancellation_terms structure with F&B defaults, enum tables, error codes, all current cancellation
reason codes from Reason Codes doc, and step-by-step BAP processing algorithm.

### 6. BAP Prepaid Payment Reference (read when working on payment gateway / /confirm payment fields)

```
references/payment-bap-prepaid.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/payment-bap-prepaid.md`

**Scope**: BAP-collected prepaid (ON-ORDER) only. Covers /init → PG → /confirm payment lifecycle.

Read this when implementing or debugging anything related to:

- Payment gateway integration — triggering PG after `/on_init`, handling success/failure/timeout
- Building the `/confirm` payment object — `paid_amount`, `status`, `transaction_id`, `collected_by`
- Buyer app finder fee — what it is, where it appears, how to calculate, what it means for settlement
- Quote-to-payment validation — always use frozen `/on_init` quote, never `/on_select`
- Retry and idempotency — safely retrying PG without re-calling /init or double-charging
- PG failure scenarios — card declined, timeout, PG success + /confirm NACK

Contains: payment object schema at every API step (/init, /on_init, /confirm), complete /confirm
example with full order, buyer app finder fee explanation and formula, quote-to-payment validation
rules, full PG flow decision tree, all error/retry scenarios with correct BAP responses.

### 7. /confirm + /on_confirm Deep Reference (read when working on order confirmation / fulfillment state)

```
references/confirm-on-confirm.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/confirm-on-confirm.md`

**Scope**: BAP-collected prepaid (ON-ORDER) only. Delivery fulfillment only.

Read this when implementing or debugging anything related to:

- Sending `/confirm` — building the full order payload with payment proof, order.id generation
- Processing `/on_confirm` — BPP acknowledgment, state transitions, error handling
- Unsolicited `/on_status` — BPP-initiated state updates at any time
- Order state machine — Created → Accepted → fulfillment states → delivered
- BPP NACK handling — retry /confirm up to 3× before escalating to IGM
- What to do when payment was collected but /confirm NACKs — no auto-refund

Contains: complete `/confirm` schema with all fields, `/on_confirm` schema, order state machine,
fulfillment state progression table, BPP NACK response handling, unsolicited on_status processing
algorithm, complete example with full order payload, enum reference tables.

### 8. /status + /on_status Deep Reference (read when working on order tracking / polling)

```
references/status-on-status.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/status-on-status.md`

**Scope**: BAP-collected prepaid (ON-ORDER) only. Delivery fulfillment only.

Read this when implementing or debugging anything related to:

- Polling `/status` — intervals, TAT tracking, when to stop
- Processing `/on_status` — fulfillment state progression (Pending → Packed → Order-picked-up → Out-for-delivery → Delivered)
- Unsolicited BPP callbacks — accepting and processing unprompted /on_status
- Cancellation during fulfillment — item-level rules, mid-fulfillment cancel, TAT breach cancel
- TAT breach handling — buyer messaging, force cancel escalation, IGM issuance
- Delivery agent tracking — agent info, timeline tags, split shipments

Contains: complete `/status` and `/on_status` schemas, polling algorithm with intervals,
fulfillment state code reference table, TAT breach decision tree, mid-fulfillment cancellation
rules, unsolicited callback processing algorithm, full BAP internal state machine.

### 9. /track + /on_track Deep Reference (read when working on live rider tracking)

```
references/track-on-track.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/track-on-track.md`

**Scope**: BAP-collected prepaid (ON-ORDER) only. Delivery fulfillment only.

Read this when implementing or debugging anything related to:

- Requesting live GPS coordinates for a delivery rider (`/track`)
- Processing tracking response payloads from BPP (`/on_track`)
- Hyperlocal tracking (`gps_enabled`) vs non-hyperlocal tracking (`url_enabled`)
- When to call `/track` vs when you'll get NACK 40005
- Tracking state machine: `active` → `inactive` after delivery
- Relationship between `/track` and `/status` polling (independent, can run concurrently)

Contains: complete `/track` and `/on_track` schemas, GPS + URL tracking modes,
fulfillment tracking flags from `/on_status`, tracking lifecycle, error codes,
BAP polling strategy, quick lookup table.

### 10. /cancel + /on_cancel Deep Reference (read when working on order cancellation)

```
references/cancel-on-cancel.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/cancel-on-cancel.md

**Scope**: BAP-collected prepaid (ON-ORDER) only. Delivery fulfillment only.

Read this when implementing or debugging anything related to:

- Sending `/cancel` — buyer-initiated cancellation with reason codes 001–006
- Processing `/on_cancel` — BPP acknowledgment or BPP/seller-initiated unsolicited cancel
- Cancellation reason codes — which are buyer-usable vs. seller-only
- Cancellation fees — how they're calculated from `cancellation_terms` by fulfillment state
- Force cancellation — `force:"yes"` when BPP doesn't respond within TAT
- Unsolicited `/on_cancel` — BPP-initiated cancellation at any time, buyer NACK 22502
- NACK 30012 and 30014 — invalid reason and TAT-not-breached handling
- IGM escalation when force cancel fails — see Reference #14 for IGM/issue APIs

Contains: complete `/cancel` and `/on_cancel` schemas, cancellation reason code table,
cancellation_terms structure, cancellation decision tree, error codes, force cancel flow.

### 11. Returns + Replacements + LSP Cancellation (read when working on post-delivery flows)

```
references/returns-replacements.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/returns-replacements.md

**Scope**: BAP-collected prepaid (ON-ORDER) only. F&B items are non-returnable by default.

Read this when implementing or debugging anything related to:

- Buyer-initiated returns — `/update` with `update_target = "item"`, reverse QC fulfillment
- Buyer-initiated replacements — `/update` with two fulfillments (forward Delivery + reverse QC)
- Seller App rejection — policy error codes 50001 (cancel) and 50002 (replace)
- LSP-initiated cancellation — RTO flow, replacement LSP logic
- Settlement trail on refund — `settlement_details` after `/on_cancel` or return delivery

Contains: full returns/replacements flow, `/update` schema for both flows, Reverse QC
fulfillment structure, LSP cancellation reason codes, settlement field definitions.

### 12. /update + /on_update Deep Reference (read when working on order updates, returns, or replacements)

```
references/update-on-update.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/update-on-update.md

**Scope**: BAP-collected prepaid (ON-ORDER) only. Delivery fulfillment only.

Read this when implementing or debugging anything related to:

- Sending `/update` — `update_target` values: `"item"` (returns/replacements), `"payment"` (settlement trail), `"fulfillment"` (LSP/agent updates), `"order"` (order-level)
- Processing `/on_update` — BPP acknowledgment of buyer-initiated or unsolicited seller-initiated
- Return flow — 6-step state machine: Interim → Approved → Return_Picked → Return_Delivered/Liquidated → settlement
- Fulfillment update tags — `update_state`, `cancel_request`, `update_fulfillment_time`, `fulfillment_delay`, `update_agent_details`, `update_label`, `reverseqc_output`
- Merchant/seller part cancellation — unsolicited `/on_update` with `update_target = "item"` reducing quantities
- Dynamic item cancel rule — base item + customizations must cancel in same proportion (NACK 22508)
- Order value invariant — order value cannot increase via `/on_update`; decrease only via quantity reduction
- Settlement trail — `update_target = "payment"` sends `settlement_details` to close the refund loop

Contains: complete `/update` and `/on_update` schemas, all 4 `update_target` scenarios, return flow
state machine, fulfillment tag reference table, error codes (22508, 40003, 40004), merchant part cancel flow.

### 13. Full API Contract (read for specific endpoint schemas)

```
documentation/ONDC - API Contract for Retail (v1.2.0).docx
```

Absolute: `/Users/professor/Desktop/ondc-api/documentation/ONDC - API Contract for Retail (v1.2.0).docx`

Read this when you need the exact JSON payload for a specific action, field-level constraints,
enumeration values, or to verify something not covered in the reference files.

### 14. IGM Issue / Grievance / Dispute APIs (read when handling post-order escalations)

```
references/issue-igm-apis.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/issue-igm-apis.md`

**Scope**: All IGM APIs: `/issue`, `/on_issue`, `/issue_status`, `/on_issue_status`.
Both Flow 1 and Flow 2 must be implemented.

Read this when implementing or debugging anything related to:

- Raising a complaint via `/issue` — `status: OPEN`, `level: ISSUE/GRIEVANCE/DISPUTE`, refs to ORDER/PROVIDER/FULFILLMENT/ITEM
- Processing seller responses via `/on_issue` — `PROCESSING`, `RESOLVED`, info requests
- Resolution flow — REFUND/REPLACEMENT via `resolutions[]`, `RESOLUTION_ACCEPTED` action
- Checking issue status via `/issue_status` — poll without modifying
- Force cancel escalation — when BPP doesn't respond to `/cancel` with `force:"yes"`, issue is the next step
- Action history — `update_target: "issue.actions"` with `action: "APPENDED"` for appending to action array
- Error codes IGM001–IGM009, TTL PT30S, expected_response_time PT2H, expected_resolution_time P1D

Contains: complete IGM schema for all 4 APIs, status/level/action descriptor/enum reference tables,
resolution structure with RESOLUTION_DETAILS tags, error code table, BAP processing algorithm,
and force cancel → IGM escalation flow.

### 15. RSF 2.0 — Reconciliation and Settlement Framework (read when working on settlement / reconciliation)

```
references/rsf-2.0.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/rsf-2.0.md`

**Scope**: RSF 2.0 APIs: `/settle`, `/on_settle`, `/report`, `/on_report`, `/recon`, `/on_recon`.
Domain: `ONDC:NTS10`. RSF 1.0.0 is deprecated.

Read this when implementing or debugging anything related to:

- Sending `/settle` — collector vs receiver perspective, amount fields (inter_participant, collector, self, provider)
- Processing `/on_settle` — success with settlement_ref_no, or error codes 70000–70027
- `/report` + `/on_report` — querying settlement status when on_settle not received
- Bi-directional `/recon` + `/on_recon` — orderbook reconciliation, recon_accord true/false, settlement_date
- Settlement types: NP-NP (inter-NP), MISC (NOCA→operative), NIL (no settlement)
- Refund after settlement — roles reverse, new reconciliation required
- Error codes 70000–70030, TTL P1D, NOCA/OCA bank account requirements
- Testing: NBBL pre-prod for settle/report; ONDC mock server for recon

Contains: complete RSF API schemas, amount field meanings, settlement type enum, error code table,
reconciliation flow with recon_accord logic, refund reversal flow, NOCA/OCA requirements,
and illustrative examples for retail prepaid, retail PoD, and logistics transactions.

### 16. Network Observability (NO) API — Transaction Log Push (read when integrating NO API or pushing txn logs)

```
references/network-observability.md
```

Absolute: `/Users/professor/Desktop/ondc-api/.claude/skills/use-api-contract/references/network-observability.md`

**Scope**: ONDC Network Observability API for pushing transaction logs to ONDC analytics.
Pre-prod endpoint: `https://analytics-api-pre-prod.aws.ondc.org/v1/api/push-txn-logs`.
Bearer token auth from NP portal (valid 10 days for pre-prod).

Read this when implementing or debugging anything related to:

- Pushing transaction logs to the NO API after any ONDC API call (core, IGM, or RSF)
- Building the NO API payload with correct `type` field naming (e.g., `recon`, `recon_response`)
- Understanding NO API response codes (200 success, 2001 warning, 4001/4002/4003 errors)
- Anonymization rules (PII must be removed, city/pincode must be kept)
- Dashboard verification at analytics-dashboard.ondc.org

Contains: complete NO API payload schema, type value reference tables for all ONDC APIs
(core retail/logistics, IGM, RSF), example payloads for recon/on_recon/settle flows,
error code table, response codes, anonymization requirements, and dashboard info.

---

## This Project's Role: Buyer NP (BAP)

The BAP owns:

- **Outbound requests**: `/search` (via Gateway), `/select`, `/init`, `/confirm`, `/status`, `/cancel`, `/track`
- **Inbound webhook**: receives `on_search`, `on_select`, `on_init`, `on_confirm`, `on_status`, `on_cancel`, `on_track`
- **Catalog storage**: ingests and caches BPP catalogs (full + incremental refresh)
- **Order state machine**: tracks order + fulfillment states per order
- **Rider tracking**: polls `/track` for live GPS when `gps_enabled="yes"` in `/on_status`, shows tracking URL when `url_enabled="yes"`

The BAP does **not** own fulfillment or seller catalog management — those are the BPP's responsibility.
But understanding BPP behavior is essential because it dictates what the BAP must handle in callbacks.

---

## F&B Domain Rules (What Makes RET11 Different)

- Domain: `"ONDC:RET11"` in every context object
- Search: **city-only** — no `category.id` filtering (unlike Grocery RET10)
- Catalog: make-to-order model with **customization groups** and **customization items**
- Every F&B provider must have `@ondc/org/fssai_license_no`
- Transaction IDs: for catalog-cached BAPs, use a new `transaction_id` per order starting at `/select`

---

## Core Development Principles

**You are async all the way.** Every outbound request gets an immediate ACK/NACK, then the real
response arrives via async callback. Design your webhook handlers to be fast, idempotent, and
decoupled from your outbound request flow. Never block waiting for a callback.

**Sign everything you send, verify everything you receive.** Ed25519 over BLAKE2b-512 digest.
Reject incoming callbacks with HTTP 401 if signature verification fails. This is a network-level
security guarantee — don't skip it.

**The F&B catalog has a mandatory CG contract.** If a base item has a mandatory Customization
Group (min > 0) and that CG has no valid customizations defined, you must disable the base item.
Showing disabled items to buyers leads to broken order flows — the BPP will NACK or error.

**Quote is not frozen until `/on_init`.** If the buyer changes address or cart items, call
`/select` again. Only proceed to `/confirm` after validating the quote from `/on_init`.

**Handle unsolicited callbacks.** BPPs can send `/on_status` (state updates) and `/on_cancel`
(seller-initiated cancellation) at any time — not just in response to BAP requests. Your webhook
must accept and process these.

**BAP payment collection is always mandatory.** This project does not support BPP payment collection.
The BAP always declares `collected_by: "BAP"` in `/init`, regardless of what the BPP's
`bpp_terms.collect_payment` flag indicates. If `/on_init` echoes back `collected_by: "BPP"`,
log and alert engineering — this is a BPP misconfiguration and should not occur.

---

## Order Flow at a Glance

```
[BAP]  /search ──────→ Gateway → all BPPs in domain+city
[BPP]  /on_search ───→ BAP webhook (catalog, async)

[BAP]  /select ───────→ BPP  (cart with dynamic item IDs + customization selections)
[BPP]  /on_select ───→ BAP webhook (serviceability check + quote)

[BAP]  /init ─────────→ BPP  (billing + delivery address + payment preference)
[BPP]  /on_init ─────→ BAP webhook (frozen quote + cancellation terms + payment link if BPP collects)

[BAP]  /confirm ──────→ BPP  (order.id + order.state:"Created" + payment reference)
[BPP]  /on_confirm ──→ BAP webhook (order.state:"Accepted" or deferred)

[BAP]  /status ───────→ BPP  (poll order + fulfillment states)
[BPP]  /on_status ───→ BAP webhook (Pending→Packed→Order-picked-up→Out-for-delivery→Order-delivered)

[BAP]  /cancel ───────→ BPP  (with cancellation_reason_id)
[BPP]  /on_cancel ───→ BAP webhook (Cancelled state + updated quote with cancellation fee)

[BAP]  /track ───────→ BPP  (poll live GPS — only when gps_enabled="yes" or url_enabled="yes")
[BPP]  /on_track ────→ BAP webhook (GPS coordinates + tracking URL, status: active/inactive)
```

---

## Files Structure Reference

```
.claude/skills/use-api-contract/
├── SKILL.md                           ← this file
└── references/
    ├── ondc-core-knowledge.md         ← protocol fundamentals
    ├── fnb-buyer-np.md                ← F&B + BAP contract details (all APIs)
    ├── search-on-search.md            ← /search + /on_search deep reference
    ├── select-on-select.md            ← /select + /on_select deep reference
    ├── init-on-init.md                ← /init + /on_init deep reference
    │                                     (cancellation terms, all reason codes)
    ├── payment-bap-prepaid.md         ← /init → PG → /confirm payment lifecycle
    ├── confirm-on-confirm.md          ← /confirm + /on_confirm deep reference
    ├── status-on-status.md            ← /status + /on_status deep reference
    ├── track-on-track.md              ← /track + /on_track deep reference
    ├── cancel-on-cancel.md           ← /cancel + /on_cancel deep reference
    │                                     (cancellation reason codes, force cancel,
    │                                      unsolicited on_cancel, NACK 30012/30014/
    │                                      22502, part cancel, LSP cancellation)
    ├── returns-replacements.md        ← Returns + Replacements + LSP cancellation
    │                                     (update flow, reverse QC, settlement trail)
    ├── update-on-update.md            ← /update + /on_update deep reference
    │                                     (4 update_targets, return flow state machine,
    │                                      fulfillment tags, NACK 22508, settlement)
    ├── issue-igm-apis.md              ← IGM Issue/Grievance/Dispute APIs
    │                                     (/issue, /on_issue, /issue_status,
    │                                      /on_issue_status, resolution flow,
    │                                      force cancel → IGM escalation)
    ├── rsf-2.0.md                     ← RSF 2.0 Reconciliation & Settlement Framework
    │                                     (/settle, /on_settle, /report, /on_report,
    │                                      /recon, /on_recon, settlement types,
    │                                      error codes 70000–70030, NOCA/OCA)
    └── catalog-rejection.md           ← /catalog_rejection deep reference
                                          (BAP → BPP API for rejecting invalid
                                           on_search catalogs after ACK, error
                                           codes 20001–20011)

documentation/
└── ONDC - API Contract for Retail (v1.2.0).docx  ← authoritative spec
```

---

## Quick Lookup

**F&B search sends**: city, delivery end location, `payment.buyer_app_finder_fee_*`, `bap_terms` tag

**Customization in `/select`**: each cart line uses a shared `parent_item_id` (dynamic ID); base item tag `type:"item"`, each option tag `type:"customization"` + `parent: CG_id`

**Fulfillment states**: `Pending → Packed → Agent-assigned → Order-picked-up → Out-for-delivery → Order-delivered`

**Cancel via /cancel**: valid in `Pending`, `Packed`, `Agent-assigned`, `Order-picked-up` states; NOT allowed in `Out-for-delivery` or `Order-delivered` (NACK 30014)

**BAP cancellation reason IDs**: 001 (price change), 002 (item unavailable), 003 (lower price elsewhere), 004 (pending delivery), 005 (merchant not accepting), 006 (TAT breach — no cancellation fee)

**Force cancel**: if BPP doesn't respond to `/cancel` within TAT → resend with `force:"yes"` → if still no response → IGM issue (see Reference #14)

**NACK errors to know**: `30023` (min order value), `30012` (invalid cancel reason), `30014` (cannot cancel at this stage), `22502` (invalid seller cancel reason in unsolicited on_cancel), `40005` (track called before rider assigned or tracking disabled)

**`/status` polling**: 30 s intervals when `Pending` after `/on_confirm`; 60 s during active fulfillment; stop at `Delivered` or `Cancelled`

**`/on_status` unsolicited**: BPP may send without BAP polling — accept and process regardless of whether BAP sent `/status` first

**`/on_cancel` unsolicited**: BPP can cancel without `/cancel` — `cancelled_by: "sellerNP.com"`; BAP may NACK 22502 if reason invalid

**TAT breach cancel**: reason code `006` = buyer-initiated after TAT breach — no cancellation fee

**Part cancel rule**: `Order.state = "Created"` → item-level part cancel; any other state → fulfillment-level part cancel only

**Returns**: only for items with `@ondc/org/returnable = "true"`; F&B is non-returnable by default

**Return flow states**: `Interim` → `Approved` → `Return_Picked` → `Return_Delivered/Liquidated` → settlement trail

**Replacement policy rejection**: Seller returns `50002` on `/update` if replacement not allowed

**`/update` `update_target` values**: `"item"` (return/replace), `"payment"` (settlement trail), `"fulfillment"` (LSP/agent updates), `"order"` (order-level)

**Dynamic item cancel rule**: base item + customizations must cancel in same proportion via `/update`; NACK `22508` if proportions differ

**Order value invariant**: order value cannot increase via `/update`; decrease only via quantity reduction

**LSP cancellation**: LSP → entity that confirmed logistics → replacement LSP found or retail order cancelled + refund

**Settlement on refund**: `settlement_counterparty: "buyer"`, `settlement_phase: "refund"`, `settlement_status: "forward-settled"`

**`/confirm` order.id**: BAP-generated UUID — NOT the same as `transaction_id`. First appears in `/confirm`. Generate fresh per order; reuse on retry for idempotency.

**`/confirm` order.state**: always `"Created"` (BPP transitions to `"Accepted"` in `/on_confirm`)

**`/confirm` payment.status**: always `"PAID"` — payment already collected by BAP's PG before sending `/confirm`

**`/confirm` payment.transaction_id**: PG's own reference (e.g. HDFC txn ref) — NOT the ONDC `transaction_id`

**`/confirm` payment.paid_amount**: must exactly equal `on_init.quote.price.value` (the frozen quote)

**BPP NACK on `/confirm`**: code determines action — `31002` (validation fail) → cancel(999); `31001` (retryable) → retry; `30018` (order not found) → cancel(999). No auto-refund.

**`/confirm` cancellation**: reason code `999` = BAP-initiated after `/confirm` failure; reason code `998` = BPP-initiated after `/on_confirm` NACK received by SNP

**`/on_confirm` NACK at BNP**: SNP receives NACK with `23002` → SNP cancels with reason `998`; BAP processes refund. `31003` = SNP retry in progress, do not cancel.

**Unsolicited `/on_status`**: BPP can send at any time — accept and process regardless of whether BAP sent a `/status` request

**`/track` call condition**: rider assigned AND (gps_enabled="yes" OR url_enabled="yes") in `/on_status` fulfillment.tags

**`/track` NACK 40005 when**: rider not assigned, tracking not yet enabled (gps/url both "no"), or order already delivered

**Tracking status**: `"active"` during fulfillment (rider assigned → delivered), `"inactive"` after delivery

**Tracking flags in `/on_status`**: `gps_enabled` ("yes"=GPS polling), `url_enabled` ("yes"=external URL), `url` (the URL string)

---

## RSF 2.0 Quick Lookup (Settlement and Reconciliation)

**RSF domain**: `ONDC:NTS10` (not RET11)

**Settlement types**: `NP-NP` (inter-NP order), `MISC` (NOCA→operative), `NIL` (no settlement)

**Amount fields in `/settle`**: `inter_participant` (collector→receiver), `collector` (finder fee), `self` (callers operative), `provider` (optional, receiver side only)

**TTL**: `P1D` for all RSF APIs

**ACK/NACK on `/on_settle`**: ACK all or NACK all — no partial acknowledgment

**`recon_accord` in `/on_recon`**: `true` = agree + provide `settlement_date`; `false` = disagree + provide `diff_value`

**Reconciliation can be initiated by both** collector and receiver; `bap_id`/`bpp_id` stays as per original order transaction

**Error codes 70000–70030**: 70000–70027 on_settle, 70028–70029 on_report, 70030 on_recon

**NOCA**: mandatory for collectors and MSN seller NPs opting in for direct provider settlement; OCA mandatory for all NPs

**Testing**: Settle/Report → NBBL pre-prod; Recon → ONDC mock server or another NP

**Refund after settlement**: roles reverse → new `/recon` with updated settlement object → both send `/settle`

**Settlement basis + window**: from `on_confirm` — `@ondc/org/settlement_basis` (event trigger) + `@ondc/org/settlement_window` (e.g., P1D = 1 day after event)

**Buyer app daily `/settle`**: send even for null settlements to prevent unintended debits based on seller-side `/settle`

---

## Network Observability (NO) API Quick Lookup

**NO API endpoint**: `https://analytics-api-pre-prod.aws.ondc.org/v1/api/push-txn-logs`

**Auth**: Bearer token from NP portal (valid 10 days for pre-prod)

**NO `type` field pattern**:

- Outbound request: `<action>` (e.g., `recon`, `on_recon`, `settle`)
- Sync ACK/NACK response: `<action>_response` (e.g., `recon_response`, `on_recon_response`)

**RSF API `type` values**: `recon`, `recon_response`, `on_recon`, `on_recon_response`, `settle`, `settle_response`, `on_settle`, `on_settle_response`, `report`, `report_response`, `on_report`, `on_report_response`

**NO API response**: HTTP 200 `{"message": "Successful"}` — may include warning 2001 for extra fields

**NO API errors**: 4001 (REQUIRED_FIELD), 4002 (INVALID_DATA_TYPE), 4003 (INVALID_ENUM_VALUE)

**Anonymization**: Remove PII, but **do NOT anonymize** city and pincode/area_code

**Dashboard**: https://analytics-dashboard.ondc.org/public/dashboard/83a560f2-cc19-4b9c-a2a3-95047b775ea8 (data appears ~20 min after push)

**Key difference from RSF context**: RSF uses `version: "2.0.0"` and `location.country.code` + `location.city.code`; core ONDC uses `core_version` and `city` as string like `"std:080"`

---

## IGM Quick Lookup (Issue / Grievance / Dispute)

**IGM core version**: `1.2.0` for RET10/RET11; `2.0.1` for TRV10

**Issue status lifecycle**: `OPEN` → `PROCESSING` → `RESOLVED` → `CLOSED`

**Issue levels**: `ISSUE` (L1) | `GRIEVANCE` (L2, GRO) | `DISPUTE` (L3, ODR — not yet live)

**Actor types**: `CONSUMER` | `INTERFACING_NP` | `COUNTERPARTY_NP` | `INTERFACING_NP_GRO` | `COUNTERPARTY_NP_GRO`

**Action codes**: `OPEN` | `PROCESSING` | `INFO_REQUESTED` | `INFO_PROVIDED` | `INFO_NOT_AVAILABLE` | `RESOLUTION_PROPOSED` | `RESOLUTION_ACCEPTED` | `RESOLUTION_REJECTED` | `RESOLUTION_CASCADED` | `RESOLVED` | `CLOSED`

**Status → Actions**: OPEN→[OPEN]; PROCESSING→[PROCESSING, INFO_REQUESTED, INFO_PROVIDED, INFO_NOT_AVAILABLE, RESOLUTION_PROPOSED, RESOLUTION_ACCEPTED, RESOLUTION_REJECTED, RESOLUTION_CASCADED]; RESOLVED→[RESOLVED]; CLOSED→[CLOSED]

**Ref types**: `ORDER` | `PROVIDER` | `FULFILLMENT` | `ITEM` | `RESOLUTIONS`

**Resolution codes**: `REFUND` | `REPLACEMENT` | `RETURN`

**RESOLUTION_DETAILS tags**: `ITEM` (item ID), `REFUND_AMOUNT` (refund value)

**IGM TTL**: always `PT30S`

**IGM timing**: `expected_response_time: PT2H`; `expected_resolution_time: P1D`

**IGM errors**: IGM001 (schema fail), IGM002 (order_id mismatch), IGM003 (fulfillment_id mismatch), IGM004 (item_id mismatch), IGM005 (issue_id not found), IGM006 (bad bap_id/bpp_id), IGM007 (wrong escalation to ODR), IGM008 (duplicate open complaint), IGM009 (bad transaction_id); 31001 (retry on issue/issue_status NACK); 23001 (retry on on_issue/on_issue_status NACK)

**`update_target` for actions**: `path: "issue.actions"`, `action: "APPENDED"` — always append, never modify/delete

**`/issue_status`**: status check only — contains `issue_id` string, not full issue object. Cannot modify issue state.

**Bi-directional**: both buyer and seller can raise complaints; all NPs must send AND consume all 4 APIs

**source_id vs complainant_id**: source_id = consumer who originated; complainant_id = NP that filed the complaint

**Force cancel escalation**: `/cancel` → no response → `/cancel force:"yes"` → no response → `/issue` (OPEN)
