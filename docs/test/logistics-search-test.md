# Testing commands for logistics service
This file lists the commands that can be used to check server health followed by api response of search route. Start the server using `npm run dev` and run the following commands in powershell to test the service.

## Test server health
Invoke-RestMethod http://localhost:3000/health

Expected response
{ "status": "ok" }

## Test invalid response
Invoke-WebRequest `
  -Method Post `
  -Uri http://localhost:3000/logistics/search `
  -ContentType "application/json" `
  -Body "{}"

Expected status: 400 with INVALID_SEARCH_REQUEST.

## Test valid response
$body = @{
  categoryId = "Standard Delivery"
  fulfillmentType = "Standard Delivery"
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
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/logistics/search `
  -ContentType "application/json" `
  -Body $body

Successful response :
{
  "searchId": "...",
  "transactionId": "...",
  "messageId": "...",
  "status": "SEARCH_SENT"
}