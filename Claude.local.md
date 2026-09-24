# Claude.local.md --- Local Project Guardrails

These are project-specific behavioral overrides. They are intentionally
strict.

## Absolute rules

### 1. NEVER TOUCH GIT WRITE STATE

Never execute: - git add - git commit - git push - git reset - git
restore - git checkout when it changes files - git stash - git merge -
git rebase - git cherry-pick

Read-only Git inspection is allowed.

If the user asks for a commit, provide the command they can run
themselves. Never run it.

### 2. ALWAYS SHOW THE PLAN FIRST

Before any implementation, modification, migration, refactor, or code
generation: - inspect relevant code, - inspect applicable API
contract, - produce a concrete implementation plan, - wait for explicit
approval.

No implementation is allowed in the same response as the plan.

"Proceed" / "implement it" / "go ahead" is required.

### 3. DO NOT MAKE SILENT ARCHITECTURAL DECISIONS

If a choice affects: - ONDC wire format, - API field names, - API
enums, - DB schema, - Redis keys, - transaction correlation, - state
transitions, - provider/location relationships, -
authentication/signing,

surface the decision in the plan.

### 4. DO NOT INVENT MISSING CONTRACT DETAILS

If the relevant ONDC contract section is not available, stop and ask for
it or identify the exact missing contract information.

### 5. DO NOT CHANGE ENVIRONMENT/SECRET FILES

Do not write to: - `.env` - `.env.*` - secret/key files - credential
files

Reading may be allowed when needed for debugging, but never write or
rotate values automatically.

### 6. KEEP CHANGES NARROW

Do not combine unrelated cleanup with the requested task.

### 7. VERIFY, DON'T CLAIM

Only say: - "tests pass" if tests were run and passed, - "build passes"
if build was run and passed, - "API is correct" if checked against the
applicable contract.

## ONDC-specific reminder

This is a Logistics Buyer NP implementation.

Treat the ONDC Logistics contract as the wire-level source of truth. The
contract defines the asynchronous request/callback model and the
`/search` → `/on_search`, `/init` → `/on_init`, `/confirm` →
`/on_confirm`, `/status` → `/on_status`, `/cancel` → `/on_cancel`,
`/update` → `/on_update`, and `/track` → `/on_track` flows.

Do not flatten provider, location, fulfillment, and item relationships
just because they look similar in application code.

## Preferred interaction

When asked to implement:

1.  "I will inspect..."
2.  Inspect.
3.  "Here is the plan..."
4.  Wait.
5.  Implement only after approval.
6.  Validate.
7.  Show diff summary and validation.

When asked to explain/debug without implementation: - investigate, -
explain, - do not modify code unless explicitly requested and approved
through the plan workflow.

# TESTING / CREDIT EFFICIENCY POLICY

Testing is NOT automatically required for every implementation.

Claude MUST NOT create new test files unless the user explicitly asks for tests.

Claude MUST NOT:

* create unit test files automatically
* create integration test files automatically
* create fixtures automatically
* create mocks automatically
* create test helpers automatically
* expand the test suite merely because code was changed
* spend significant effort designing tests unless requested

## Existing Tests

If relevant existing tests already exist, Claude MAY:

* inspect them
* run targeted existing tests
* use them to understand current behavior

Do not modify existing tests unless explicitly requested or unless a test must be updated because the user's approved implementation intentionally changes the expected behavior.

## Verification Without Creating Tests

When implementing a change, prefer lightweight verification:

1. TypeScript/type checking
2. Linting if already configured
3. Existing targeted tests, if they already exist
4. Build/compile checks
5. Database migration/schema validation
6. Direct inspection of generated SQL/schema
7. Focused manual verification where appropriate

Do not create new test infrastructure just to verify a change.

## If Tests Would Be Valuable

If Claude believes new tests are important, mention them in the plan under:

### Optional Tests

Example:

> Optional: add integration tests for `/on_search` duplicate callback handling.

Then STOP and wait for the user's decision.

Do not create those tests unless the user explicitly approves them.

## Priority

For this project, implementation efficiency is preferred over automatically expanding test coverage.

The default workflow is:

```text
Plan
  ↓
User approval
  ↓
Implement
  ↓
Lightweight verification
  ↓
Report result
```

NOT:

```text
Plan
  ↓
Implement
  ↓
Create many tests
  ↓
Create fixtures
  ↓
Create mocks
  ↓
Run entire test suite
```
## DOCUMENTATION POLICY

For now, do NOT create, update, or maintain documentation files as part of implementation work.

This includes:

* README files
* `.md` files
* architecture documents
* API documentation
* changelogs
* migration documentation
* comments/documentation whose only purpose is to document the change

Focus only on the actual implementation and required code/schema/config changes.

If documentation would normally be recommended, mention it as an optional follow-up, but do not create or modify it unless I explicitly ask.

### Exception: changelog entries are required

The bullet list above lists `changelogs` as excluded — that exclusion is
overridden by this exception. Starting 2026-09-24, every approved
implementation task MUST add a changelog entry. This is a standing
instruction, not automatic/speculative doc creation, so it is not blocked
by the rest of this policy.

- If the task changes anything under `src/` (including `src/flows/*`),
  add an entry to `changelogs/` (git-tracked).
- If the task only changes `test/` or `tasks/`, add an entry to
  `changelogs/local/` (gitignored).
- If a task touches both, add one entry to each directory.
- Filename: `YYYY-MM-DD-<short-slug>.md`. Use the template in
  `changelogs/_template.md` / `changelogs/local/_template.md`.
- No test files, fixtures, or other artifacts should be created to
  produce the changelog entry — it's a short markdown summary of what
  was actually implemented and validated, written after the fact.