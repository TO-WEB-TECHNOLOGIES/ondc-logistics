# RSF 2.0 — Reconciliation and Settlement Framework

**Version**: 2.0.0 (RSF 1.0.0 is deprecated)

RSF 2.0 handles **funds settlement** and **orderbook reconciliation** among ONDC Network Participants (NPs).
The **Settlement Agency** (NBBL) acts as the central counterparty for all settlement calls.

---

## RSF API Summary

| Action       | Direction | Purpose                                                    |
| ------------ | --------- | ---------------------------------------------------------- |
| `/settle`    | NP → SA   | Submit settlement instruction (collector or receiver side) |
| `/on_settle` | SA → NP   | Settlement result (success with ref number OR error code)  |
| `/report`    | NP → SA   | Query status of a prior `/settle` call                     |
| `/on_report` | SA → NP   | Status response for a settlement                           |
| `/recon`     | NP ↔ NP   | Bi-directional orderbook reconciliation                    |
| `/on_recon`  | NP ↔ NP   | Reconciliation response (accord or dispute)                |

**6 APIs total** for RSF 2.0 compliance. Recon/On_Recon tested with ONDC mock server or another NP.

---

## Core Concepts

### Settlement Types

| Type    | Description                               | Use                                                 |
| ------- | ----------------------------------------- | --------------------------------------------------- |
| `NP-NP` | Inter-NP order settlement                 | Normal buyer↔seller settlement                      |
| `MISC`  | Move funds from NOCA to operative account | Pre-funded money extraction, seller self-settlement |
| `NIL`   | No settlement required for the cycle      | Notify SA of zero activity                          |

### Amount Fields (per order in `/settle`)

| Field                      | Who sets it               | Meaning                                                |
| -------------------------- | ------------------------- | ------------------------------------------------------ |
| `inter_participant_amount` | Both collector & receiver | Amount to move from collector to receiver              |
| `collector_amount`         | Collector side only       | Amount collector keeps for themselves (finder fee)     |
| `self.amount`              | Both                      | Amount moved to the API caller's own operative account |
| `provider.amount`          | Receiver side (optional)  | Amount transferred to the provider's account           |

**Self amount depends on caller:**

- Buyer app calling `/settle` → `self` = buyer app's finder fee portion
- Seller app calling `/settle` → `self` = seller app's margin or inter-NP amount

**Provider amount is optional.** Only provided when seller app opts in for direct provider settlement.

### Settlement Cycle

- Runs **every day** in the initial phase
- Buyer app (collector) should send daily `/settle` even for null settlements
- If only seller sends `/settle` without buyer counterpart, money is **debited from collector**
- Settlement window and basis defined in `on_confirm` via:
  - `@ondc/org/settlement_basis` — event that triggers settlement (e.g., "delivery")
  - `@ondc/org/settlement_window` — duration (e.g., "P1D" = 1 day after event)
- Settlement occurs only after terminal state (e.g., return window + 7 days in retail)

### Settlement Basis and Window (from `on_confirm`)

- `@ondc/org/settlement_basis` — event that triggers settlement (e.g., "delivery")
- `@ondc/org/settlement_window` — duration (e.g., "P1D", "P3D")

Example: `settlement_basis: "delivery"` + `settlement_window: "P3D"` = settle on 3rd day after delivery.

---

## `/settle` + `/on_settle` — Submit and Receive Settlement Result

**Sent by**: NP (as BAP) to Settlement Agency (as BPP)
**Domain**: `ONDC:NTS10`
**TTL**: `P1D` (1 day — longer than core ONDC TTLs)

### `/settle` Context

```json
{
  "domain": "ONDC:NTS10",
  "action": "settle",
  "country": "IND",
  "city": "std:*",
  "core_version": "2.0.0",
  "bap_id": "collectorapp.com",
  "bap_uri": "https://collectorapp.com/ondc/1.0/",
  "bpp_id": "sa_nocs.nbbl.com",
  "bpp_uri": "https://sa_nocs.nbbl.com/nocs_test",
  "transaction_id": "<unique UUID>",
  "message_id": "<unique UUID>",
  "timestamp": "2024-05-09T11:36:51.897Z",
  "ttl": "P1D"
}
```

### `/settle` `message.settlement` Schema

```json
{
  "collector_app_id": "collectorapp.com",
  "receiver_app_id": "receiverapp.com",
  "settlement_type": "NP-NP",
  "id": "settlement-id-abc",
  "orders": [
    {
      "id": "order-123",
      "inter_participant_amount": {
        "currency": "INR",
        "value": "1000.00"
      },
      "collector_amount": {
        "currency": "INR",
        "value": "50.00"
      },
      "self": {
        "amount": {
          "currency": "INR",
          "value": "50.00"
        }
      },
      "provider": {
        "id": "provider-789",
        "name": "Kirana Pvt Ltd",
        "bank_details": {
          "account_no": "1234567890",
          "ifsc_code": "IFSC0001"
        },
        "amount": {
          "currency": "INR",
          "value": "800.00"
        }
      }
    }
  ]
}
```

**`collector_app_id` and `receiver_app_id`**: These are the ONDC subscriber IDs of the collector and receiver for the order. The BAP ID in context must match one of these.

### Settlement Amount Rules (Retail Prepaid: ₹1050 order, buyer commission ₹50, seller commission ₹200)

| Field             | Collector (/settle) | Receiver (/settle) |
| ----------------- | ------------------- | ------------------ |
| inter_participant | 1000                | 1000               |
| collector         | 50                  | 50                 |
| self              | 50                  | 200                |
| provider          | —                   | 800                |

- `inter_participant` and `collector` amounts must **match exactly** (₹ to ₹) between collector and receiver sides
- Collector amount = buyer app's finder fee commission
- Receiver echoes the same collector amount (buyer's commission acknowledged by seller)
- `self` for buyer app = finder fee portion; for seller app = margin or inter-NP amount
- `provider` only on receiver side, optional — only when seller app opts in for direct provider settlement

### `/on_settle` Success

```json
{
  "context": {
    "transaction_id": "...",
    "message_id": "...",
    "action": "on_settle",
    "timestamp": "2024-05-09T13:36:51.000Z"
  },
  "message": {
    "settlement": {
      "id": "settlement-id-abc",
      "state": "COMPLETED",
      "settlement_ref_no": "REF123456",
      "orders": [
        {
          "id": "order-123",
          "state": "SETTLED",
          "settlement_ref_no": "REF123456",
          "amount": {
            "currency": "INR",
            "value": "1050.00"
          }
        }
      ]
    }
  }
}
```

### `/on_settle` Error

```json
{
  "context": { ... },
  "message": {
    "settlement": {
      "id": "settlement-id-abc",
      "state": "FAILED",
      "orders": [
        {
          "id": "order-123",
          "state": "NOT_SETTLED",
          "error": {
            "code": "70024",
            "message": "Interparticipant value mismatch"
          }
        }
      ]
    }
  }
}
```

### Order-Level Settlement States

| State             | Meaning                                                        |
| ----------------- | -------------------------------------------------------------- |
| `SETTLED`         | Order settled successfully, `settlement_ref_no` provided       |
| `NOT_SETTLED`     | Settlement not executed, check `error.code`                    |
| `TO_BE_INITIATED` | Recon called before settlement was initiated — not yet settled |

### ACK/NACK Rule on `/on_settle`

- **ACK**: settlement instruction was received and processed. May contain `SETTLED` or `NOT_SETTLED` per order.
- **NACK**: schema validation failure, signature failure, or other fatal error.
- **No partial ACK**: either ACK all orders or NACK all.

---

## `/report` + `/on_report` — Query Settlement Status

Used when NP doesn't receive `/on_settle` and wants to check settlement status.
`transaction_id` in `/report` context is the **same** as the original `/settle` transaction_id (for mock server testing).

### `/report` Payload

```json
{
  "context": {
    "action": "report",
    "transaction_id": "<original transaction_id from /settle>",
    "message_id": "<new message_id>"
  },
  "message": {
    "ref_transaction_id": "<original /settle transaction_id>",
    "ref_message_id": "<original /settle message_id>",
    "settlement_id": "settlement-id-abc"
  }
}
```

### `/on_report` Response

```json
{
  "context": { "action": "on_report", ... },
  "message": {
    "settlement": {
      "id": "settlement-id-abc",
      "state": "COMPLETED",
      "settlement_ref_no": "REF123456",
      ...
    }
  }
}
```

---

## `/recon` + `/on_recon` — Bi-directional Orderbook Reconciliation

**Bi-directional**: Either collector OR receiver can initiate `/recon`.
**Context bap/bpp**: Always as per the original order transaction — same `bap_id`/`bpp_id` regardless of who initiates. FAQ Q36: "the bap_id (buyer app id) and bpp_id (seller app id) should be the same for the /recon as per the core transaction itself, irrespective of which NP calls the recon API."

**Suggestion**: receiver initiates the flow.

### When to use `/recon`

1. **Pre-settlement reconciliation**: Before creating settlement instructions, to agree on amounts
2. **Post-settlement dispute**: After failed settlement to resolve discrepancy
3. **Settlement cycle agreement**: Agree on `settlement_date` before both NPs send `/settle`

### `/recon` Schema

```json
{
  "context": {
    "action": "recon",
    "bap_id": "buyerapp.com",
    "bpp_id": "sellerapp.com",
    "transaction_id": "<unique UUID>",
    "message_id": "<unique UUID>",
    "timestamp": "2024-05-09T11:36:51.897Z",
    "ttl": "P1D"
  },
  "message": {
    "order": {
      "id": "order-123",
      "amount": {
        "currency": "INR",
        "value": "1050.00"
      }
    },
    "settlements": [
      {
        "id": "settlement-id-abc",
        "type": "NP-NP",
        "amount": {
          "currency": "INR",
          "value": "1000.00"
        },
        "commission": {
          "currency": "INR",
          "value": "50.00"
        },
        "withholding_amount": {
          "currency": "INR",
          "value": "0.00"
        },
        "tds": {
          "currency": "INR",
          "value": "0.00"
        },
        "tcs": {
          "currency": "INR",
          "value": "0.00"
        }
      }
    ]
  }
}
```

### Field Meanings in `/recon`

| Field                              | Meaning                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `order.amount`                     | Total order value                                                                  |
| `settlements[].amount`             | Amount to be settled from collector to receiver                                    |
| `settlements[].commission`         | Buyer app's commission on the transaction                                          |
| `settlements[].withholding_amount` | Not applicable currently                                                           |
| `settlements[].tds`                | TDS deduction (calculate on order.amount or settlements.amount per legal guidance) |
| `settlements[].tcs`                | TCS deduction (calculate on order.amount or settlements.amount per legal guidance) |

**`settlement_id` in recon**: Independent identifier for the NP's own settlement instruction tracking — not the same as payment/fund settlement ID.

**Why settlements is an array**: An order may have multiple payments (multiple settlement records, each linked to a corresponding `payment_id`).

---

### `/on_recon` Schema

**Case 1: Collector agrees (`recon_accord: true`) — settlement date provided**

```json
{
  "context": {
    "action": "on_recon",
    "transaction_id": "<matching transaction_id>",
    "message_id": "<unique UUID>",
    "timestamp": "2024-05-10T11:36:51.897Z"
  },
  "message": {
    "recon_accord": true,
    "settlement_date": "2024-05-15",
    "order": {
      "id": "order-123",
      "amount": {
        "currency": "INR",
        "value": "1050.00"
      }
    },
    "settlements": [
      {
        "id": "settlement-id-abc",
        "type": "NP-NP",
        "amount": {
          "currency": "INR",
          "value": "1000.00"
        },
        "commission": {
          "currency": "INR",
          "value": "50.00"
        }
      }
    ]
  }
}
```

**Case 2: Collector disagrees (`recon_accord: false`) — diff_value provided**

```json
{
  "context": {
    "action": "on_recon",
    "transaction_id": "<matching transaction_id>",
    "message_id": "<unique UUID>",
    "timestamp": "2024-05-10T11:36:51.897Z"
  },
  "message": {
    "recon_accord": false,
    "order": {
      "id": "order-123",
      "amount": {
        "currency": "INR",
        "value": "1050.00"
      }
    },
    "settlements": [
      {
        "id": "settlement-id-abc",
        "type": "NP-NP",
        "amount": {
          "currency": "INR",
          "value": "90.00"
        },
        "commission": {
          "currency": "INR",
          "value": "50.00"
        },
        "diff_value": "10.00",
        "withholding_amount": {
          "currency": "INR",
          "value": "0.00"
        }
      }
    ]
  }
}
```

**`settlement_date`**: Date on which settlement instruction shall be initiated. Format: `YYYY-MM-DD`.

**`diff_value` FAQ Q27**: Always **positive**. The direction of difference (positive or negative) is determined by comparing `settlements[].amount.value` in `/on_recon` vs what the receiver sent in `/recon`.

---

### Reconciliation Flow (Step-by-Step)

**Initiator**: Receiver NP

**Step 1 — Receiver sends `/recon`** with:

- `order.amount` (total order value)
- `settlements[].amount` (amount receiver believes is correct)
- `settlements[].commission` (buyer app's commission)
- `settlements[].withholding_amount`, `tds`, `tcs` (if applicable)

**Step 2 — Collector responds with `/on_recon`**:

| Scenario            | `recon_accord` | `settlement_date`     | `diff_value`        | Next step                                          |
| ------------------- | -------------- | --------------------- | ------------------- | -------------------------------------------------- |
| Collector agrees    | `true`         | Provided (YYYY-MM-DD) | Not present         | Both NPs send `/settle` on that date               |
| Collector disagrees | `false`        | Not present           | Provided (positive) | Receiver re-initiates `/recon` with updated values |

**Case 2.1** (collector agrees with updated values): Receiver sends new `/recon` → settlement proceeds.

**Case 2.2** (collector still disagrees): Receiver updates values and sends another `/recon`. If unresolved, raise **IGM complaint** (issue subcategory: `underpaid`, `overpaid`, or `not-paid`).

**Step 3 — IGM resolution**: After complaint resolved, re-initiate `/recon` with agreed values → collector responds with `recon_accord: true` + `settlement_date`.

**Positive closure**: Collector responds `recon_accord: true` + `settlement_date` → both NPs send `/settle` on that date.

---

### No Response from Collector (Alternate Path 1)

1. Receiver sends `/recon`
2. No `/on_recon` received from collector
3. After waiting for a settlement cycle → receiver creates **IGM complaint** for the specified order(s)

---

### Reconciliation Before Settlement (Alternate Path 2)

1. Receiver sends `/recon` to agree on amounts before any settlement instruction is created
2. Collector responds — same logic as above (agree → `settlement_date`, disagree → `diff_value`)
3. Both NPs send `/settle` on agreed `settlement_date`

---

## Refund Flow After Settlement

When a buyer requests refund/return **after settlement** has already occurred:

1. Order status update → seller accepts refund → order quote updated with adjusted amount
2. Receiver becomes the new "collector" for reverse settlement (roles reverse)
3. New collector sends `/recon` with updated settlement object for refund amount
4. New collector responds with `recon_accord: true` + `settlement_date`
5. Both NPs send `/settle` for reverse settlement (roles reversed)

---

## Error Codes (RSF)

### NACK Errors (any RSF API)

| Code    | Description                                    |
| ------- | ---------------------------------------------- |
| `70000` | Invalid Signature                              |
| `70001` | Missing mandatory 'Authorization' header param |
| `70002` | Invalid schema                                 |

### `/on_settle` Error Codes (order-level)

| Code    | Description                                       |
| ------- | ------------------------------------------------- |
| `70003` | Invalid bap id                                    |
| `70004` | Inactive bap id                                   |
| `70005` | Invalid bpp id                                    |
| `70006` | Duplicate transaction id                          |
| `70007` | Duplicate message id                              |
| `70008` | Duplicate settlement id                           |
| `70009` | Bap id doesn't match collector or receiver app id |
| `70010` | Collector account not available                   |
| `70011` | Invalid collector app id                          |
| `70012` | Inactive collector app id                         |
| `70013` | Invalid receiver app id                           |
| `70014` | Inactive receiver app id                          |
| `70015` | Receiver app id same as Collector app id          |
| `70016` | Duplicate order id                                |
| `70017` | Collector account inoperable                      |
| `70018` | Receiver account inoperable                       |
| `70019` | No response from bank for collector account       |
| `70020` | No response from bank for receiver account        |
| `70021` | No file shared by counterparty                    |
| `70022` | Order id not shared by counterparty               |
| `70023` | Collector value mismatch                          |
| `70024` | Interparticipant value mismatch                   |
| `70025` | Insufficient balance in collector account         |
| `70026` | Collector NDC breach                              |
| `70027` | Collector bank NDC breach                         |

### `/on_report` Error Codes

| Code    | Description            |
| ------- | ---------------------- |
| `70028` | Invalid transaction_id |
| `70029` | Invalid message_id     |

### `/on_recon` Error Codes

| Code    | Description      |
| ------- | ---------------- |
| `70030` | Invalid Order id |

### HTTP Error

| Code  | Description           |
| ----- | --------------------- |
| `503` | Internal server error |

---

## NOCA / Bank Account Requirements

**NOCA (Non-Operative Current Account)** — mandatory for:

1. NPs collecting money (collector role) who need to settle to counterparties
2. MSN Seller NPs opting in for direct provider settlement

**OCA (Operative Current Account)** — mandatory for all NPs (seller included). Self money flows here via SA instructions. No restrictions on bank.

**NOCA withdrawal**: Only allowed by Settlement Agency instructions. Do not link NOCA to PA/PG until RSF 2.0 APIs are developed and tested.

---

## Testing

| API Pair                 | Testing Environment            |
| ------------------------ | ------------------------------ |
| `/settle` + `/on_settle` | NBBL pre-prod environment      |
| `/report` + `/on_report` | NBBL pre-prod environment      |
| `/recon` + `/on_recon`   | ONDC mock server or another NP |

**Mock server**: https://rsf-mock-service.ondc.org/mock_ui (staging)

**Mock server note (FAQ Q34, Q35)**: For `/report` and `/recon` testing with mock server, `transaction_id` remains the same as the original call.

**After recon_accord true (FAQ Q1)**: Send `/settle` with a **new** transaction_id (not the same one used in recon flow).

---

## Illustrative Examples

### Example 1: Retail Prepaid — Buyer App is Collector

Order value: ₹1050, Buyer app commission: ₹50, Seller app commission: ₹200

| Field             | Collector (/settle) | Receiver (/settle) |
| ----------------- | ------------------- | ------------------ |
| inter_participant | 1000                | 1000               |
| collector         | 50                  | 50                 |
| self              | 50                  | 200                |
| provider          | —                   | 800                |

### Example 2: Retail PoD — Buyer App is Receiver

Order value: ₹1050, Buyer app commission: ₹50, Seller app commission: ₹200

| Field             | Collector (/settle) | Receiver (/settle) |
| ----------------- | ------------------- | ------------------ |
| inter_participant | 50                  | 50                 |
| collector         | 1000                | 1000               |
| self              | 200                 | 50                 |
| provider          | 800                 | —                  |

### Example 3: Logistics — Retail Seller App is Collector, LSP is Receiver

Order value: ₹105, Buyer app commission: ₹5

| Field             | Collector (/settle) | Receiver (/settle) |
| ----------------- | ------------------- | ------------------ |
| inter_participant | 100                 | 100                |
| collector         | 5                   | 5                  |
| self              | 5                   | 100                |
| provider          | —                   | —                  |

### Example 4: Metro — Buyer App is Collector, Metro Authority is Receiver

Order value: ₹100, Buyer app commission: ₹0, Seller app commission: ₹0

| Field             | Collector (/settle) | Receiver (/settle) |
| ----------------- | ------------------- | ------------------ |
| inter_participant | 100                 | 100                |
| collector         | 0                   | 0                  |
| self              | 0                   | 0                  |
| provider          | —                   | 100                |

---

## `/settle` Settlement Type Details

### NP-NP (Inter-NP Order Settlement)

All inter-NP order-level settlements must use `settlement_type: "NP-NP"`.

### MISC (Miscellaneous Settlement)

Used for:

- Moving pre-funded money from NP's NOCA to operative account
- MSN Seller NP transferring money from NOCA to seller's operative account

### NIL (Null Settlement)

Sent when no settlements are required for the settlement cycle. Notifies SA of zero activity.
