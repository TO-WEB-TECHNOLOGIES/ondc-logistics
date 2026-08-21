# Network Observability (NO) API — Transaction Log Push

**Version**: Pre-Prod Schema  
**Endpoint**: `https://analytics-api-pre-prod.aws.ondc.org/v1/api/push-txn-logs`  
**Auth**: Bearer token (from NP portal — valid 10 days, pre-prod only)

The NO API lets Network Participants (NPs) push transaction logs to ONDC's analytics platform for network monitoring. All NPs must push logs **automatically** (not manually via Postman) after every ONDC API call.

---

## When to Push

Push logs for **every** ONDC API request and response, including:
- Core retail/logistics APIs: `/search`, `/on_search`, `/select`, `/on_select`, `/init`, `/on_init`, `/confirm`, `/on_confirm`, `/status`, `/on_status`, `/cancel`, `/on_cancel`, `/update`, `/on_update`, `/track`, `/on_track`, `/info`, `/on_info`
- IGM APIs: `/issue`, `/on_issue`, `/issue_status`, `/on_issue_status`
- RSF APIs: `/recon`, `/on_recon`, `/settle`, `/on_settle`, `/report`, `/on_report`

Push both requests AND responses (including ACKs and NACKs).

---

## Payload Structure

```json
{
  "type": "<action_type>",
  "data": {
    "context": {
      "domain": "ONDC:NTS10",
      "country": "IND",
      "city": "std:080",
      "action": "recon",
      "core_version": "2.0.0",
      "bap_id": "collector-app.com",
      "bap_uri": "https://collector-app.com/ondc/1.0/",
      "bpp_id": "receiver-app.com",
      "bpp_uri": "https://receiver-app.com/ondc/",
      "transaction_id": "<unique UUID>",
      "message_id": "<unique UUID>",
      "timestamp": "2024-05-07T06:36:50.897Z",
      "ttl": "P1D"
    },
    "message": {
      // Full message payload from the API call
      // For ACK/NACK responses, this is: { "ack": { "status": "ACK" } }
    }
  }
}
```

---

## type Values

The `type` field indicates the action and whether it's an ACK/NACK response.

### RSF APIs

| API Call | type value | Is ACK/NACK? |
|----------|-------------|--------------|
| `/recon` (request) | `recon` | No |
| `/recon` (sync response) | `recon_response` | Yes (ACK/NACK) |
| `/on_recon` (request) | `on_recon` | No |
| `/on_recon` (sync response) | `on_recon_response` | Yes (ACK/NACK) |
| `/settle` (request) | `settle` | No |
| `/settle` (sync response) | `settle_response` | Yes (ACK/NACK) |
| `/on_settle` (request) | `on_settle` | No |
| `/on_settle` (sync response) | `on_settle_response` | Yes (ACK/NACK) |
| `/report` (request) | `report` | No |
| `/report` (sync response) | `report_response` | Yes (ACK/NACK) |
| `/on_report` (request) | `on_report` | No |
| `/on_report` (sync response) | `on_report_response` | Yes (ACK/NACK) |

### Core Retail/Logistics APIs

| API Call | type value | Is ACK/NACK? |
|----------|-------------|--------------|
| `/init` (request) | `init` | No |
| `/init` (sync response) | `init_response` | Yes (ACK/NACK) |
| `/on_init` (request) | `on_init` | No |
| `/on_init` (sync response) | `on_init_response` | Yes (ACK/NACK) |
| `/confirm` (request) | `confirm` | No |
| `/confirm` (sync response) | `confirm_response` | Yes (ACK/NACK) |
| `/on_confirm` (request) | `on_confirm` | No |
| `/on_confirm` (sync response) | `on_confirm_response` | Yes (ACK/NACK) |
| `/select` (request) | `select` | No |
| `/select` (sync response) | `select_response` | Yes (ACK/NACK) |
| `/on_select` (request) | `on_select` | No |
| `/on_select` (sync response) | `on_select_response` | Yes (ACK/NACK) |
| `/search` (request) | `search` | No |
| `/search` (sync response) | `search_response` | Yes (ACK/NACK) |
| `/on_search` (request) | `on_search` | No |
| `/on_search` (sync response) | `on_search_response` | Yes (ACK/NACK) |
| `/status` (request) | `status` | No |
| `/status` (sync response) | `status_response` | Yes (ACK/NACK) |
| `/on_status` (request) | `on_status` | No |
| `/on_status` (sync response) | `on_status_response` | Yes (ACK/NACK) |
| `/cancel` (request) | `cancel` | No |
| `/cancel` (sync response) | `cancel_response` | Yes (ACK/NACK) |
| `/on_cancel` (request) | `on_cancel` | No |
| `/on_cancel` (sync response) | `on_cancel_response` | Yes (ACK/NACK) |
| `/update` (request) | `update` | No |
| `/update` (sync response) | `update_response` | Yes (ACK/NACK) |
| `/on_update` (request) | `on_update` | No |
| `/on_update` (sync response) | `on_update_response` | Yes (ACK/NACK) |
| `/track` (request) | `track` | No |
| `/track` (sync response) | `track_response` | Yes (ACK/NACK) |
| `/on_track` (request) | `on_track` | No |
| `/on_track` (sync response) | `on_track_response` | Yes (ACK/NACK) |
| `/issue` (request) | `issue` | No |
| `/issue` (sync response) | `issue_response` | Yes (ACK/NACK) |
| `/on_issue` (request) | `on_issue` | No |
| `/on_issue` (sync response) | `on_issue_response` | Yes (ACK/NACK) |
| `/issue_status` (request) | `issue_status` | No |
| `/issue_status` (sync response) | `issue_status_response` | Yes (ACK/NACK) |
| `/on_issue_status` (request) | `on_issue_status` | No |
| `/on_issue_status` (sync response) | `on_issue_status_response` | Yes (ACK/NACK) |

### Pattern for type naming

- Request (inbound or outbound): `<action>` (e.g., `recon`, `on_recon`, `settle`)
- Synchronous ACK/NACK response: `<action>_response` (e.g., `recon_response`, `on_recon_response`)

---

## Example Payloads

### /recon (Request)

```json
{
  "type": "recon",
  "data": {
    "context": {
      "domain": "ONDC:NTS10",
      "location": {
        "country": { "code": "IND" },
        "city": { "code": "*" }
      },
      "version": "2.0.0",
      "action": "recon",
      "bap_id": "collector-app.com",
      "bap_uri": "https://collector-app.com/ondc/1.0/",
      "bpp_id": "receiver-app.com",
      "bpp_uri": "https://receiver-app.com/ondc/",
      "transaction_id": "bd73a366-aebb-4144-9314-808dda82c7e6",
      "message_id": "941ef6d7-d74d-4411-ac06-a05469c0f9ac",
      "timestamp": "2024-05-07T06:36:50.897Z",
      "ttl": "P1D"
    },
    "message": {
      "orders": [
        {
          "id": "order-1234",
          "amount": {
            "currency": "INR",
            "value": "300.00"
          },
          "settlements": [
            {
              "id": "settlement-id-456",
              "payment_id": "pymnt-1",
              "status": "PENDING",
              "amount": {
                "currency": "INR",
                "value": "100.00"
              },
              "commission": {
                "currency": "INR",
                "value": "10.00"
              },
              "withholding_amount": {
                "currency": "INR",
                "value": "10.00"
              },
              "tcs": {
                "currency": "INR",
                "value": "10.00"
              },
              "tds": {
                "currency": "INR",
                "value": "10.00"
              },
              "updated_at": "2024-05-07T07:36:50.897Z"
            }
          ]
        }
      ]
    }
  }
}
```

### /recon (Synchronous Response — ACK)

```json
{
  "type": "recon_response",
  "data": {
    "context": {
      "domain": "ONDC:NTS10",
      "location": {
        "country": { "code": "IND" },
        "city": { "code": "*" }
      },
      "version": "2.0.0",
      "action": "recon",
      "bap_id": "collector-app.com",
      "bap_uri": "https://collector-app.com/ondc/1.0/",
      "bpp_id": "receiver-app.com",
      "bpp_uri": "https://receiver-app.com/ondc/",
      "transaction_id": "bd73a366-aebb-4144-9314-808dda82c7e6",
      "message_id": "941ef6d7-d74d-4411-ac06-a05469c0f9ac",
      "timestamp": "2024-05-07T06:36:50.897Z",
      "ttl": "P1D"
    },
    "message": {
      "ack": {
        "status": "ACK"
      }
    }
  }
}
```

### /on_recon (Request — with recon_accord)

```json
{
  "type": "on_recon",
  "data": {
    "context": {
      "domain": "ONDC:NTS10",
      "location": { "country": { "code": "IND" }, "city": { "code": "*" } },
      "version": "2.0.0",
      "action": "on_recon",
      "bap_id": "collector-app.com",
      "bap_uri": "https://collector-app.com/ondc/1.0/",
      "bpp_id": "receiver-app.com",
      "bpp_uri": "https://receiver-app.com/ondc/",
      "transaction_id": "bd73a366-aebb-4144-9314-808dda82c7e6",
      "message_id": "941ef6d7-d74d-4411-ac06-a05469c0f9ac",
      "timestamp": "2024-05-07T06:36:51.897Z",
      "ttl": "P1D"
    },
    "message": {
      "orders": [
        {
          "id": "order-1234",
          "amount": { "currency": "INR", "value": "310.00" },
          "recon_accord": false,
          "settlements": [
            {
              "id": "settlement-id-456",
              "payment_id": "pymnt-1",
              "status": "PENDING",
              "amount": { "currency": "INR", "value": "120.00", "diff_value": "20.00" },
              "commission": { "currency": "INR", "value": "10.00", "diff_value": "0.00" },
              "withholding_amount": { "currency": "INR", "value": "10.00", "diff_value": "0.00" },
              "tcs": { "currency": "INR", "value": "10.00", "diff_value": "0.00" },
              "tds": { "currency": "INR", "value": "10.00", "diff_value": "0.00" },
              "updated_at": "2024-05-07T07:36:51.897Z"
            }
          ]
        }
      ]
    }
  }
}
```

### NACK Response Example

```json
{
  "type": "init_response",
  "data": {
    "context": {
      "ttl": "PT5S",
      "city": "std:080",
      "action": "init",
      "bap_id": "buyerapp.com",
      "bpp_id": "sellerapp.com",
      "domain": "nic2004:52110",
      "bap_uri": "https://buyerapp.com/ondc",
      "bpp_uri": "https://sellerapp.com/ondc",
      "country": "IND",
      "timestamp": "2023-07-13T13:38:11.687Z",
      "message_id": "1689255491687805",
      "core_version": "1.1.0",
      "transaction_id": "59079540_txn"
    },
    "message": {
      "ack": { "status": "NACK" }
    }
  },
  "error": {
    "type": "DOMAIN-ERROR",
    "code": "20000",
    "message": "appropriate error message"
  }
}
```

---

## Response Codes

### Success (HTTP 200)

```json
{ "message": "Successful" }
```

**Non-standard success bodies**: The NO API may occasionally return a bare primitive with HTTP 200 (e.g., `1` instead of a JSON object). HTTP 200 indicates success regardless of body shape — treat any 200 response as a success.

### Success with Warning (HTTP 200)

When extra fields are present in the payload:

```json
{
  "message": "Successful",
  "warnings": [
    {
      "code": 2001,
      "type": "EXTRA_FIELD",
      "message": "Payload contains an extra field: <field_name>",
      "path": "<field_path>"
    }
  ]
}
```

### Error Responses (HTTP 4xx)

```json
{
  "errors": [
    {
      "error_code": 4001,
      "message": "Invalid value: missing required key",
      "path": "data",
      "error_description": "REQUIRED_FIELD"
    }
  ]
}
```

---

## Error Codes

| Code | Type | Message | Description |
|------|------|---------|-------------|
| 4001 | `REQUIRED_FIELD` | Invalid value: missing required key | A mandatory field is not present |
| 4002 | `INVALID_DATA_TYPE` | Invalid value: invalid type | Field value doesn't match expected type |
| 4003 | `INVALID_ENUM_VALUE` | Invalid value: \<value\>, Allowed values are: \<valid_enums\> | Field value not in allowed enumeration |
| 2001 | `EXTRA_FIELD` | Payload contains an extra field: \<field_name\> | Warning only (request still succeeds) |

---

## Anonymization Requirements

- **Anonymize PII**: Remove or hash personally identifiable information before pushing
- **Do NOT anonymize**: `city` and `pincode` / `area_code` — these must remain in the payload
- Push **both** request and response for every API call
- Push **ACKs and NACKs** for synchronous responses

---

## Dashboard

 NPs can verify pushed transaction IDs at:  
**https://analytics-dashboard.ondc.org/public/dashboard/83a560f2-cc19-4b9c-a2a3-95047b775ea8**

Data appears on the dashboard approximately **20 minutes** after push.

---

## Implementation Notes

- The NO API performs **schema-level validation only** — not business logic validation
- The `type` field must match the `data.context.action` according to the naming rules above
- For RSF APIs: use `version: "2.0.0"` in context (not `core_version`)
- The `ttl` for RSF APIs is `P1D` (1 day); for core/IGM APIs it varies (e.g., `PT30S`)