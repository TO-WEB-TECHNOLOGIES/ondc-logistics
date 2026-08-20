## Flow of development
Define internal SearchRequest
        ↓
Define ONDC SearchRequest
        ↓
Create mapper
        ↓
Define Search route
        ↓
Create Search controller/service
        ↓
Create search DB record
        ↓
Send ONDC /search
        ↓
Keep SSE connection associated with searchId
        ↓
Receive /on_search
        ↓
Validate ONDC response
        ↓
Persist LSP results
        ↓
Publish results through SSE
        ↓
Send "completed" event