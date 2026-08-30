Health check:

curl.exe https://ondc-logistics.onrender.com/health

Expected:

{"status":"ok"}

Create a search:

$body = @{
categoryId = "Standard Delivery"
fulfillmentType = "Delivery"

    authorization = @{
        startType = "OTP"
        endType = "OTP"
    }

    start = @{
        gps = "12.9716,77.5946"
        address = @{
            city = "Bengaluru"
            state = "Karnataka"
            country = "IND"
            areaCode = "560001"
        }
    }

    end = @{
        gps = "12.9352,77.6245"
        address = @{
            city = "Bengaluru"
            state = "Karnataka"
            country = "IND"
            areaCode = "560034"
        }
    }

    schedule = @{
        days = "1,2,3,4,5,6,7"
        rangeStart = "09:00:00"
        rangeEnd = "18:00:00"
    }

    payload = @{
        weight = @{
            value = 2
            unit = "kilogram"
        }

        dimensions = @{
            length = @{
                value = 20
                unit = "centimeter"
            }
            breadth = @{
                value = 15
                unit = "centimeter"
            }
            height = @{
                value = 10
                unit = "centimeter"
            }
        }

        category = "Grocery"

        value = @{
            amount = "1000"
            currency = "INR"
        }

        dangerousGoods = $false
    }

    payment = @{
        type = "ON-ORDER"
        collectionAmount = "100"
        currency = "INR"
    }
}


$search = Invoke-RestMethod `
    -Uri "https://ondc-logistics.onrender.com/logistics/search" `
    -Method Post `
    -ContentType "application/json" `
    -Body ($body | ConvertTo-Json -Depth 10)

$search | ConvertTo-Json -Depth 10

Expected response:

{
"searchId": "...",
"transactionId": "...",
"messageId": "...",
"status": "SEARCH_SENT"
}

Open SSE in another terminal:

curl.exe -N "https://ondc-logistics.onrender.com/logistics/search/$($search.searchId)/events"

Send a test on_search callback from the original terminal:

$callback = @{
context = @{
domain = "nic2004:60232"
country = "IND"
city = "std:080"
action = "on_search"
core_version = "1.2.0"
bap_id = "buyer.example.com"
bap_uri = "https://buyer.example.com"
bpp_id = "lsp.example.com"
bpp_uri = "https://lsp.example.com"
transaction_id = $search.transactionId
message_id = [guid]::NewGuid().ToString()
timestamp = (Get-Date).ToUniversalTime().ToString("o")
}
message = @{
catalog = @{
"bpp/providers" = @(
@{
id = "LSP001"
descriptor = @{
name = "Test Logistics Provider"
short_desc = "Test LSP"
}
categories = @(
@{
id = "Standard"
time = @{
label = "enable"
duration = "PT60M"
}
}
)
fulfillments = @(
@{
id = "F1"
type = "Delivery"
}
)
locations = @(
@{
id = "LOC1"
gps = "12.9716,77.5946"
address = @{
street = "MG Road"
city = "Bengaluru"
state = "KA"
area_code = "560001"
}
}
)
items = @(
@{
id = "ITEM001"
category_id = "Standard"
descriptor = @{
code = "STD"
name = "Standard Delivery"
short_desc = "Standard delivery service"
}
fulfillment_id = "F1"
price = @{
currency = "INR"
value = "100.00"
}
time = @{
label = "enable"
duration = "PT60M"
}
}
)
}
)
}
}
}

Invoke-RestMethod `    -Method Post`
-Uri "https://ondc-logistics.onrender.com/on_search" `    -ContentType "application/json"`
-Body ($callback | ConvertTo-Json -Depth 20)

Expected callback response:

{
"message": {
"ack": {
"status": "ACK"
}
}
}

Watch the API terminal for logs such as:

[on-search.controller] callback parsed
[on-search.service] callback staged
[on-search.queue] processing callback
[on-search.repository] catalog ingestion committed
[search.sse] publishing event

To test invalid callbacks:

Invoke-RestMethod `    -Method Post`
-Uri "https://ondc-logistics.onrender.com/on_search" `    -ContentType "application/json"`
-Body '{"message":{}}'

This should return an ONDC NACK response.
