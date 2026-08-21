# /track + /on_track Deep Reference

**Scope**: BAP-collected prepaid (ON-ORDER) only. Delivery fulfillment only.

Read this when implementing or debugging anything related to:
- Requesting live GPS tracking coordinates for a delivery rider (`/track`)
- Processing tracking response payloads from BPP (`/on_track`)
- Understanding when `/track` should vs should not be called
- Hyperlocal (`gps_enabled`) vs non-hyperlocal (`url_enabled`) tracking modes
- Tracking state machine: `active` → `inactive` after delivery
- `/track` + `/on_track` relationship to `/status` polling (independent, can run concurrently)
- NACK 40005 and 31003 error handling

---

## When to Call `/track`

`/track` is a **solicited** (BAP-initiated) request — the BPP only responds when the BAP calls `/track`. This is different from `/on_status` which can be sent unsolicited by the BPP at any time.

### Prerequisites

| Condition | How to check | Result if not met |
|-----------|--------------|-------------------|
| Rider assigned | `fulfillment.agent` object in `/on_status` | NACK 40005 |
| `gps_enabled:"yes"` OR `url_enabled:"yes"` | `fulfillment.tags[code="tracking"]` in `/on_status` | NACK 40005 |
| Order not yet delivered | `tracking.status` = `"inactive"` post-delivery | NACK 40005 |

### Calling Decision Tree

```
Has BPP sent /on_status with gps_enabled="yes" for the delivery fulfillment?
  YES → Call /track to poll live GPS coordinates (hyperlocal)
  NO  → Has BPP sent /on_status with url_enabled="yes" AND tracking_url?
    YES → Open tracking_url in webview (non-hyperlocal, no polling needed)
    NO  → Do NOT call /track → you will receive NACK 40005
```

### Contract Rules (exact wording)

> "Buyer NP will need to call /track to poll near real-time gps coordinates for the rider"

> "/track should be called only after the rider is assigned for the order and preferably after 'gps_enabled' is set to 'yes', for the corresponding fulfillment, in /on_status."

> "For non-hyperlocal tracking, SNP should set 'url_enabled' to 'yes' and 'tracking_url', for the corresponding fulfillment, in /on_status"

> "If /track is called for an order for which the rider is not yet assigned or rider is assigned but fulfillment tracking is not yet enabled (i.e. 'gps_enabled' and / or 'url_enabled' is 'no') or disabled, the seller NP must return NACK with error code 40005"

---

## /track Request Schema

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "track",
    "country": "IND",
    "city": "std:080",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T2",
    "message_id": "M11",
    "timestamp": "2023-06-04T06:00:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "order_id": "O1"
  }
}
```

**Field breakdown:**

| Field | Value | Notes |
|-------|-------|-------|
| `context.action` | `"track"` | NOT `"on_track"` — BAP sends `"track"` |
| `context.ttl` | `"PT30S"` | Tracking is near-real-time; short TTL (30 seconds) |
| `message.order_id` | `"O1"` | BAP-generated order UUID from `/confirm` — NOT `transaction_id` |

**Optional fields in `/track`:** None — `/track` has no optional fields.

---

## /on_track Response Schema

```json
{
  "context": {
    "domain": "ONDC:RET11",
    "action": "on_track",
    "country": "IND",
    "city": "std:080",
    "core_version": "1.2.0",
    "bap_id": "buyerNP.com",
    "bap_uri": "https://buyerNP.com/ondc",
    "bpp_id": "sellerNP.com",
    "bpp_uri": "https://sellerNP.com/ondc",
    "transaction_id": "T2",
    "message_id": "M11",
    "timestamp": "2023-06-04T06:00:00.000Z",
    "ttl": "PT30S"
  },
  "message": {
    "tracking": {
      "id": "F1",
      "location": {
        "gps": "12.974002,77.613458",
        "time": {
          "timestamp": "2023-06-02T06:20:00.000Z"
        },
        "updated_at": "2023-06-02T06:30:00.000Z"
      },
      "url": "https://sellerNP.com/ondc/tracking/F1",
      "status": "active",
      "tags": [
        {
          "code": "order",
          "list": [
            { "code": "id", "value": "O1" }
          ]
        },
        {
          "code": "config",
          "list": [
            { "code": "attr", "value": "tracking.location.gps" },
            { "code": "type", "value": "live_poll" }
          ]
        },
        {
          "code": "path",
          "list": [
            { "code": "lat_lng", "value": "12.974002,77.613458" },
            { "code": "sequence", "value": "1" }
          ]
        },
        {
          "code": "path",
          "list": [
            { "code": "lat_lng", "value": "12.974077,77.613600" },
            { "code": "sequence", "value": "2" }
          ]
        }
      ]
    }
  }
}
```

**Field breakdown:**

| Field | Type | Mandatory | Description |
|-------|------|-----------|-------------|
| `tracking.id` | string | **Yes** | `fulfillment_id` from the delivery fulfillment (e.g. `"F1"`) |
| `tracking.location` | object | **Yes** | Live location of the rider |
| `tracking.location.gps` | string | **Yes** | `"lat,lng"` format — e.g. `"12.974002,77.613458"` |
| `tracking.location.time.timestamp` | ISO 8601 | No | When the GPS reading was taken |
| `tracking.location.updated_at` | ISO 8601 | No | Last location data update timestamp |
| `tracking.url` | string | No | External tracking URL (non-hyperlocal only) |
| `tracking.status` | enum | **Yes** | `"active"` during fulfillment; `"inactive"` after delivery |
| `tracking.tags` | array | No | Additional tracking metadata |

**Tracking tags:**

| Tag code | List codes | Description |
|----------|------------|-------------|
| `order` | `id` | Associates tracking response with order ID |
| `config` | `attr`, `type` | `attr`: what field has GPS (`"tracking.location.gps"`); `type`: `"live_poll"` = polling mode |
| `path` | `lat_lng`, `sequence` | Historical waypoints — sequence orders the path, `lat_lng` is `"lat,lng"` |

---

## Fulfillment Tracking Flags (set in `/on_status`)

The BPP communicates tracking capabilities via `fulfillment.tags[code="tracking"]` in `/on_status`:

```json
{
  "code": "tracking",
  "list": [
    { "code": "gps_enabled", "value": "yes" },
    { "code": "url_enabled", "value": "no" },
    { "code": "url", "value": "https://sellerNP.com/ondc/tracking_url" }
  ]
}
```

| Tag code | Values | Meaning |
|----------|--------|---------|
| `gps_enabled` | `"yes"` / `"no"` | Whether live GPS polling via `/track` is available (hyperlocal) |
| `url_enabled` | `"yes"` / `"no"` | Whether an external tracking URL is available (non-hyperlocal) |
| `url` | URL string | The external tracking URL — present only when `url_enabled:"yes"` |

**When these flags appear in `/on_status`:**
- `gps_enabled`/`url_enabled` first appear in the fulfillment's `tags` array in `/on_status` (not in `/on_confirm`)
- `gps_enabled` may become `"yes"` when the rider is assigned and GPS is active
- `url` is only present when `url_enabled` is `"yes"` — it is the external tracking URL

---

## Tracking Lifecycle

```
/on_confirm         → fulfillment created, no agent, no tracking flags
/on_status (Accepted) → agent object appears (rider assigned)
on_status (Packed)   → tracking flags may appear (gps_enabled/url_enabled)
/on_status (Order-picked-up) → tracking fully enabled
  → if gps_enabled="yes"  → BAP polls /track for live GPS
  → if url_enabled="yes"  → BAP opens tracking_url in webview
/on_track responses   → GPS waypoints + status
/on_status (Delivered) → tracking.status = "inactive", tracking ends
```

**Key rules:**
- Tracking is **active only during fulfillment** — from rider-assigned to delivered
- Tracking becomes **inactive after delivery** — `/track` will NACK 40005 post-delivery
- `/track`/`/on_track` is **cascaded** from retail BPP → logistics LSP → back
- Both `/track` and `/status` can be called concurrently

**BAP polling strategy:**
```
on_confirm received
  → start /status polling
  → when /on_status shows agent assigned:
       if gps_enabled="yes"  → also start /track polling (hyperlocal)
       if url_enabled="yes"  → show tracking_url in webview (non-hyperlocal)
  → when /on_status shows Delivered → stop both polls
```

---

## Tracking vs Delivery Authentication

`fulfillment_auth_pin` (from `/on_status` tags) is **separate from tracking**:

| Field | Purpose | When available |
|-------|---------|-----------------|
| `fulfillment_auth_pin` | PIN for delivery verification at door | In `/on_status` tags |
| `/track` GPS coordinates | Live rider location on map | Via `/on_track` when `gps_enabled="yes"` |
| `tracking_url` | External tracking web page | Via `/on_status` when `url_enabled="yes"` |

---

## Error Codes

| Code | Scenario | BAP Action |
|------|----------|------------|
| `40005` | Rider not assigned, or tracking not yet enabled (both `gps_enabled` and `url_enabled` are `"no"`), or order already delivered | Do NOT poll; wait for next `/on_status` with tracking enabled flags |
| `31003` | Order processing in progress at SNP (retry window) | Retry `/track` after short delay; same transaction_id |

**NACK 40005 is NOT returned for:**
- Network timeout (different error)
- Invalid order_id (different error)
- Post-delivery tracking attempt → returns 40005

**`31003` on `/track`:**
> "If order is passed in subsequent API calls within the retry window (/status, /track, /cancel, /update), SNP responds with current order state along with error code 31003 to indicate order processing in progress"

---

## Edge Cases

### 1. `/track` called before any `/on_status` received
- BAP has no way to know if `gps_enabled` or `url_enabled` — call at your own risk
- Most likely outcome: NACK 40005 (rider not assigned yet)
- **Best practice**: Wait for at least one `/on_status` showing agent assigned

### 2. `gps_enabled` = `"yes"` but no GPS in `/on_track` response
- BPP may return `tracking.location.gps` as `null` or absent
- Handle gracefully — show last known location

### 3. Both `gps_enabled` and `url_enabled` are `"yes"`
- Prefer GPS polling (`/track`) for hyperlocal experience
- Fall back to `tracking_url` webview if GPS data is stale/absent

### 4. Rider changes mid-delivery
- New agent assigned → new `fulfillment.agent` in `/on_status`
- `gps_enabled` may go back to `"no"` briefly, then `"yes"` again
- Tracking session resets — restart `/track` polling if previously stopped

### 5. Multiple fulfillments (split order)
- Each fulfillment has its own `id` (e.g. `"F1"`, `"F2"`)
- `/track` uses `order_id` — BPP responds with tracking for the delivery fulfillment
- Handle multiple `tracking` responses if order splits across LSPs

### 6. `tracking.status` = `"inactive"` but still receiving `/on_track`
- This is an edge case — BPP should stop sending `/on_track` after delivery
- If received, treat as stale data; do not update UI

### 7. `url` vs `tracking_url` field names
- In `/on_status` fulfillment.tags: `code:"url"` with `value:"https://..."`
- In `/on_track` tracking object: `url:"https://..."`
- Same URL, different field names in different API shapes

---

## Quick Lookup

**`/track` call condition**: rider assigned AND (`gps_enabled="yes"` OR `url_enabled="yes"`)

**`/track` NACK 40005 when**: rider not assigned, tracking flags both `"no"`, or order delivered

**`/track` ttl**: `"PT30S"` — short because tracking is near-real-time

**Tracking status**: `"active"` during fulfillment, `"inactive"` after delivery

**Tracking flags in `/on_status` fulfillment.tags**: `gps_enabled`, `url_enabled`, `url`

**31003 on `/track`**: Retry after short delay — SNP processing in progress

**`tracking.url` in on_track**: External tracking URL (non-hyperlocal), NOT GPS coordinates

**GPS format**: `"lat,lng"` string — e.g. `"12.974002,77.613458"`

**Path waypoints**: `tracking.tags[code="path"].list[code="lat_lng"]` + `sequence`

**Relationship to `/status`**: Independent — can poll both concurrently

**Cascaded**: `/track`/`/on_track` is cascaded from retail BPP → logistics LSP → back
