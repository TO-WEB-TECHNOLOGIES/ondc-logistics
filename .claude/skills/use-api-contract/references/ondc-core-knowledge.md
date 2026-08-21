# ONDC Core Knowledge

## 1. What is ONDC?

ONDC (Open Network for Digital Commerce) is an open, interoperable network for digital commerce in India. Unlike platform-based models (Amazon, Zomato), ONDC separates the buyer interface from the seller interface and connects them through a standardized API protocol.

### Key Participants

| Role | Full Name | Responsibility |
|---|---|---|
| **BAP** | Buyer App Platform | Consumer-facing app. Sends search/select/init/confirm requests |
| **BPP** | Seller App Platform | Merchant-facing app. Responds with catalog, quotes, order confirmations |
| **Gateway** | ONDC Gateway | Broadcasts BAP search requests to all relevant BPPs. Multicast router |
| **Registry** | ONDC Registry | Stores network participant info, public keys, and endpoints. Used for lookup and subscription |

### Network Flow
```
BAP → Gateway → BPP(s)  (search broadcast)
BPP → BAP               (on_search, on_select, on_init, on_confirm — async callbacks)
BAP ↔ Registry          (subscribe, lookup)
```

---

## 2. Full Transaction Flow

### Order Lifecycle
```
search       → BAP asks for catalog
on_search    ← BPP responds with catalog (async)
select       → BAP selects items and requests a quote
on_select    ← BPP responds with itemized quote
init         → BAP provides buyer details (billing, delivery address)
on_init      ← BPP responds with payment info and final order draft
confirm      → BAP confirms the order (with payment reference)
on_confirm   ← BPP acknowledges order placement
status       → BAP polls for order status
on_status    ← BPP responds with current fulfillment status
track        → BAP requests tracking info
on_track     ← BPP responds with tracking URL or GPS
cancel       → BAP or BPP initiates cancellation
on_cancel    ← BPP confirms cancellation
update       → BAP updates items or delivery info
on_update    ← BPP confirms update
```

Each request is sent by the BAP; each `on_*` callback is sent by the BPP back to the BAP's webhook.

---

## 3. Context Object

The `context` object is present in every ONDC API call. It identifies the transaction and routing metadata.

```json
{
  "domain": "ONDC:RET11",
  "country": "IND",
  "city": "std:080",
  "action": "search",
  "core_version": "1.2.0",
  "bap_id": "buyer-app.example.com",
  "bap_uri": "https://buyer-app.example.com/api/v1",
  "bpp_id": "seller-app.example.com",
  "bpp_uri": "https://seller-app.example.com/",
  "transaction_id": "txn-uuid-1234",
  "message_id": "msg-uuid-5678",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "ttl": "PT30S"
}
```

| Field | Purpose |
|---|---|
| `domain` | Domain code (e.g. ONDC:RET11 for F&B) |
| `country` | ISO 3166-1 alpha-3 country code |
| `city` | std:<STD_code> or `*` for all cities |
| `action` | API action name (search, on_search, select, etc.) |
| `core_version` | ONDC core spec version (currently 1.2.0) |
| `bap_id` | Subscriber ID of the Buyer App (from registry) |
| `bap_uri` | Base URL of the BAP's callback webhook |
| `bpp_id` | Subscriber ID of the Seller App (filled by BPP on callbacks) |
| `bpp_uri` | Base URL of the BPP's API |
| `transaction_id` | Unique ID for the full order transaction (same across all steps) |
| `message_id` | Unique ID for each individual request/response pair |
| `timestamp` | ISO 8601 timestamp of the request |
| `ttl` | ISO 8601 duration — how long this request is valid (e.g. PT30S = 30 seconds) |

**`transaction_id` vs `message_id`**: `transaction_id` links all actions in one order flow together; `message_id` is per request/response pair.

---

## 4. Signing & Authorization

ONDC uses **Ed25519** asymmetric signing to authenticate API calls.

### Signature Algorithm
1. Hash the request body with **BLAKE2b-512** to get a digest
2. Sign the digest with the sender's **Ed25519 private key**
3. Base64-encode the signature

### Authorization Header Format
```
Authorization: Signature keyId="subscriber_id|unique_key_id|ed25519",
  algorithm="ed25519",
  created="<unix_timestamp>",
  expires="<unix_timestamp>",
  headers="(created) (expires) digest",
  signature="<base64_signature>"
```

### Key Setup
- Generate an Ed25519 key pair
- Register the **public key** with the ONDC Registry under your subscriber ID + unique key ID
- Keep the **private key** secret on your server
- Recipients verify signatures by looking up your public key from the Registry

---

## 5. ONDC Registry

### Subscribe Payload
When onboarding, a network participant subscribes to the registry:
```json
{
  "context": { "action": "subscribe", ... },
  "message": {
    "request_id": "<uuid>",
    "timestamp": "...",
    "entity": {
      "gst": { "legal_entity_name": "...", "business_address": "...", "city_code": ["..."], "gst_no": "..." },
      "pan": { "name_as_per_pan": "...", "pan_no": "...", "date_of_incorporation": "..." },
      "name_of_authorised_signatory": "...",
      "address_of_authorised_signatory": "...",
      "email_id": "...",
      "mobile_no": "...",
      "country": "IND",
      "subscriber_id": "your-app.example.com",
      "unique_key_id": "key-001",
      "callback_url": "https://your-app.example.com/"
    },
    "network_participant": [
      {
        "subscriber_url": "https://your-app.example.com/api/v1",
        "domain": "ONDC:RET11",
        "type": "BAP",
        "msn": false,
        "city_code": ["std:080"]
      }
    ]
  }
}
```

### Registry Lookup
Used to find a participant's public key and callback URL:
```
POST /lookup
{ "subscriber_id": "seller-app.example.com", "unique_key_id": "key-001" }
```
Returns participant details including `signing_public_key`.

---

## 6. Domain Codes

| Domain | Category |
|---|---|
| `ONDC:RET10` | Grocery |
| `ONDC:RET11` | F&B (Food & Beverages) |
| `ONDC:RET12` | Fashion |
| `ONDC:RET13` | Beauty & Personal Care |
| `ONDC:RET14` | Electronics |
| `ONDC:RET15` | Appliances |
| `ONDC:RET16` | Home & Kitchen |
| `ONDC:RET17` | Pharma |
| `ONDC:RET18` | Health & Wellness |
| `ONDC:RET19` | Toys |
| `ONDC:RET20` | Books |

---

## 7. Network Participant Types

| Type | Description |
|---|---|
| `BAP` | Buyer App Platform |
| `BPP` | Seller App Platform |
| `MSN` | Multi Seller Network — a BPP that aggregates multiple sellers |

---

## 8. TTL (Time To Live)

TTL appears in multiple places with different meanings:

| Location | Meaning |
|---|---|
| `context.ttl` | How long the network should wait for a response to this request (e.g. PT30S) |
| `bpp/providers[].ttl` | How long this provider's catalog is valid before re-fetching |
| Quote TTL (in `on_select`) | How long the price quote is valid before the buyer must confirm |

TTL is in **ISO 8601 duration** format: `PT30S` = 30 seconds, `PT15M` = 15 minutes, `P1D` = 1 day.

---

## 9. Fulfillment Types

| Type | Description |
|---|---|
| `Delivery` | BPP/seller delivers to buyer's address |
| `Self-Pickup` | Buyer picks up from the seller's location |
| `Buyer-Delivery` | Buyer arranges their own delivery |

---

## 10. City Code Format

- **Specific city**: `std:<STD_code>` (e.g., `std:080` for Bengaluru, `std:011` for Delhi)
- **All cities**: `*`

City codes correspond to Indian STD (Subscriber Trunk Dialing) codes.

---

## 11. Error Types & Codes

Errors appear in NACK responses and error callbacks.

### Error Types
| Type | Meaning |
|---|---|
| `CONTEXT-ERROR` | Invalid context fields |
| `DOMAIN-ERROR` | Domain-specific validation failure |
| `POLICY-ERROR` | Business rule violation |
| `JSON-SCHEMA-ERROR` | Request doesn't match expected schema |

### Common Error Codes
| Code | Meaning |
|---|---|
| `10000` | Unexpected error |
| `10001` | Invalid request |
| `20000` | Invalid context |
| `20001` | Invalid domain |
| `20002` | Invalid action |
| `20003` | Invalid core version |
| `20004` | Invalid transaction ID |
| `20005` | Invalid message ID |
| `20006` | Invalid timestamp |
| `25001` | Provider not found |
| `30001` | Item not found |
| `30004` | Item quantity unavailable |
| `30009` | No Items Available |
| `40000` | Business error |

### NACK Response Shape
```json
{
  "message": { "ack": { "status": "NACK" } },
  "error": {
    "type": "DOMAIN-ERROR",
    "code": "30001",
    "message": "Item not found"
  }
}
```

---

## 12. Incremental Catalog Updates

BPPs can push incremental updates (deltas) when their catalog changes:
- BAP sends `catalog_inc` tag with `mode: start` to subscribe to incremental updates
- BPP sends `on_search` callbacks with only the changed providers/items
- Upsert logic ensures changed data replaces old data without full catalog duplication

---

## 13. Signing Verification Flow (Incoming Requests)

When the BAP receives a callback from a BPP:
1. Parse the `Authorization` header to extract `keyId`, `signature`, `created`, `expires`
2. `keyId` = `subscriber_id|unique_key_id|algorithm`
3. Look up the BPP's public key from ONDC Registry using `subscriber_id` + `unique_key_id`
4. Reconstruct the signing string: `(created): <value>\n(expires): <value>\ndigest: <BLAKE2b-512 hash of body>`
5. Verify the signature using the public key
6. Check `created` and `expires` timestamps to prevent replay attacks
