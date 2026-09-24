# CLAUDE.md --- ONDC Logistics BAP

## 1. Project Identity

This repository implements an **ONDC Logistics Buyer NP (LBNP/BAP-side)
integration**.

The system is the buyer side of the logistics interaction: - Our
application acts as the Logistics Buyer NP. - External logistics
providers/LSPs act as Logistics Seller NPs. - ONDC network APIs are
asynchronous request/callback pairs. - The ONDC Logistics API contract
is the wire-level source of truth.

### Core principle

> Understand the existing architecture and contract first. Plan second.
> Implement third.

Never jump directly from a user request to code.

------------------------------------------------------------------------

## 2. HARD RULE --- NEVER PERFORM GIT WRITE OPERATIONS

Claude must **never**: - `git add` - `git commit` - `git push` -
`git reset` - `git restore` - `git checkout` when it changes working
state - `git stash` - `git merge` - `git rebase` - `git cherry-pick` -
amend/rewrite history - modify staging state

Read-only Git inspection is allowed: - `git status` - `git diff` -
`git log` - `git show` - `git blame` - `git branch --list` - equivalent
read-only inspection commands

If a commit is requested, do not perform it. Tell the user what should
be committed and provide the command for the user to run themselves.

------------------------------------------------------------------------

## 3. HARD RULE --- PLAN BEFORE IMPLEMENTATION

Before changing code, always provide a plan and wait for explicit
approval.

### Required workflow

1.  Inspect the relevant repository files.
2.  Identify the affected API/domain flow.
3.  Check the applicable ONDC contract and project skills.
4.  Explain the current behavior.
5.  Explain the proposed behavior.
6.  List files that will be changed/created.
7.  Call out assumptions, risks, and contract-sensitive decisions.
8.  Provide the implementation plan.
9.  **STOP and wait for explicit approval.**
10. Only after approval, implement.
11. Run relevant validation/tests.
12. Summarize exactly what changed.

Do not interpret vague statements such as "look into this", "what do you
think", or "how should we do this" as implementation approval.

Approval should be explicit, e.g.: - "Proceed" - "Implement it" - "Go
ahead with this plan"

If the user changes the scope, produce an updated plan before
continuing.

------------------------------------------------------------------------

## 4. API CONTRACT IS THE SOURCE OF TRUTH

For ONDC API work, never invent or casually infer a wire format.

The repository should maintain or point to the authoritative ONDC
Logistics contract. The supplied project reference is **ONDC Logistics
API Contract v1.2.5**.

Important contract concepts include: - `/search` → `/on_search` -
`/init` → `/on_init` - `/confirm` → `/on_confirm` - `/status` →
`/on_status` - `/cancel` → `/on_cancel` - `/update` → `/on_update` -
`/track` → `/on_track`

The contract defines request/response payloads, mandatory/optional
attributes, enumerations, expected behavior, signing/verification,
registry lookup, and asynchronous transaction behavior.

### API rules

Before changing any API-related code: - Read the relevant contract
section. - Identify the exact endpoint and direction. - Identify the
request and callback relationship. - Identify `transaction_id` and
`message_id` behavior. - Check mandatory vs optional fields. - Check
enums and state transitions. - Check idempotency/retry/NACK behavior
where applicable. - Check signing/verification requirements. - Check
whether the change is internal mapping or changes the ONDC wire payload.

If the contract does not support a proposed wire-level change, stop and
tell the user.

------------------------------------------------------------------------

## 5. API FLOW CONTEXT

### Pre-order

`/search` - Our LBNP specifies search intent. - Typical intent includes
category, fulfillment start/end locations, authorization, payment, and
package/payload details. - LSPs perform serviceability and return
catalog options.

`/on_search` - LSP returns catalog options. - This is asynchronous. -
Catalog data may include providers, provider locations, fulfillment
options, items, pricing, TAT, and distance-related information. - Treat
provider/location/item/fulfillment relationships carefully; do not
assume a provider location is interchangeable with a fulfillment
location.

`/init` - Our LBNP selects a catalog option and sends the order terms to
the LSP. - Provider identity and selected provider locations must remain
consistent with the selected catalog. - LSP performs serviceability
checks.

`/on_init` - LSP returns the initialized order, quote, payment
information, fulfillment information, cancellation terms, and applicable
tags/terms. - Cancellation terms and quote structure can be
contract-sensitive.

`/confirm` - Our LBNP places the logistics order. - The LBNP creates the
network-unique order ID. - The call should be idempotent. - LSP
validates and creates the order.

`/on_confirm` - LSP responds to confirmation. - The callback can contain
the accepted order, fulfillment state, AWB, tracking capability,
fulfillment details, and other applicable data. - Validate the response
against the selected order/catalog.

### Post-order

`/status` - LBNP requests current order status.

`/on_status` - LSP provides current fulfillment/order status. - Status
processing must preserve order/fulfillment identity and handle repeated
callbacks safely.

`/cancel` - LBNP requests cancellation.

`/on_cancel` - LSP responds to cancellation or may cancel directly
according to the contract.

`/update` - LBNP updates fulfillment information such as
authorization/PCC/DCC/payload-related details.

`/on_update` - LSP returns updated fulfillment details, potentially
including slots, shipping label/AWB/EBN, weight/dimension changes, etc.

`/track` - LBNP polls for live tracking when the fulfillment is eligible
for tracking.

`/on_track` - LSP returns tracking information/URL as defined by the
contract.

------------------------------------------------------------------------

## 6. ASYNCHRONOUS ARCHITECTURE

Do not design ONDC callbacks as ordinary synchronous CRUD endpoints.

The general pattern is:

`outbound request` → `ACK/NACK` → `async callback` → `callback ACK/NACK`

Correlation uses the ONDC transaction trail, especially: -
`transaction_id` - `message_id` - order ID after order creation

For callback processing: 1. Verify the request/signature. 2. Validate
the callback. 3. Correlate it to the originating transaction/order. 4.
Persist durable raw/staged data where the architecture requires it. 5.
Normalize/upsert domain data. 6. Update lifecycle/state. 7. Publish
application-facing updates such as SSE only after the authoritative
state is safely persisted.

Do not acknowledge a callback before the required durable processing
boundary has been reached.

------------------------------------------------------------------------

## 7. SECURITY / SIGNING CONTEXT

ONDC requests and responses are signed and verified.

Contract-level signing flow includes: - UTF-8 bytes from the JSON
payload - Blake2b hash - base64 digest - signature in authorization
header - verification using the sender's registry public key

Registry lookup is used to obtain the sender's signing public key. The
contract describes participant types and `/lookup`/`/vlookup`.

Never: - bypass signature verification, - fabricate a signature, -
silently accept malformed auth headers, - treat an unverified callback
as trusted application data.

Never expose private keys, secrets, or credentials in logs.

------------------------------------------------------------------------

## 8. DATA AUTHORITY

Use the existing project's data-authority rules rather than introducing
parallel sources of truth.

Default architectural principle:

**ONDC contract → PostgreSQL/domain persistence → Redis/cache →
frontend**

MongoDB, if present, is audit-oriented unless the repository explicitly
establishes another authority.

Do not introduce duplicate state merely to make a local implementation
easier.

------------------------------------------------------------------------

## 9. IDEMPOTENCY / RETRIES / DUPLICATE CALLBACKS

Assume network delivery can be repeated.

For each callback or request handler, ask: - What identifies the logical
transaction? - Can the same message be delivered twice? - What happens
if the worker crashes after persistence but before publishing? - What
happens if the ACK is lost and the sender retries? - Can an older/stale
callback arrive after a newer state? - Is the database update
idempotent?

Never solve duplicate delivery by simply ignoring all repeated requests.
Determine the correct idempotency boundary.

------------------------------------------------------------------------

## 10. PROVIDER / LOCATION / FULFILLMENT RULE

This project contains ONDC catalog relationships where: - a provider can
have one or more locations, - catalog fulfillments can reference
fulfillment-specific locations, - selected provider information may be
carried into later order APIs.

When changing provider/location handling: 1. Inspect the source
`/on_search` catalog shape. 2. Determine whether the selected object is
a provider, provider location, fulfillment, or normalized domain object.
3. Preserve IDs and relationships exactly. 4. Do not replace missing
arrays with arbitrary data unless the receiving contract/code explicitly
expects an empty array. 5. Prefer explicit conditional payload
construction over accidentally sending `undefined`, `null`, or an
invalid empty structure.

------------------------------------------------------------------------

## 11. CODE CHANGE DISCIPLINE

Prefer: - small, localized changes, - existing project abstractions, -
existing types/schemas, - existing service/repository patterns, -
explicit mapping functions, - deterministic behavior, - tests around
contract-sensitive transformations.

Avoid: - speculative refactors, - renaming unrelated code, - introducing
a new abstraction for one tiny use case, - changing API wire format for
convenience, - broad formatting churn, - changing database schema
without an explicit plan, - changing Redis key structures without
documenting the impact.

------------------------------------------------------------------------

## 12. TESTING / VALIDATION

After implementation: - run the narrowest relevant tests first, - run
type checking/build where applicable, - inspect the final diff, - verify
API payloads against the contract, - verify error/retry/idempotency
behavior, - report failures instead of hiding them.

Do not claim a test passed unless it was actually run.

Do not modify tests merely to make a failing implementation appear
correct.

------------------------------------------------------------------------

## 13. DOCUMENTATION

For meaningful API or architecture changes, update the repository's
existing documentation structure.

At minimum, consider: - API contract documentation - architecture
documentation - implementation/internal documentation -
changelog/decision records

Do not create a new documentation hierarchy if the repository already
has one.

Before creating a new document, search the repository for an existing
document covering the same subject.

### Changelog (required for every approved implementation)

After completing an approved implementation (workflow step 12 above),
add a changelog entry before reporting the task done:

- Changes under `src/` (including `src/flows/*` automated flow
  scripts) → add an entry to `changelogs/` (git-tracked).
- Changes only under `test/` or `tasks/` → add an entry to
  `changelogs/local/` (gitignored).
- A task touching both → one entry in each directory.

Filename: `YYYY-MM-DD-<short-slug>.md`, following
`changelogs/_template.md`. This applies to every approved task,
including small fixes — see `Claude.local.md` for the exception that
overrides the general documentation policy for this specific rule.

------------------------------------------------------------------------

## 14. RESPONSE FORMAT

For implementation requests, respond in this order:

### Plan

-   Goal
-   Current behavior
-   Proposed behavior
-   Files to change
-   API/contract impact
-   Data/state impact
-   Tests/validation
-   Risks/assumptions

Then wait for approval.

After approval:

### Implementation

Summarize changes actually made. Note the changelog entry file(s)
added (see §13).

### Validation

List commands/tests actually run and their results.

### Remaining

List anything that still needs user action.

------------------------------------------------------------------------

## 15. WHEN UNSURE

Do not guess.

Say: - what is known, - what is uncertain, - what file/contract/source
would resolve it, - and ask the minimum necessary question.

For ONDC wire-level questions, prefer the contract over intuition. For
repository behavior, prefer the existing code over generic architectural
assumptions.

## ONDC CONTRACT SOURCE

The authoritative ONDC Logistics API Contract is located at:

`docs/ondc/`

`docs/ondc/README.md lists the guide to use actualy ondc logistics api`

When working on ONDC API behavior, field semantics, required/optional
attributes, validation, signing, callbacks, error codes, or protocol
behavior, consult this document rather than guessing.

The contract is authoritative for ONDC semantics.

Existing TypeScript types, validators, and mappers describe our current
implementation and should be treated as implementation references, not as
a replacement for the contract.

Do not modify the contract file.