# ElectricSQL API Reference

This document provides a comprehensive reference for the ElectricSQL HTTP API used in the Electron application.

## Base URL

The ElectricSQL service runs in Docker and is accessible at:

```
http://localhost:5133
```

This maps to port 3000 inside the Docker container as configured in `docker-compose.yaml`:

```yaml
ports:
  - "5133:3000"
```

## API Endpoints

### Health Check

**Endpoint:** `/`
**Method:** GET
**Description:** Verifies the ElectricSQL service is running and responsive

**Request Headers:**
```
Accept: application/json
```

**Success Response:**
- **Status Code:** 200 OK
- **Body:** JSON object with service information

**Usage Example:**
```typescript
const response = await fetch(`${this.electricUrl}/`, {
  signal: AbortSignal.timeout(3000),
  headers: {
    'Accept': 'application/json'
  }
});

// Consider any 2xx response as a successful connection
return response.status >= 200 && response.status < 300;
```

### Shape Data

**Endpoint:** `/v1/shape`
**Method:** GET
**Description:** Retrieves data changes for a specific table since a given offset

**Query Parameters:**
- `table` (required): The name of the table to retrieve data for
- `offset` (required): The sync offset, use "-1" for initial sync

**Request Headers:**
```
Accept: application/json
Content-Type: application/json
```

**Success Response:**
- **Status Code:** 200 OK
- **Headers:**
  - `electric-offset`: The new sync offset to use for the next request
  - `electric-handle`: The sync handle identifier
- **Body:** JSON array of data entries

**Usage Example:**
```typescript
const response = await fetch(`${this.electricUrl}/v1/shape?table=todos&offset=${this.syncOffset}`, {
  method: 'GET',
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  },
  signal: AbortSignal.timeout(10000)
});

// Extract sync metadata from headers
if (response.headers.get('electric-offset')) {
  this.syncOffset = response.headers.get('electric-offset') || '-1';
}

if (response.headers.get('electric-handle')) {
  this.syncHandle = response.headers.get('electric-handle') || '';
}

// Process the shape log entries
const entries = await response.json();
return this.processShapeLogEntries(entries);
```

### Write Data

**Endpoint:** `/v1/write`
**Method:** POST
**Description:** Writes data to a specific table, which will be synchronized to Supabase

**Request Headers:**
```
Accept: application/json
Content-Type: application/json
```

**Request Body:**
```json
{
  "table": "string",   // Table name (e.g., "todos")
  "values": {          // Record values
    "id": "string",    // Record ID (required)
    // Other fields specific to the table
  }
}
```

**For Deletions:**
```json
{
  "table": "string",
  "values": {
    "id": "string",
    "_deleted": true
  }
}
```

**Success Response:**
- **Status Code:** 200 OK
- **Body:** JSON object with write confirmation

**Usage Example:**
```typescript
// Prepare the request body
let requestBody: any = {
  table: 'todos',
  values: {}
};

// Handle deletion case
if (todo._deleted) {
  requestBody.values = {
    id: todo.id,
    _deleted: true
  };
} else {
  // Handle create/update
  requestBody.values = {
    id: todo.id,
    title: todo.title,
    completed: todo.completed,
    created_at: todo.created_at
  };
}

// Send the request
const response = await fetch(`${this.electricUrl}/v1/write`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  body: JSON.stringify(requestBody),
  signal: AbortSignal.timeout(10000)
});

if (response.status >= 200 && response.status < 300) {
  const result = await response.json();
  return result;
} else {
  const errorText = await response.text();
  throw new Error(`Write failed with status ${response.status}: ${errorText}`);
}
```

## Error Handling

The API can return various error responses:

### Connection Errors

- Connection refused: ElectricSQL service is not running
- Timeout: Service is running but not responsive

### HTTP Errors

- **400 Bad Request:** Malformed request body or invalid parameters
- **404 Not Found:** Endpoint not found or table doesn't exist
- **500 Internal Server Error:** Server-side error in ElectricSQL

### Headers Too Long Error

This specific error occurs when request headers exceed allowed limits:

```
(Bandit.HTTPError) Header too long
```

**Potential Causes:**
- Excessively large request headers
- Malformed JSON payloads
- Network proxy issues

**Resolution:**
- Keep headers simple and consistent
- Validate JSON before sending
- Add proper error handling with detailed logging

## Best Practices

1. **Error Handling:**
   - Always wrap API calls in try/catch blocks
   - Log detailed error information
   - Handle offline scenarios gracefully

2. **Sync Management:**
   - Store and reuse sync offsets between application sessions
   - Process all shape log entries correctly
   - Handle control messages properly

3. **Performance:**
   - Use appropriate timeouts for different operations
   - Consider network conditions in timeout values
   - Implement retry logic for transient failures