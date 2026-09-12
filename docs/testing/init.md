$init = Invoke-RestMethod `
    -Uri "http://localhost:3000/logistics/init" `
    -Method Post `
    -ContentType "application/json" `
    -Body (@{
      searchId = $search.searchId
bppId = "REPLACE_BPP_ID"
providerId = "REPLACE_PROVIDER_ID"
itemId = "REPLACE_ITEM_ID"
fulfillmentId = "REPLACE_FULFILLMENT_ID"
quantity = 1
billing = @{
name = "Test Customer"
email = "test@example.com"
phone = "9876543210"
address = @{
city = "Bengaluru"
state = "Karnataka"
country = "IND"
areaCode = "560001"
}
}
payment = @{
type = "POST-FULFILLMENT"
collectedBy = "BAP"
}
} | ConvertTo-Json -Depth 10)

$init | ConvertTo-Json -Depth 10

Expected response:

{
"initId": "...",
"transactionId": "...",
"messageId": "...",
"status": "INIT_SENT"
}

To manually test /on_init:

Invoke-RestMethod `    -Uri "http://localhost:3000/on_init"`
-Method Post `    -ContentType "application/json"`
-Body (@{
context = @{
domain = "nic2004:60232"
country = "IND"
city = "std:080"
action = "on_init"
core_version = "1.2.0"
bap_id = "your-bap-id"
bap_uri = "https://your-bap-uri"
bpp_id = "REPLACE_BPP_ID"
bpp_uri = "https://bpp.example.com"
transaction_id = $init.transactionId
message_id = [guid]::NewGuid().ToString()
timestamp = (Get-Date).ToUniversalTime().ToString("o")
}
message = @{}
} | ConvertTo-Json -Depth 10)

Expected callback response:

{
"message": {
"ack": {
"status": "ACK"
}
}
}
