# ElectricSQL Integration Documentation

## Overview

This document details the ElectricSQL integration in the Electron application, including recent fixes to ensure reliable API communication between the Electron main process and the locally running ElectricSQL Docker container.

## Architecture

The application implements a hybrid online/offline architecture with ElectricSQL serving as the synchronization layer:

1. **Electron Client**: Manages the local SQLite database and communicates with ElectricSQL service
2. **ElectricSQL Service**: Running in Docker, provides synchronization between local SQLite and Supabase
3. **Supabase**: Cloud database backend

## Recent Fixes

### 1. Health Check Endpoint Correction

**Issue**: The application was using an incorrect health check endpoint (`/api/status`), which returned 404.

**Fix**: Updated the health check to use the root endpoint (`/`) with proper headers and consider any 2xx response as a successful connection.

```typescript
// Before
const response = await fetch(`${this.electricUrl}/api/status`, {
  signal: AbortSignal.timeout(3000)
});
return response.status === 200;

// After
const response = await fetch(`${this.electricUrl}/`, {
  signal: AbortSignal.timeout(3000),
  headers: {
    'Accept': 'application/json'
  }
});
return response.status >= 200 && response.status < 300;
```

### 2. Request Headers and Format

**Issue**: API requests to ElectricSQL were encountering "Header too long" errors.

**Fix**: Standardized headers across all API requests and added detailed error logging:

```typescript
const response = await fetch(`${this.electricUrl}/v1/shape?table=todos&offset=${this.syncOffset}`, {
  method: 'GET',
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  },
  signal: AbortSignal.timeout(10000)
});
```

### 3. Robust Error Handling

**Issue**: Error handling was minimal, making it difficult to diagnose issues.

**Fix**: Implemented comprehensive error handling with detailed logging:
- Added specific error handling for the "Header too long" error
- Increased timeout values for network operations
- Improved error messages with HTTP status codes and response texts
- Added automatic marking of the client as offline on sync or write failures

### 4. Docker Configuration

**Issue**: Docker healthcheck was using the incorrect port (5133 instead of 3000).

**Fix**: Updated Docker healthcheck to use the correct internal port:

```yaml
# Before
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:5133/api/status"]

# After
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/"]
```

### 5. API Usage Validation

**Issue**: Some API routes needed validation and improvement.

**Fix**:
- Enhanced `/v1/write` endpoint handling with proper JSON structure for both update and delete operations
- Improved `/v1/shape` response processing with additional logging
- Added validation of response status codes

## API Endpoints

| Endpoint | Method | Purpose | Request Format |
|----------|--------|---------|---------------|
| `/` | GET | Health check | Headers: `Accept: application/json` |
| `/v1/shape` | GET | Fetch changes from Supabase | Query params: `table=todos&offset={offset}` |
| `/v1/write` | POST | Write changes to Supabase | Body: `{ table: "todos", values: { id, title, completed, created_at } }` |

## Troubleshooting

1. **Connection Issues**:
   - Verify Docker container is running (`docker ps`)
   - Check Docker logs for errors (`docker logs <container_id>`)
   - Verify port mapping is correct (5133:3000) in docker-compose.yaml

2. **Sync Failures**:
   - Check application logs for detailed error messages
   - Verify Supabase connection string is correct
   - Check for "Header too long" errors in logs

3. **Write Failures**:
   - Verify request format in logs
   - Check response status codes
   - Confirm proper offline storage handling when offline

## Future Improvements

1. Implement retry logic for transient failures
2. Add more robust conflict resolution
3. Optimize sync performance with delta updates
4. Improve logging with structured data format