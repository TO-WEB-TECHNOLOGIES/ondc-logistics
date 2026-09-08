# Skill: ONDC Code Review

## Purpose

Review ONDC-related changes for contract, correctness, and operational
safety.

## Checklist

### Contract

-   [ ] Correct endpoint
-   [ ] Correct request/callback direction
-   [ ] Correct `context.action`
-   [ ] Correct `transaction_id`
-   [ ] Correct `message_id`
-   [ ] Mandatory fields preserved
-   [ ] Optional fields handled correctly
-   [ ] Enum values match contract
-   [ ] No invented wire fields

### Catalog/order relationships

-   [ ] Provider ID preserved
-   [ ] Provider location IDs preserved
-   [ ] Fulfillment IDs preserved
-   [ ] Item IDs preserved
-   [ ] Item → fulfillment relationship preserved
-   [ ] Selected catalog values are not silently replaced

### Async behavior

-   [ ] ACK/NACK behavior understood
-   [ ] Callback correlation deterministic
-   [ ] Duplicate callbacks safe
-   [ ] Retry behavior safe
-   [ ] Stale messages handled appropriately
-   [ ] Durable processing boundary respected

### Security

-   [ ] Signature verification occurs before trusting inbound data
-   [ ] Private keys/secrets never logged
-   [ ] Registry identity is not blindly trusted from unverified input

### Data

-   [ ] Existing source of truth preserved
-   [ ] No unnecessary duplicate persistence
-   [ ] DB/Redis changes documented
-   [ ] Migrations are safe and reversible where appropriate

### Tests

-   [ ] Happy path
-   [ ] Missing optional data
-   [ ] Invalid data
-   [ ] Duplicate callback
-   [ ] Retry
-   [ ] Stale callback where relevant
-   [ ] Serialization/wire payload test

### Git

-   [ ] No Git write operation performed
