# ONDC Logistics Contract

Authoritative reference:

`ONDC-Logistics-API-Contract-v1.2.5.pdf`

Use the PDF when verifying:
- API request/response fields
- mandatory/optional fields
- API flows
- error codes
- signing/verification
- registry behavior
- provider/location/item/fulfillment semantics
- callback behavior
- idempotency/retry requirements

Do not treat this README as a replacement for the contract.

## Annotated contract (footnotes + comments)

`ondc logistics.docx` in this folder is the v1.2.5 contract with its
footnotes and comment threads stripped. Those carry most enums and
required/optional rules (e.g. payment types, CoD-only fields, billing
semantics) plus ONDC's clarifications. Use the annotated original:

https://docs.google.com/document/d/1CkfxtqyLbSQccJZyNmf9BSGzJBH13gcLOk_tywV-LBk/edit?tab=t.0

Plain-text export: append `/export?format=txt` to the document base URL.