# ONDC F&B — /catalog_rejection Reference

Authoritative specification for `/catalog_rejection` for F&B (ONDC:RET11), extracted
from ONDC Catalog Status APIs v1.2.0. Use this for implementing catalog rejection
when an incoming `/on_search` payload fails schema validation after ACK has been sent.

---

## Table of Contents

1. [Overview](#1-overview)
2. [When to Call /catalog_rejection](#2-when-to-call-catalog_rejection)
3. [Request Schema](#3-request-schema)
4. [Response Schema](#4-response-schema)
5. [Error Codes](#5-error-codes)
6. [BAP Processing Algorithm](#6-bap-processing-algorithm)
7. [Signing Requirements](#7-signing-requirements)
8. [Example Payload](#8-example-payload)

---

## 1. Overview

`/catalog_rejection` is a BAP-to-BPP synchronous API that allows the Buyer App Platform
to formally reject a BPP's catalog callback (`/on_search`) when the catalog data fails
schema validation. Unlike NACK (which is an immediate synchronous rejection), catalog_rejection
is called **after** ACK has already been sent — during the async processing phase when
deeper validation discovers schema violations.

**Key characteristics**:

- Direction: BAP → BPP (synchronous HTTP POST)
- Not a callback — BAP initiates this call
- Requires BAP to sign the request with Ed25519 private key
- BPP responds with ACK or NACK

---

## 2. When to Call /catalog_rejection

Call `/catalog_rejection` when:

1. ACK has already been sent for the `/on_search` callback
2. Async processing (in `enqueueOnSearch`) performs deeper schema validation
3. Validation fails due to one or more of:
   - Invalid or missing provider descriptor
   - Missing mandatory provider fields
   - Invalid/missing FSSAI license number
   - Item schema violations (after provider-level checks pass)
   - Category schema violations
   - Offer schema violations

**NOT used for** (these use NACK instead):

- Incremental push with unknown provider/location/item (codes 20003/20004/20005)
- Missing Authorization header
- Signature verification failure
- Invalid context object

---

## 3. Request Schema

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "country": "IND",
    "city": "std:080",
    "action": "catalog_rejection",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T1",
    "message_id": "M_REJ_001",
    "timestamp": "2023-06-03T08:00:30.000Z"
  },
  "errors": [
    {
      "type": "PROVIDER-ERROR",
      "code": "20007",
      "message": "Provider P1: missing mandatory field descriptor.name",
      "path": "bpp/providers/0/descriptor/name"
    },
    {
      "type": "ITEM-ERROR",
      "code": "20009",
      "message": "Item I5: price.value is missing",
      "path": "bpp/providers/0/items/4/price/value"
    }
  ]
}
```

### Context Fields

| Field            | Value                     | Notes                            |
| ---------------- | ------------------------- | -------------------------------- |
| `domain`         | `"ONDC:RET11"`            | Fixed for F&B                    |
| `action`         | `"catalog_rejection"`     | API identifier                   |
| `core_version`   | `"1.2.0"`                 | ONDC protocol version            |
| `bap_id`         | BAP subscriber ID         | From app constants               |
| `bap_uri`        | BAP callback URI          | From app constants               |
| `bpp_id`         | From original `on_search` | Must match incoming callback     |
| `bpp_uri`        | From original `on_search` | Target for this POST             |
| `transaction_id` | From original `on_search` | Correlates with original request |
| `message_id`     | Fresh UUID                | New unique ID for this message   |
| `timestamp`      | Current ISO 8601          | Indian time                      |

### errors[] Fields (root-level array)

| Field     | Type              | Description                                                          |
| --------- | ----------------- | -------------------------------------------------------------------- |
| `type`    | string            | Error category: `"BPP-ERROR"`, `"PROVIDER-ERROR"`, or `"ITEM-ERROR"` |
| `code`    | string            | Error code from §5                                                   |
| `message` | string            | Human-readable description                                           |
| `path`    | string (optional) | JSON path to the failing field in original catalog                   |

---

## 4. Response Schema

**Success (ACK)**:

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "catalog_rejection",
    "bap_id": "sellerNP.com",
    "bpp_id": "buyerNP.com",
    "transaction_id": "T1",
    "message_id": "M_REJ_001",
    "timestamp": "2023-06-03T08:00:35.000Z"
  },
  "message": {
    "ack": {
      "status": "ACK"
    }
  }
}
```

**Failure (NACK)**:

```json
{
  "context": { ... },
  "message": {
    "ack": { "status": "NACK" }
  },
  "error": {
    "type": "DOMAIN-ERROR",
    "code": "20002",
    "message": "Invalid catalog_rejection payload"
  }
}
```

---

## 5. Error Codes

| Code    | Description                       | When Used                                                   |
| ------- | --------------------------------- | ----------------------------------------------------------- |
| `20001` | Catalog parsing failure           | Cannot parse JSON or structure is completely invalid        |
| `20002` | Schema validation failure         | Field-level validation errors                               |
| `20003` | Provider not found                | Incremental push — provider not in cache (use NACK instead) |
| `20004` | Location not found                | Incremental push — location not in cache (use NACK instead) |
| `20005` | Item not found                    | Incremental push — item not in cache (use NACK instead)     |
| `20006` | Invalid BPP descriptor            | BPP-level descriptor missing or invalid                     |
| `20007` | Missing mandatory provider fields | Provider missing required fields (e.g., `descriptor.name`)  |
| `20008` | FSSAI license missing/invalid     | F&B requires 14-digit FSSAI license number                  |
| `20009` | Invalid item schema               | Item-level schema validation failures                       |
| `20010` | Invalid category schema           | Category (custom_group/custom_menu) validation failures     |
| `20011` | Invalid offer schema              | Offer validation failures                                   |

---

## 6. BAP Processing Algorithm

```
1. Receive /on_search callback
2. Verify signature (Ed25519 + BLAKE2b-512 digest)
3. Validate context (action, bpp_id, message_id present)
4. Send ACK immediately (synchronous)
5. Enqueue async processing (enqueueOnSearch)

   Inside async processing:
   a. Validate BPP-level descriptor
   b. For each provider:
      - Validate provider mandatory fields
      - Validate FSSAI license
      - For each item: validate item schema
      - For each category: validate category schema
      - For each offer: validate offer schema
   c. If ANY validation fails:
      - Collect all rejection reasons
      - Call catalogRejection(context, rejectionReasons)
      - Log the rejection
   d. If all valid:
      - Proceed with catalog upsert (existing behavior)
```

---

## 7. Signing Requirements

The `/catalog_rejection` request must be signed with the BAP's Ed25519 private key
using the same algorithm as all other ONDC BAP requests:

1. Serialize the payload (excluding the `Authorization` header) to canonical JSON
2. Compute BLAKE2b-512 digest of the serialized JSON
3. Sign the digest with Ed25519 private key
4. Base64-encode the signature
5. Include in `Authorization` header: `Authorization: <signature>`

**Implementation** (reuse existing `createAuthorizationHeader` utility):

```typescript
import { createAuthorizationHeader } from "../utils/crypto.js";

const authHeader = await createAuthorizationHeader({
  payload: catalogRejectionPayload,
  privateKeyBase64: SIGNING_PRIVATE_KEY,
  subscriberId: SUBSCRIBER_ID,
  uniqueKeyId: UNIQUE_KEY_ID,
});
```

---

## 8. Example Payload

**Full catalog_rejection request**:

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "country": "IND",
    "city": "std:080",
    "action": "catalog_rejection",
    "core_version": "1.2.0",
    "bap_id": "ondc.buyerapp.com",
    "bap_uri": "https://ondc.buyerapp.com/ondc",
    "bpp_id": "ondc.sellerapp.com",
    "bpp_uri": "https://ondc.sellerapp.com/ondc",
    "transaction_id": "9fdb7c2e-1234-4567-89ab-cdef01234567",
    "message_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2023-06-03T08:00:30.000Z"
  },
  "errors": [
    {
      "type": "PROVIDER-ERROR",
      "code": "20007",
      "message": "Provider 'P1': missing mandatory field 'descriptor.name'",
      "path": "bpp/providers/0/descriptor/name"
    },
    {
      "type": "ITEM-ERROR",
      "code": "20009",
      "message": "Item 'I5': price.value is missing",
      "path": "bpp/providers/0/items/4/price/value"
    }
  ]
}
```
